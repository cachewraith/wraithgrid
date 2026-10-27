//! Wraithgrid's background pty host in Rust (ADR 0004), a drop-in for `out/main/host.js`
//! (ADR 0001): started detached by the GUI with its settings as JSON in `WRAITHGRID_HOST`,
//! it takes the same lock, writes the same token and serves the same frames on the same socket
//! (a named pipe on Windows). `wraithgrid-host stdio <appVersion>` is the ssh end of a remote
//! machine instead (bridge.rs, Unix only: remote machines are Linux).

#[cfg(unix)]
mod bridge;
#[cfg(unix)]
mod plan;
mod protocol;
mod pty;
mod screen;
mod server;
mod utf8;

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;

use serde_json::Value;

struct Paths {
    dir: PathBuf,
    socket: PathBuf,
    token: PathBuf,
    lock: PathBuf,
    log: PathBuf,
}

static PATHS: OnceLock<Paths> = OnceLock::new();

fn log(msg: &str) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    eprintln!("[{now}] {msg}");
}

fn quiet_unlink(p: &PathBuf) {
    let _ = fs::remove_file(p);
}

/// Leaves nothing behind on a clean exit; after a failure the log stays for a bug report.
fn exit(code: i32) -> ! {
    if let Some(p) = PATHS.get() {
        #[cfg(unix)]
        quiet_unlink(&p.socket);
        quiet_unlink(&p.token);
        quiet_unlink(&p.lock);
        log(&format!("host exiting ({code})"));
        if code == 0 {
            quiet_unlink(&p.log);
            let _ = fs::remove_dir(&p.dir);
        }
    }
    std::process::exit(code)
}

/// A new file only we can read (0600 on Unix; the user's own profile dir on Windows).
fn private_file(create_new: bool) -> fs::OpenOptions {
    let mut o = fs::OpenOptions::new();
    o.write(true);
    if create_new {
        o.create_new(true);
    } else {
        o.create(true).truncate(true);
    }
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut o, 0o600);
    o
}

/// One host per socket: an exclusive lock file with our pid; a dead owner's lock is taken over.
fn take_lock(file: &PathBuf) -> std::io::Result<bool> {
    let me = std::process::id() as i32;
    for _ in 0..2 {
        match private_file(true).open(file) {
            Ok(mut f) => {
                f.write_all(me.to_string().as_bytes())?;
                return Ok(true);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                let owner: i32 = fs::read_to_string(file)?.trim().parse().unwrap_or(0);
                if owner != 0 && owner != me && os::alive(owner) {
                    return Ok(false);
                }
                fs::remove_file(file)?;
            }
            Err(e) => return Err(e),
        }
    }
    Ok(false)
}

pub(crate) use os::ensure_dir;

