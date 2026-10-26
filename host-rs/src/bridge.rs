//! `wraithgrid-host stdio <appVersion>` (ADR 0004 phase 5): the remote end of a machine
//! connection when the window ships this binary over ssh instead of needing Wraithgrid
//! installed there. Like `wraithgrid host-stdio` (src/main/host-bridge.ts) it joins the ssh
//! channel to this machine's background host, starting one if none runs, and puts in the
//! host's token itself: ssh already proved who the user is. `plan` frames (remote-plan.ts)
//! become `create` frames, resolved on this machine by plan.rs.

use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::mpsc;

use crate::plan;

const START_TIMEOUT: Duration = Duration::from_secs(10);

pub struct HostFiles {
    pub dir: PathBuf,
    pub socket: PathBuf,
    pub token: PathBuf,
    pub lock: PathBuf,
    pub log: PathBuf,
}

/// This machine's user-data dir for remote panes: its own, so it never meets the host of a
/// Wraithgrid installed here (which may be another version).
pub fn user_data(home: &Path) -> PathBuf {
    match std::env::var("WRAITHGRID_USER_DATA_DIR") {
        Ok(d) if !d.is_empty() => PathBuf::from(d),
        _ => home.join(".wraithgrid").join("remote"),
    }
}

/// `hostPaths` in src/host/paths.ts (POSIX), so both always agree where a host lives.
pub fn host_files(user_data: &Path) -> HostFiles {
    let base = match std::env::var("XDG_RUNTIME_DIR") {
        Ok(d) if d.starts_with('/') => PathBuf::from(d),
        _ => std::env::temp_dir(),
    };
    let hash = Sha256::digest(user_data.to_string_lossy().as_bytes());
    let short: String = hash.iter().take(6).map(|b| format!("{b:02x}")).collect();
    // SAFETY: getuid cannot fail.
    let uid = unsafe { libc::getuid() };
    let dir = base.join(format!("wraithgrid-{uid}-{short}"));
    HostFiles {
        socket: dir.join("host.sock"),
        token: dir.join("host.token"),
        lock: dir.join("host.lock"),
        log: dir.join("host.log"),
        dir,
    }
}

fn start_host(f: &HostFiles, app_version: &str) -> Result<(), String> {
    crate::ensure_dir(&f.dir)?;
    let big = std::fs::metadata(&f.log).is_ok_and(|m| m.size() > 1024 * 1024);
    let log = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(!big)
        .truncate(big)
        .mode(0o600)
        .open(&f.log)
        .map_err(|e| e.to_string())?;
    let settings = json!({
        "paths": {
            "dir": f.dir.to_string_lossy(),
            "socket": f.socket.to_string_lossy(),
            "token": f.token.to_string_lossy(),
            "lock": f.lock.to_string_lossy(),
            "log": f.log.to_string_lossy(),
        },
        "appVersion": app_version,
        "maskedFds": 0,
    });
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let err = log.try_clone().map_err(|e| e.to_string())?;
    let mut cmd = Command::new(exe);
    cmd.env("WRAITHGRID_HOST", settings.to_string())
        .current_dir(plan::home())
        .stdin(Stdio::null())
        .stdout(log)
        .stderr(err);
    // The host outlives this ssh session: its own session, and none of the fds this bridge
    // inherited (sshd's, or a test runner's pipes), which would keep them open for as long
    // as it runs. Marked close-on-exec rather than closed: std's exec-error pipe is one.
    let max_fd = {
        let mut lim = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        // SAFETY: getrlimit only writes `lim`.
        let ok = unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut lim) } == 0;
        if ok {
            lim.rlim_cur.min(65_536) as i32
        } else {
            1024
        }
    };
    // SAFETY: setsid and fcntl are async-signal-safe, and nothing here allocates.
    unsafe {
        cmd.pre_exec(move || {
            libc::setsid();
            for fd in 3..max_fd {
                let flags = libc::fcntl(fd, libc::F_GETFD);
                if flags >= 0 {
                    libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC);
                }
            }
            Ok(())
        });
    }
    cmd.spawn().map(drop).map_err(|e| e.to_string())
}

