//! Pane processes, as `src/host/pty-manager.ts` runs them with node-pty: one pty per pane,
//! output coalesced (16 ms, 256 KB) and decoded as UTF-8. Unix: a process group per pane
//! (portable-pty), SIGHUP to the group on kill, SIGKILL after the grace period, then a sweep.
//! Windows: a ConPTY of our own (portable-pty quotes every argument, and an npm `.cmd` CLI
//! comes as a ready `cmd.exe` command line), closed on kill, `taskkill /T /F` after the grace.

use std::io::{Read, Write};
use std::sync::mpsc as std_mpsc;
use std::time::Duration;

use tokio::sync::{mpsc, watch};

use crate::protocol::SpawnRequest;
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

/// A started process, before the host wires its pipes: what each platform's spawn returns.
struct Started {
    pid: i32,
    console: imp::Console,
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
    /// Blocks until the process ends: (exitCode, signal) as node-pty reports them.
    wait: Box<dyn FnOnce() -> (i64, Option<i64>) + Send>,
}

/// A running pane process. Dropping it closes the pty; `kill` stops the process tree.
pub struct Pty {
    pub pid: i32,
    console: imp::Console,
    input: std_mpsc::Sender<Vec<u8>>,
    /// Becomes true once the process exited (and was reaped).
    exited: watch::Receiver<bool>,
}

impl Pty {
    pub fn write(&self, data: &str) {
        let _ = self.input.send(data.as_bytes().to_vec());
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        self.console.resize(cols, rows);
    }

    /// Asks the process to end, then forces it after the grace period. Resolves when done.
    pub async fn kill(self) {
        let Pty {
            pid,
            console,
            mut exited,
            ..
        } = self;
        let console = console.soft_kill(pid);
        let gone = tokio::time::timeout(KILL_GRACE, exited.wait_for(|e| *e))
            .await
            .is_ok();
        imp::hard_kill(pid, gone);
        drop(console);
    }
}