fn random_token() -> std::io::Result<String> {
    let bytes = os::random_bytes()?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn settings() -> Option<(Paths, String, i32)> {
    let raw = std::env::var("WRAITHGRID_HOST").ok()?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    let p = v.get("paths")?;
    let path = |k: &str| p.get(k).and_then(Value::as_str).map(PathBuf::from);
    let paths = Paths {
        dir: path("dir")?,
        socket: path("socket")?,
        token: path("token")?,
        lock: path("lock")?,
        log: path("log")?,
    };
    let version = v.get("appVersion")?.as_str()?.to_string();
    let masked = v.get("maskedFds").and_then(Value::as_i64).unwrap_or(0) as i32;
    Some((paths, version, masked))
}

fn main() {
    let argv: Vec<String> = std::env::args().collect();
    if argv.get(1).map(String::as_str) == Some("--version") {
        println!("wraithgrid-host {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    if argv.get(1).map(String::as_str) == Some("stdio") {
        #[cfg(unix)]
        std::process::exit(bridge::main(argv.get(2).cloned().unwrap_or_default()));
        #[cfg(not(unix))]
        {
            eprintln!("wraithgrid-host stdio: remote machines run Linux");
            std::process::exit(2);
        }
    }
    let Some((paths, app_version, masked)) = settings() else {
        eprintln!("wraithgrid-host: started without settings");
        std::process::exit(2);
    };
    // Pane envs are built by the GUI; nothing of the host's own launch leaks into them anyway.
    std::env::remove_var("WRAITHGRID_HOST");
    std::env::remove_var("ELECTRON_RUN_AS_NODE");
    os::close_masked_fds(masked);
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap_or_else(|e| {
            log(&format!("host failed: {e}"));
            std::process::exit(1)
        });
    if let Err(e) = rt.block_on(run(paths, app_version)) {
        log(&format!("host failed: {e}"));
        exit(1);
    }
}

async fn run(paths: Paths, app_version: String) -> Result<(), String> {
    ensure_dir(&paths.dir)?;
    if !take_lock(&paths.lock).map_err(|e| e.to_string())? {
        log("another host owns this socket; exiting");
        std::process::exit(0);
    }
    // The lock is ours, so any socket file left is from a host that died.
    #[cfg(unix)]
    quiet_unlink(&paths.socket);

    let token = random_token().map_err(|e| e.to_string())?;
    let tmp = paths
        .token
        .with_extension(format!("token.{}", std::process::id()));
    private_file(false)
        .open(&tmp)
        .and_then(|mut f| f.write_all(token.as_bytes()))
        .map_err(|e| e.to_string())?;
    fs::rename(&tmp, &paths.token).map_err(|e| e.to_string())?;

    let listener = match os::Listener::bind(&paths.socket) {
        Ok(l) => l,
        Err(e) => {
            let _ = PATHS.set(paths);
            log(&format!("listen failed: {e}"));
            exit(1)
        }
    };
    let _ = PATHS.set(paths);

    let host = server::Host::new(server::Config {
        token,
        app_version: app_version.clone(),
        pid: std::process::id(),
        log,
        on_exit: Box::new(|| exit(0)),
    });
    log(&format!(
        "host {} listening (app {app_version}, rust)",
        std::process::id()
    ));
    os::serve(listener, host).await
}

#[cfg(unix)]
mod os {
    use std::fs;
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    use std::path::Path;
    use std::sync::Arc;

    use tokio::net::UnixListener;
    use tokio::signal::unix::{signal, SignalKind};

    use crate::{exit, log, server};

    pub fn alive(pid: i32) -> bool {
        // SAFETY: kill with signal 0 only checks the pid.
        let r = unsafe { libc::kill(pid, 0) };
        r == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }

    /// The host dir is user-only: one that already exists must be ours, a real directory and
    /// closed to group/other (in a shared /tmp another user could have made it first).
    pub(crate) fn ensure_dir(dir: &Path) -> Result<(), String> {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let st = fs::symlink_metadata(dir).map_err(|e| e.to_string())?;
        if !st.is_dir() {
            return Err(format!("{} is not a directory", dir.display()));
        }
        // SAFETY: getuid cannot fail.
        if st.uid() != unsafe { libc::getuid() } {
            return Err(format!("{} belongs to another user", dir.display()));
        }
        if st.mode() & 0o077 != 0 {
            // A dir we just created with the default umask: close it.
            fs::set_permissions(dir, fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
            let st = fs::symlink_metadata(dir).map_err(|e| e.to_string())?;
            if st.mode() & 0o077 != 0 {
                return Err(format!("{} is open to other users", dir.display()));
            }
        }
        Ok(())
    }

    /// fds 3..=up_to that are /dev/null copies the GUI used to mask its own (src/host/fds.ts).
    pub fn close_masked_fds(up_to: i32) {
        if up_to <= 0 {
            return;
        }
        let Ok(null) = fs::metadata("/dev/null") else {
            return;
        };
        let null_dev = null.rdev();
        for fd in 3..=up_to {
            // SAFETY: fstat/close on fds we may own; errors mean "not open".
            unsafe {
                let mut st: libc::stat = std::mem::zeroed();
                if libc::fstat(fd, &mut st) == 0
                    && (st.st_mode & libc::S_IFMT) == libc::S_IFCHR
                    && st.st_rdev as u64 == null_dev
                {
                    libc::close(fd);
                }
            }
        }
    }

    pub fn random_bytes() -> std::io::Result<[u8; 32]> {
        let mut bytes = [0u8; 32];
        fs::File::open("/dev/urandom")
            .and_then(|mut f| std::io::Read::read_exact(&mut f, &mut bytes))?;
        Ok(bytes)
    }

    pub struct Listener(UnixListener);

    impl Listener {
        pub fn bind(path: &Path) -> std::io::Result<Self> {
            let l = UnixListener::bind(path)?;
            let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
            Ok(Self(l))
        }
    }

    pub async fn serve(listener: Listener, host: Arc<server::Host>) -> Result<(), String> {
        let mut term = signal(SignalKind::terminate()).map_err(|e| e.to_string())?;
        let mut int = signal(SignalKind::interrupt()).map_err(|e| e.to_string())?;
        // Detached from any terminal; a hang-up is not ours to act on.
        let mut hup = signal(SignalKind::hangup()).map_err(|e| e.to_string())?;
        loop {
            tokio::select! {
                conn = listener.0.accept() => match conn {
                    Ok((stream, _)) => { tokio::spawn(Arc::clone(&host).accept(stream)); }
                    Err(e) => log(&format!("accept failed: {e}")),
                },
                _ = term.recv() => { host.stop_all().await; exit(0); }
                _ = int.recv() => { host.stop_all().await; exit(0); }
                _ = hup.recv() => {}
            }
        }
    }
}

#[cfg(windows)]
mod os {
    use std::fs;
    use std::path::Path;
    use std::sync::Arc;

    use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::Security::Cryptography::{
        BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
    };
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    use crate::{exit, log, server};

    pub fn alive(pid: i32) -> bool {
        // SAFETY: a query-only handle, closed right away.
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid as u32);
            if h.is_null() {
                // Gone, or not ours to open: a process we can't open isn't a host of ours.
                return false;
            }
            let mut code = 0u32;
            let ok = GetExitCodeProcess(h, &mut code) != 0;
            CloseHandle(h);
            ok && code == STILL_ACTIVE as u32
        }
    }

    /// Under the user's own profile (userData\run), which other users can't open.
    pub(crate) fn ensure_dir(dir: &Path) -> Result<(), String> {
        fs::create_dir_all(dir).map_err(|e| e.to_string())
    }

    pub fn close_masked_fds(_up_to: i32) {}

    pub fn random_bytes() -> std::io::Result<[u8; 32]> {
        let mut bytes = [0u8; 32];
        // SAFETY: fills our own buffer from the system RNG.
        let st = unsafe {
            BCryptGenRandom(
                std::ptr::null_mut(),
                bytes.as_mut_ptr(),
                bytes.len() as u32,
                BCRYPT_USE_SYSTEM_PREFERRED_RNG,
            )
        };
        if st < 0 {
            return Err(std::io::Error::other(format!(
                "BCryptGenRandom failed (0x{st:08x})"
            )));
        }
        Ok(bytes)
    }

    /// The named pipe; each client gets its own instance, and a new one waits for the next.
    pub struct Listener {
        name: String,
        next: NamedPipeServer,
    }

    impl Listener {
        pub fn bind(path: &Path) -> std::io::Result<Self> {
            let name = path.to_string_lossy().into_owned();
            // First instance: fails if another process already serves this name.
            let next = ServerOptions::new()
                .first_pipe_instance(true)
                .reject_remote_clients(true)
                .create(&name)?;
            Ok(Self { name, next })
        }
    }

    pub async fn serve(mut listener: Listener, host: Arc<server::Host>) -> Result<(), String> {
        loop {
            tokio::select! {
                conn = listener.next.connect() => {
                    match conn {
                        Ok(()) => {
                            let fresh = ServerOptions::new()
                                .reject_remote_clients(true)
                                .create(&listener.name)
                                .map_err(|e| e.to_string())?;
                            let stream = std::mem::replace(&mut listener.next, fresh);
                            tokio::spawn(Arc::clone(&host).accept(stream));
                        }
                        Err(e) => log(&format!("accept failed: {e}")),
                    }
                }
                // Started detached, with no console: a Ctrl-C hook that can't be set only
                // turns this branch off, never stops the host.
                Ok(()) = tokio::signal::ctrl_c() => { host.stop_all().await; exit(0); }
            }
        }
    }
}