async fn ensure_host(f: &HostFiles, app_version: &str) -> Result<UnixStream, String> {
    if let Ok(s) = UnixStream::connect(&f.socket).await {
        return Ok(s);
    }
    start_host(f, app_version)?;
    let deadline = Instant::now() + START_TIMEOUT;
    loop {
        tokio::time::sleep(Duration::from_millis(100)).await;
        match UnixStream::connect(&f.socket).await {
            Ok(s) => return Ok(s),
            Err(e) if Instant::now() > deadline => return Err(e.to_string()),
            Err(_) => {}
        }
    }
}

pub fn main(app_version: String) -> i32 {
    let rt = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("wraithgrid-host stdio: {e}");
            return 1;
        }
    };
    match rt.block_on(run(app_version)) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("wraithgrid-host stdio: {e}");
            1
        }
    }
}

async fn run(app_version: String) -> Result<(), String> {
    let home = plan::home();
    let files = host_files(&user_data(&home));
    let host = ensure_host(&files, &app_version).await?;
    let token = std::fs::read_to_string(&files.token)
        .map_err(|e| e.to_string())?
        .trim()
        .to_string();
    let (host_read, mut host_write) = host.into_split();

    // One writer for stdout, so a reply this bridge makes never lands inside a host frame.
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
    let writer = tokio::spawn(async move {
        let mut out = tokio::io::stdout();
        while let Some(line) = out_rx.recv().await {
            if out.write_all(line.as_bytes()).await.is_err() || out.flush().await.is_err() {
                break;
            }
        }
    });
    let from_host = {
        let out_tx = out_tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(host_read);
            let mut line = String::new();
            loop {
                line.clear();
                match lines.read_line(&mut line).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        if out_tx.send(line.clone()).is_err() {
                            break;
                        }
                    }
                }
            }
        })
    };

    // Frames go to the host one at a time, in order: a plan waits for its lookup.
    let to_host = async move {
        let mut input = BufReader::new(tokio::io::stdin());
        let mut line = String::new();
        let mut greeted = false;
        let mut path: Option<String> = None;
        loop {
            line.clear();
            match input.read_line(&mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            if line.trim().is_empty() {
                continue;
            }
            let Ok(mut frame) = serde_json::from_str::<Value>(&line) else {
                break;
            };
            let t = frame
                .get("t")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if !greeted {
                greeted = true;
                if t != "hello" {
                    break;
                }
                frame["token"] = json!(token);
                frame["role"] = json!("gui");
                line = format!("{frame}\n");
            } else if t == "plan" {
                let id = frame.get("id").and_then(Value::as_i64).unwrap_or(-1);
                let p = frame.get("plan").cloned().unwrap_or(Value::Null);
                let known = path.clone();
                let resolved = tokio::task::spawn_blocking(move || {
                    let path = known.unwrap_or_else(|| {
                        plan::login_path(p.get("path").unwrap_or(&Value::Null), &plan::home())
                    });
                    (plan::resolve(&p, &path), path)
                })
                .await;
                let Ok((result, found)) = resolved else { break };
                path = Some(found);
                match result {
                    Ok(req) => {
                        line = format!("{}\n", json!({ "t": "create", "id": id, "req": req }))
                    }
                    Err(error) => {
                        let reply = json!({ "t": "reply", "id": id, "reply": { "ok": false, "error": error } });
                        let _ = out_tx.send(format!("{reply}\n"));
                        continue;
                    }
                }
            }
            if host_write.write_all(line.as_bytes()).await.is_err() {
                break;
            }
        }
        let _ = host_write.shutdown().await;
    };

    tokio::select! {
        _ = to_host => {}
        _ = from_host => {}
    }
    writer.abort();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_paths_match_the_window() {
        // createHash('sha256').update('/home/u/.config/wraithgrid').digest('hex').slice(0, 12)
        let f = host_files(Path::new("/home/u/.config/wraithgrid"));
        let name = f.dir.file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.starts_with("wraithgrid-"));
        assert!(name.ends_with("-aafbc6ae9fca"), "{name}");
        assert_eq!(f.socket, f.dir.join("host.sock"));
    }
}
