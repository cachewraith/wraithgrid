//! Wraithgrid's background pty host in Rust (ADR 0004), a drop-in for `out/main/host.js`
//! (ADR 0001): started detached by the GUI with its settings as JSON in `WRAITHGRID_HOST`,
//! it takes the same lock, writes the same token and serves the same frames on the same socket.

mod protocol;
mod pty;
mod screen;
mod server;
mod utf8;

use std::fs;
use std::io::Write;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use serde_json::Value;
use tokio::net::UnixListener;
use tokio::signal::unix::{signal, SignalKind};

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

fn alive(pid: i32) -> bool {
    // SAFETY: kill with signal 0 only checks the pid.
    let r = unsafe { libc::kill(pid, 0) };
    r == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

/// One host per socket: an exclusive lock file with our pid; a dead owner's lock is taken over.
fn take_lock(file: &PathBuf) -> std::io::Result<bool> {
    let me = std::process::id() as i32;
    for _ in 0..2 {
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(file)
        {
            Ok(mut f) => {
                f.write_all(me.to_string().as_bytes())?;
                return Ok(true);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                let owner: i32 = fs::read_to_string(file)?.trim().parse().unwrap_or(0);
                if owner != 0 && owner != me && alive(owner) {
                    return Ok(false);
                }
                fs::remove_file(file)?;
            }
            Err(e) => return Err(e),
        }
    }
    Ok(false)
}

/// The host dir is user-only: one that already exists must be ours, a real directory and
/// closed to group/other (in a shared /tmp another user could have made it first).
fn ensure_dir(dir: &PathBuf) -> Result<(), String> {
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
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
        let st = fs::symlink_metadata(dir).map_err(|e| e.to_string())?;
        if st.mode() & 0o077 != 0 {
            return Err(format!("{} is open to other users", dir.display()));
        }
    }
    Ok(())
}

/// fds 3..=up_to that are /dev/null copies the GUI used to mask its own (src/host/fds.ts).
fn close_masked_fds(up_to: i32) {
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

fn random_token() -> std::io::Result<String> {
    let mut bytes = [0u8; 32];
    fs::File::open("/dev/urandom")
        .and_then(|mut f| std::io::Read::read_exact(&mut f, &mut bytes))?;
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
    let Some((paths, app_version, masked)) = settings() else {
        eprintln!("wraithgrid-host: started without settings");
        std::process::exit(2);
    };
    // Pane envs are built by the GUI; nothing of the host's own launch leaks into them anyway.
    std::env::remove_var("WRAITHGRID_HOST");
    std::env::remove_var("ELECTRON_RUN_AS_NODE");
    if masked > 0 {
        close_masked_fds(masked);
    }
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
    quiet_unlink(&paths.socket);

    let token = random_token().map_err(|e| e.to_string())?;
    let tmp = paths
        .token
        .with_extension(format!("token.{}", std::process::id()));
    fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&tmp)
        .and_then(|mut f| f.write_all(token.as_bytes()))
        .map_err(|e| e.to_string())?;
    fs::rename(&tmp, &paths.token).map_err(|e| e.to_string())?;

    let listener = match UnixListener::bind(&paths.socket) {
        Ok(l) => l,
        Err(e) => {
            let _ = PATHS.set(paths);
            log(&format!("listen failed: {e}"));
            exit(1)
        }
    };
    let _ = fs::set_permissions(&paths.socket, fs::Permissions::from_mode(0o600));
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

    let mut term = signal(SignalKind::terminate()).map_err(|e| e.to_string())?;
    let mut int = signal(SignalKind::interrupt()).map_err(|e| e.to_string())?;
    // Detached from any terminal; a hang-up is not ours to act on.
    let mut hup = signal(SignalKind::hangup()).map_err(|e| e.to_string())?;
    loop {
        tokio::select! {
            conn = listener.accept() => match conn {
                Ok((stream, _)) => { tokio::spawn(Arc::clone(&host).accept(stream)); }
                Err(e) => log(&format!("accept failed: {e}")),
            },
            _ = term.recv() => { host.stop_all().await; exit(0); }
            _ = int.recv() => { host.stop_all().await; exit(0); }
            _ = hup.recv() => {}
        }
    }
}
