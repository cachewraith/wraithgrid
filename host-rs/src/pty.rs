//! Pane processes, as `src/host/pty-manager.ts` runs them with node-pty: one pty and process
//! group per pane, output coalesced (16 ms, 256 KB) and decoded as UTF-8, SIGHUP to the group
//! on kill, SIGKILL after the grace period, then a sweep of the group.

use std::io::{Read, Write};
use std::sync::mpsc as std_mpsc;
use std::time::Duration;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tokio::sync::{mpsc, watch};

use crate::protocol::{Args, SpawnRequest};
use crate::utf8::Utf8Stream;

pub const FLUSH: Duration = Duration::from_millis(16);
pub const MAX_BUFFER: usize = 256 * 1024;
pub const KILL_GRACE: Duration = Duration::from_millis(2000);

/// What a pane's process reports to the host. `gen` tells a replaced process's late events
/// from the current one's.
#[derive(Debug)]
pub enum PtyEvent {
    Data {
        pane_id: String,
        gen: u64,
        data: String,
    },
    Exit {
        pane_id: String,
        gen: u64,
        exit_code: i64,
        signal: Option<i64>,
    },
}

/// A running pane process. Dropping it closes the pty; `kill` stops the process tree.
pub struct Pty {
    pub pid: i32,
    master: Box<dyn MasterPty + Send>,
    input: std_mpsc::Sender<Vec<u8>>,
    /// Becomes true once the process exited (and was reaped).
    exited: watch::Receiver<bool>,
}

impl Pty {
    pub fn write(&self, data: &str) {
        let _ = self.input.send(data.as_bytes().to_vec());
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        let _ = self.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
    }

    /// SIGHUP to the group now, SIGKILL after the grace period unless it exited; once the
    /// leader is gone, anything left in its group is killed too. Resolves when done.
    pub async fn kill(self) {
        let pid = self.pid;
        let mut exited = self.exited.clone();
        signal_group(pid, libc::SIGHUP, false);
        let gone = tokio::time::timeout(KILL_GRACE, exited.wait_for(|e| *e)).await;
        if gone.is_ok() {
            signal_group(pid, libc::SIGKILL, true);
        } else {
            signal_group(pid, libc::SIGKILL, false);
        }
        drop(self);
    }
}

/// node-pty's posixKillPolicy: the group first; the leader alone only if `group_only` is off.
fn signal_group(pid: i32, sig: i32, group_only: bool) {
    // SAFETY: plain kill(2) calls on a pid we started.
    unsafe {
        if libc::kill(-pid, sig) == 0 || group_only {
            return;
        }
        libc::kill(pid, sig);
    }
}

/// Starts a pane process. Its output and exit arrive on `events`.
pub fn spawn(
    req: &SpawnRequest,
    gen: u64,
    events: mpsc::UnboundedSender<PtyEvent>,
) -> Result<Pty, String> {
    let system = native_pty_system();
    let pair = system
        .openpty(PtySize {
            rows: req.rows,
            cols: req.cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(&req.file);
    match &req.args {
        Args::List(args) => cmd.args(args),
        Args::Line(line) => cmd.arg(line),
    }
    cmd.cwd(&req.cwd);
    // The GUI builds the whole environment (pane-env.ts strips the terminal's own variables);
    // like node-pty with an explicit env, only TERM is set here.
    cmd.env_clear();
    for (k, v) in &req.env {
        cmd.env(k, v);
    }
    cmd.env("TERM", "xterm-256color");

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let pid = child.process_id().ok_or("the process has no pid")? as i32;
    // The host reaps the process itself (waitpid) to report signals as numbers; keep the
    // portable-pty handle alive without waiting on it.
    std::mem::forget(child);

    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let (input, input_rx) = std_mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        for chunk in input_rx {
            if writer
                .write_all(&chunk)
                .and_then(|_| writer.flush())
                .is_err()
            {
                break;
            }
        }
    });

    let (exited_tx, exited) = watch::channel(false);
    let (chunks_tx, chunks_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    std::thread::spawn(move || read_loop(reader, chunks_tx));
    let (status_tx, status_rx) = tokio::sync::oneshot::channel::<(i64, Option<i64>)>();
    std::thread::spawn(move || {
        let status = reap(pid);
        let _ = status_tx.send(status);
    });
    tokio::spawn(pump(
        req.pane_id.clone(),
        gen,
        chunks_rx,
        status_rx,
        exited_tx,
        events,
    ));

    Ok(Pty {
        pid,
        master: pair.master,
        input,
        exited,
    })
}

fn read_loop(mut reader: Box<dyn Read + Send>, out: mpsc::UnboundedSender<Vec<u8>>) {
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        match reader.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if out.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        }
    }
}

