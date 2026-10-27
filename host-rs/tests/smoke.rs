//! The built host end to end, on every platform CI runs (ADR 0004 phase 3b): started as the GUI
//! starts it, reached over its socket (a named pipe on Windows), a pane that prints, one that
//! is typed into, then a shutdown. On Windows this is what proves the ConPTY spawn, the raw
//! `cmd.exe` command line and the pipe; the parity suite (tests/host) covers the rest on Unix.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};

struct Host {
    child: Child,
    dir: PathBuf,
    socket: String,
}

impl Drop for Host {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn start_host() -> Host {
    let stamp = format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let dir = std::env::temp_dir().join(format!("wg-smoke-{stamp}"));
    let socket = if cfg!(windows) {
        format!(r"\\.\pipe\wraithgrid-smoke-{stamp}")
    } else {
        dir.join("host.sock").to_string_lossy().into_owned()
    };
    let paths = json!({
        "dir": dir,
        "socket": socket,
        "token": dir.join("host.token"),
        "lock": dir.join("host.lock"),
        "log": dir.join("host.log"),
    });
    let child = Command::new(env!("CARGO_BIN_EXE_wraithgrid-host"))
        .env(
            "WRAITHGRID_HOST",
            json!({ "paths": paths, "appVersion": "smoke" }).to_string(),
        )
        .stdin(Stdio::null())
        .spawn()
        .expect("start the host");
    Host { child, dir, socket }
}

fn read_token(h: &Host) -> String {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Ok(t) = std::fs::read_to_string(h.dir.join("host.token")) {
            if t.len() == 64 {
                return t;
            }
        }
        assert!(Instant::now() < deadline, "the host never wrote its token");
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(unix)]
async fn connect(socket: &str) -> impl AsyncRead + AsyncWrite {
    tokio::net::UnixStream::connect(socket)
        .await
        .expect("connect")
}

#[cfg(windows)]
async fn connect(socket: &str) -> impl AsyncRead + AsyncWrite {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match tokio::net::windows::named_pipe::ClientOptions::new().open(socket) {
            Ok(c) => return c,
            Err(e) if Instant::now() < deadline => {
                let _ = e;
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(e) => panic!("connect: {e}"),
        }
    }
}

/// A pane command line that prints `text` and exits 0.
fn printer(text: &str) -> (String, Value) {
    if cfg!(windows) {
        // A ready line, as platform.ts builds one for an npm `.cmd` CLI.
        let comspec = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into());
        (comspec, json!(format!("/d /s /c \"echo {text}\"")))
    } else {
        ("/bin/sh".into(), json!(["-c", format!("echo {text}")]))
    }
}

/// An interactive shell, and the line that makes it print `text`.
fn shell(text: &str) -> (String, Value, String) {
    if cfg!(windows) {
        let comspec = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into());
        (comspec, json!(["/d", "/q"]), format!("echo {text}\r"))
    } else {
        ("/bin/sh".into(), json!([]), format!("echo {text}\n"))
    }
}

fn env() -> Value {
    Value::Object(
        std::env::vars()
            .map(|(k, v)| (k, Value::String(v)))
            .collect(),
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_pane_prints_takes_input_and_exits() {
    let h = start_host();
    let token = read_token(&h);
    let (read, mut write) = tokio::io::split(connect(&h.socket).await);
    let mut lines = BufReader::new(read).lines();
    let mut send = async |frame: Value| {
        write
            .write_all(format!("{frame}\n").as_bytes())
            .await
            .unwrap();
    };
    let cwd = std::env::temp_dir().to_string_lossy().into_owned();

    send(json!({ "t": "hello", "protocol": 1, "appVersion": "smoke", "token": token })).await;
    let (file, args) = printer("hello-from-pane");
    send(json!({ "t": "create", "id": 1, "req": {
        "paneId": "p1", "file": file, "args": args, "cwd": cwd, "env": env(), "cols": 80, "rows": 24
    }}))
    .await;
    let (sh, sh_args, typed) = shell("typed-into-pane");
    send(json!({ "t": "create", "id": 2, "req": {
        "paneId": "p2", "file": sh, "args": sh_args, "cwd": cwd, "env": env(), "cols": 80, "rows": 24
    }}))
    .await;

    let mut welcome = false;
    let mut out = std::collections::HashMap::<String, String>::new();
    let mut p1_exit = None;
    let mut typed_sent = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    while !(welcome
        && p1_exit.is_some()
        && out.get("p2").is_some_and(|o| o.contains("typed-into-pane")))
    {
        let line = tokio::time::timeout_at(deadline, lines.next_line())
            .await
            .unwrap_or_else(|_| panic!("timed out; seen so far: {out:?}"))
            .unwrap()
            .expect("the host closed the connection");
        let f: Value = serde_json::from_str(&line).unwrap();
        match f["t"].as_str().unwrap() {
            "welcome" => welcome = true,
            "refused" => panic!("refused: {f}"),
            "reply" => assert_eq!(f["reply"]["ok"], true, "a create failed: {f}"),
            "data" => {
                let pane = f["paneId"].as_str().unwrap().to_string();
                out.entry(pane.clone())
                    .or_default()
                    .push_str(f["data"].as_str().unwrap());
                if pane == "p2" && !typed_sent {
                    typed_sent = true;
                    send(json!({ "t": "write", "paneId": "p2", "data": typed })).await;
                }
            }
            "exit" if f["paneId"] == "p1" => p1_exit = Some(f["exitCode"].as_i64().unwrap()),
            _ => {}
        }
    }
    assert!(
        out["p1"].contains("hello-from-pane"),
        "p1 printed: {:?}",
        out["p1"]
    );
    assert_eq!(p1_exit, Some(0));

    send(json!({ "t": "shutdown", "id": 3, "exit": true })).await;
    let mut h = h;
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if let Some(status) = h.child.try_wait().unwrap() {
            assert!(status.success(), "the host exited with {status}");
            break;
        }
        assert!(
            Instant::now() < deadline,
            "the host did not exit on shutdown"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}