/// Starts a pane process. Its output and exit arrive on `events`.
pub fn spawn(
    req: &SpawnRequest,
    gen: u64,
    events: mpsc::UnboundedSender<PtyEvent>,
) -> Result<Pty, String> {
    let Started {
        pid,
        console,
        reader,
        mut writer,
        wait,
    } = imp::start(req)?;

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
        let _ = status_tx.send(wait());
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
        console,
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
                // The pty closed; the exit status comes from the waiter.
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
                // Output still queued from before the exit belongs to this run (a ConPTY keeps
                // its pipe open until it is closed, so this is also how Windows output ends).
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

#[cfg(unix)]
mod imp {
    use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};

    use super::Started;
    use crate::protocol::{Args, SpawnRequest};

    pub struct Console(Box<dyn MasterPty + Send>);

    impl Console {
        pub fn resize(&self, cols: u16, rows: u16) {
            let _ = self.0.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            });
        }

        /// SIGHUP to the group; the pty stays open until the process is gone.
        pub fn soft_kill(self, pid: i32) -> Self {
            signal_group(pid, libc::SIGHUP, false);
            self
        }
    }

    /// SIGKILL to the group, or (once the leader is gone) a sweep of what is left in it.
    pub fn hard_kill(pid: i32, leader_gone: bool) {
        signal_group(pid, libc::SIGKILL, leader_gone);
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

    pub(super) fn start(req: &SpawnRequest) -> Result<Started, String> {
        let pair = native_pty_system()
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
        // The GUI builds the whole environment (pane-env.ts strips the terminal's own
        // variables); like node-pty with an explicit env, only TERM is set here.
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
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        Ok(Started {
            pid,
            console: Console(pair.master),
            reader,
            writer,
            wait: Box::new(move || reap(pid)),
        })
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
}

#[cfg(windows)]
mod imp {
    use std::ffi::OsStr;
    use std::fs::File;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::os::windows::process::CommandExt;
    use std::ptr::{null, null_mut};
    use std::sync::Arc;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Console::{
        ClosePseudoConsole, CreatePseudoConsole, ResizePseudoConsole, COORD, HPCON,
    };
    use windows_sys::Win32::System::Pipes::CreatePipe;
    use windows_sys::Win32::System::Threading::{
        CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
        InitializeProcThreadAttributeList, UpdateProcThreadAttribute, WaitForSingleObject,
        CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT, INFINITE,
        LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
        STARTF_USESTDHANDLES, STARTUPINFOEXW,
    };

    use super::Started;
    use crate::protocol::{Args, SpawnRequest};

    /// A pseudoconsole handle; ConPTY calls on it are safe from any thread.
    struct Hpc(HPCON);
    // SAFETY: an HPCON is an opaque handle the console host owns, not thread-bound memory.
    unsafe impl Send for Hpc {}
    // SAFETY: as above; ResizePseudoConsole may be called from any thread.
    unsafe impl Sync for Hpc {}

    impl Drop for Hpc {
        fn drop(&mut self) {
            let hpc = self.0;
            // Closing waits for the console host to finish; never on a runtime thread.
            let raw = hpc as usize;
            std::thread::spawn(move || {
                // SAFETY: the handle came from CreatePseudoConsole and is closed once, here.
                unsafe { ClosePseudoConsole(raw as HPCON) };
            });
        }
    }

    pub struct Console {
        hpc: Option<Hpc>,
        /// Keeps the process handle open while the pane lives (its pid can't be reused).
        _process: Arc<OwnedHandle>,
    }

    impl Console {
        pub fn resize(&self, cols: u16, rows: u16) {
            if let Some(h) = &self.hpc {
                // SAFETY: a live pseudoconsole handle.
                unsafe { ResizePseudoConsole(h.0, coord(cols, rows)) };
            }
        }

        /// Closing the console ends what runs in it, as node-pty's kill() does on Windows.
        pub fn soft_kill(mut self, _pid: i32) -> Self {
            self.hpc = None;
            self
        }
    }

    /// The whole tree, forced, if it outlived the console (node-pty's windowsKillPolicy).
    pub fn hard_kill(pid: i32, leader_gone: bool) {
        if leader_gone {
            return;
        }
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }

    fn coord(cols: u16, rows: u16) -> COORD {
        COORD {
            X: cols.min(i16::MAX as u16) as i16,
            Y: rows.min(i16::MAX as u16) as i16,
        }
    }

    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(Some(0)).collect()
    }

    /// One argument as CreateProcess's parser (CommandLineToArgvW) reads it back.
    fn quote(arg: &str, out: &mut String) {
        if !arg.is_empty() && !arg.contains([' ', '\t', '\n', '\x0b', '"']) {
            out.push_str(arg);
            return;
        }
        out.push('"');
        let mut backslashes = 0;
        for c in arg.chars() {
            match c {
                '\\' => backslashes += 1,
                '"' => {
                    out.extend(std::iter::repeat_n('\\', backslashes * 2 + 1));
                    out.push('"');
                    backslashes = 0;
                }
                _ => {
                    out.extend(std::iter::repeat_n('\\', backslashes));
                    out.push(c);
                    backslashes = 0;
                }
            }
        }
        out.extend(std::iter::repeat_n('\\', backslashes * 2));
        out.push('"');
    }

    /// The command line: the file quoted, then each argument quoted, or a ready line as is
    /// (node-pty joins a string `args` to the file the same way).
    pub(super) fn command_line(file: &str, args: &Args) -> String {
        let mut line = String::new();
        quote(file, &mut line);
        match args {
            Args::List(list) => {
                for a in list {
                    line.push(' ');
                    quote(a, &mut line);
                }
            }
            Args::Line(raw) => {
                if !raw.is_empty() {
                    line.push(' ');
                    line.push_str(raw);
                }
            }
        }
        line
    }

    /// `k=v\0…\0\0`, sorted by name without case as CreateProcess expects.
    fn env_block(env: &[(String, String)]) -> Vec<u16> {
        let mut vars: Vec<&(String, String)> = env.iter().collect();
        vars.sort_by_key(|(k, _)| k.to_uppercase());
        let mut block: Vec<u16> = Vec::new();
        for (k, v) in vars {
            block.extend(OsStr::new(&format!("{k}={v}")).encode_wide());
            block.push(0);
        }
        if block.is_empty() {
            block.push(0);
        }
        block.push(0);
        block
    }

    fn last_error(what: &str) -> String {
        format!("{what}: {}", std::io::Error::last_os_error())
    }

    pub(super) fn start(req: &SpawnRequest) -> Result<Started, String> {
        // SAFETY: plain Win32 calls; every handle made here is owned by exactly one wrapper
        // (OwnedHandle, File, Hpc) or closed before returning.
        unsafe {
            let (mut in_read, mut in_write): (HANDLE, HANDLE) = (null_mut(), null_mut());
            let (mut out_read, mut out_write): (HANDLE, HANDLE) = (null_mut(), null_mut());
            if CreatePipe(&mut in_read, &mut in_write, null(), 0) == 0 {
                return Err(last_error("CreatePipe"));
            }
            if CreatePipe(&mut out_read, &mut out_write, null(), 0) == 0 {
                CloseHandle(in_read);
                CloseHandle(in_write);
                return Err(last_error("CreatePipe"));
            }
            let mut hpc: HPCON = 0 as HPCON;
            let hr =
                CreatePseudoConsole(coord(req.cols, req.rows), in_read, out_write, 0, &mut hpc);
            // The console host has its own copies now.
            CloseHandle(in_read);
            CloseHandle(out_write);
            let writer = File::from_raw_handle(in_write as _);
            let reader = File::from_raw_handle(out_read as _);
            if hr < 0 {
                return Err(format!("CreatePseudoConsole failed (0x{hr:08x})"));
            }
            let hpc = Hpc(hpc);

            let mut size = 0usize;
            InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut size);
            let mut list_buf = vec![0u8; size];
            let list = list_buf.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST;
            if InitializeProcThreadAttributeList(list, 1, 0, &mut size) == 0 {
                return Err(last_error("InitializeProcThreadAttributeList"));
            }
            let ok = UpdateProcThreadAttribute(
                list,
                0,
                PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE as usize,
                hpc.0 as *const core::ffi::c_void,
                std::mem::size_of::<HPCON>(),
                null_mut(),
                null(),
            );
            if ok == 0 {
                DeleteProcThreadAttributeList(list);
                return Err(last_error("UpdateProcThreadAttribute"));
            }

            let mut si: STARTUPINFOEXW = std::mem::zeroed();
            si.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
            // The host's own stdio goes to its log: without this the pane would inherit it
            // instead of the pseudoconsole.
            si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
            si.StartupInfo.hStdInput = INVALID_HANDLE_VALUE;
            si.StartupInfo.hStdOutput = INVALID_HANDLE_VALUE;
            si.StartupInfo.hStdError = INVALID_HANDLE_VALUE;
            si.lpAttributeList = list;

            let mut cmdline = wide(&command_line(&req.file, &req.args));
            let env = env_block(&req.env);
            let cwd = wide(&req.cwd);
            let mut pi: PROCESS_INFORMATION = std::mem::zeroed();
            let ok = CreateProcessW(
                null(),
                cmdline.as_mut_ptr(),
                null(),
                null(),
                0,
                EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
                env.as_ptr() as *const core::ffi::c_void,
                cwd.as_ptr(),
                &si.StartupInfo,
                &mut pi,
            );
            DeleteProcThreadAttributeList(list);
            if ok == 0 {
                return Err(last_error(&format!("could not start {}", req.file)));
            }
            CloseHandle(pi.hThread);
            let process = Arc::new(OwnedHandle::from_raw_handle(pi.hProcess as _));
            let waited = Arc::clone(&process);
            Ok(Started {
                pid: pi.dwProcessId as i32,
                console: Console {
                    hpc: Some(hpc),
                    _process: process,
                },
                reader: Box::new(reader),
                writer: Box::new(writer),
                wait: Box::new(move || {
                    let h = waited.as_raw_handle() as HANDLE;
                    let mut code = 0u32;
                    WaitForSingleObject(h, INFINITE);
                    GetExitCodeProcess(h, &mut code);
                    // Windows has no signals: node-pty reports none.
                    (i64::from(code), None)
                }),
            })
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn command_lines_quote_lists_and_keep_ready_lines() {
            let list = Args::List(vec![
                "a b".into(),
                "x\"y".into(),
                "c:\\dir\\".into(),
                "".into(),
            ]);
            assert_eq!(
                command_line("C:\\Program Files\\x.exe", &list),
                r#""C:\Program Files\x.exe" "a b" "x\"y" c:\dir\ """#
            );
            let line = Args::Line(r#"/d /s /c ""C:\npm\claude.cmd" --x "a b"""#.into());
            assert_eq!(
                command_line("C:\\Windows\\system32\\cmd.exe", &line),
                r#"C:\Windows\system32\cmd.exe /d /s /c ""C:\npm\claude.cmd" --x "a b"""#
            );
        }
    }
}