/// Waits for the process like node-pty: (exitCode, signal); a normal exit has signal 0, a
/// signal gives exitCode 0.
fn reap(pid: i32) -> (i64, Option<i64>) {
    let mut status = 0;
    loop {
        // SAFETY: waitpid on our own child.
        let r = unsafe { libc::waitpid(pid, &mut status, 0) };
        if r == pid {
            break;
        }
        if r == -1 && std::io::Error::last_os_error().raw_os_error() != Some(libc::EINTR) {
            return (0, Some(0));
        }
    }
    if libc::WIFSIGNALED(status) {
        (0, Some(i64::from(libc::WTERMSIG(status))))
    } else {
        (i64::from(libc::WEXITSTATUS(status)), Some(0))
    }
}

/// Coalesces output into flushes of up to 16 ms or 256 KB, then reports the exit after the
/// last output, as node-pty's onExit follows a final flush.
async fn pump(
    pane_id: String,
    gen: u64,
    mut chunks: mpsc::UnboundedReceiver<Vec<u8>>,
    status: tokio::sync::oneshot::Receiver<(i64, Option<i64>)>,
    exited: watch::Sender<bool>,
    events: mpsc::UnboundedSender<PtyEvent>,
) {
    let mut decoder = Utf8Stream::default();
    let mut pending = String::new();
    let mut status = Box::pin(status);
    let mut deadline: Option<tokio::time::Instant> = None;
    let flush = |pending: &mut String| {
        if !pending.is_empty() {
            let data = std::mem::take(pending);
            let _ = events.send(PtyEvent::Data {
                pane_id: pane_id.clone(),
                gen,
                data,
            });
        }
    };
    let result = loop {
        let sleep = async {
            match deadline {
                Some(d) => tokio::time::sleep_until(d).await,
                None => std::future::pending().await,
            }
        };
        tokio::select! {
            chunk = chunks.recv() => match chunk {
                Some(bytes) => {
                    pending.push_str(&decoder.push(&bytes));
                    if pending.len() >= MAX_BUFFER {
                        flush(&mut pending);
                        deadline = None;
                    } else if deadline.is_none() {
                        deadline = Some(tokio::time::Instant::now() + FLUSH);
                    }
                }
                // The pty closed; the exit status comes from the reaper.
                None => {
                    pending.push_str(&decoder.finish());
                    break status.await.unwrap_or((0, Some(0)));
                }
            },
            () = sleep => {
                flush(&mut pending);
                deadline = None;
            }
            s = &mut status => {
                // Output still queued from before the exit belongs to this run.
                let grace = tokio::time::Instant::now() + Duration::from_millis(50);
                while let Ok(Some(bytes)) = tokio::time::timeout_at(grace, chunks.recv()).await {
                    pending.push_str(&decoder.push(&bytes));
                }
                pending.push_str(&decoder.finish());
                break s.unwrap_or((0, Some(0)));
            }
        }
    };
    flush(&mut pending);
    let _ = exited.send(true);
    let _ = events.send(PtyEvent::Exit {
        pane_id,
        gen,
        exit_code: result.0,
        signal: result.1,
    });
}
