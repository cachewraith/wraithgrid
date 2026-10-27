//! The host's core, as `src/host/server.ts`: owns every pane process and its screen and serves
//! any number of clients. A client sees a pane's output only after it created or attached it.
//! `wraithgrid` commands (role `cli`) may read, type into and wait on panes, and ask the window
//! for new ones, only while the GUI has command-line access turned on.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use regex::Regex;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, oneshot};

use crate::protocol::{self, ClientFrame, PaneState, Role};
use crate::pty::{self, Pty, PtyEvent};
use crate::screen::Screen;

/// `src/shared/activity.ts`.
const RUNNING_WINDOW: Duration = Duration::from_millis(1200);
const ECHO_WINDOW: Duration = Duration::from_millis(250);
/// Typed input with no answer yet: the CLI is about to work.
const PENDING_INPUT: Duration = Duration::from_millis(10_000);
const HELLO_TIMEOUT: Duration = Duration::from_secs(5);
const WAIT_TICK: Duration = Duration::from_millis(200);
const GUI_TIMEOUT: Duration = Duration::from_secs(30);
const IDLE_EXIT: Duration = Duration::from_secs(10 * 60);
/// A client that stops reading is dropped before its backlog fills the host's memory.
const MAX_BACKLOG: usize = 64 * 1024 * 1024;
const CLI_FRAMES: [&str; 9] = [
    "hello", "list", "read", "wait", "write", "gui", "shutdown", "attach", "resize",
];
const GUI_ONLY: &str = "Only the Wraithgrid window may do that.";
const CLI_OFF: &str =
    "Command-line access is off. Turn it on in Wraithgrid: Settings → Command line.";

pub struct Config {
    pub token: String,
    pub app_version: String,
    pub pid: u32,
    pub log: fn(&str),
    /// Called once the host should exit (idle, or a `shutdown` with `exit`).
    pub on_exit: Box<dyn Fn() + Send + Sync>,
}

struct ClientState {
    authed: bool,
    role: Role,
    attached: HashSet<String>,
    out: mpsc::UnboundedSender<String>,
    backlog: Arc<AtomicUsize>,
    closed: bool,
}

impl ClientState {
    fn send(&mut self, frame: &Value) {
        if self.closed {
            return;
        }
        let line = protocol::encode(frame);
        if self.backlog.load(Ordering::Relaxed) + line.len() > MAX_BACKLOG {
            // Dropping the sender ends the writer, which closes the connection.
            self.closed = true;
            return;
        }
        self.backlog.fetch_add(line.len(), Ordering::Relaxed);
        if self.out.send(line).is_err() {
            self.closed = true;
        }
    }
}

struct PaneEntry {
    gen: u64,
    pid: i32,
    screen: Screen,
    exit: Option<(i64, Option<i64>)>,
    approval: Option<Regex>,
    last_output_at: Option<Instant>,
    last_input_at: Option<Instant>,
    gui_size: (u16, u16),
}

struct Waiter {
    pane_id: String,
    until: PaneState,
    quiet: Duration,
    deadline: Instant,
    idle_since: Option<Instant>,
    done: Option<oneshot::Sender<Value>>,
    /// Who waits: once it is gone the wait is dropped, not polled to its timeout (#140).
    client: u64,
}

struct Relay {
    gui: u64,
    done: oneshot::Sender<Value>,
}

#[derive(Default)]
struct State {
    panes: HashMap<String, PaneEntry>,
    ptys: HashMap<String, (u64, Pty)>,
    clients: HashMap<u64, ClientState>,
    waiters: HashMap<u64, Waiter>,
    relays: HashMap<u64, Relay>,
    cli_access: bool,
    stopping: bool,
    next_client: u64,
    next_gen: u64,
    next_waiter: u64,
    next_relay: u64,
    idle_gen: u64,
}

pub struct Host {
    cfg: Config,
    state: Mutex<State>,
    events: mpsc::UnboundedSender<PtyEvent>,
}

impl Host {
    pub fn new(cfg: Config) -> Arc<Self> {
        let (events, mut rx) = mpsc::unbounded_channel();
        let host = Arc::new(Self {
            cfg,
            state: Mutex::new(State::default()),
            events,
        });
        let h = Arc::clone(&host);
        tokio::spawn(async move {
            while let Some(e) = rx.recv().await {
                match e {
                    PtyEvent::Data { pane_id, gen, data } => h.on_data(&pane_id, gen, &data),
                    PtyEvent::Exit {
                        pane_id,
                        gen,
                        exit_code,
                        signal,
                    } => {
                        h.on_exit(&pane_id, gen, exit_code, signal);
                    }
                }
            }
        });
        host.check_idle();
        host
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn log(&self, msg: &str) {
        (self.cfg.log)(msg);
    }

    /// Serves one connection until it closes.
    /// Serves one connection: a Unix socket, or a named pipe instance on Windows.
    pub async fn accept<S>(self: Arc<Self>, stream: S)
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Send + 'static,
    {
        let (mut read, mut write) = tokio::io::split(stream);
        let (out, mut out_rx) = mpsc::unbounded_channel::<String>();
        let backlog = Arc::new(AtomicUsize::new(0));
        let id = {
            let mut s = self.lock();
            s.next_client += 1;
            let id = s.next_client;
            s.clients.insert(
                id,
                ClientState {
                    authed: false,
                    role: Role::Gui,
                    attached: HashSet::new(),
                    out,
                    backlog: Arc::clone(&backlog),
                    closed: false,
                },
            );
            id
        };
        self.check_idle();

        let writer_backlog = Arc::clone(&backlog);
        let writer = tokio::spawn(async move {
            while let Some(line) = out_rx.recv().await {
                if write.write_all(line.as_bytes()).await.is_err() {
                    break;
                }
                writer_backlog.fetch_sub(line.len(), Ordering::Relaxed);
            }
            let _ = write.shutdown().await;
        });

        // An unauthenticated client is dropped after a few seconds.
        let hello_by = tokio::time::Instant::now() + HELLO_TIMEOUT;
        let mut buf: Vec<u8> = Vec::new();
        let mut chunk = vec![0u8; 64 * 1024];
        'conn: loop {
            let authed = self.lock().clients.get(&id).is_some_and(|c| c.authed);
            let got = if authed {
                read.read(&mut chunk).await
            } else {
                match tokio::time::timeout_at(hello_by, read.read(&mut chunk)).await {
                    Ok(r) => r,
                    Err(_) => break,
                }
            };
            let n = match got {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            buf.extend_from_slice(&chunk[..n]);
            while let Some(nl) = buf.iter().position(|&b| b == b'\n') {
                let line: Vec<u8> = buf.drain(..=nl).collect();
                let line = &line[..line.len() - 1];
                if line.is_empty() {
                    continue;
                }
                let text = String::from_utf8_lossy(line);
                let value: Value = match serde_json::from_str(&protocol::mend_surrogates(&text)) {
                    Ok(v) => v,
                    Err(_) => {
                        self.log("client dropped: bad frame");
                        break 'conn;
                    }
                };
                if !Arc::clone(&self).handle(id, value).await {
                    break 'conn;
                }
                if self.is_closed(id) {
                    break 'conn;
                }
            }
            if buf.len() > protocol::MAX_FRAME {
                self.log("client dropped: frame too large");
                break;
            }
            if self.is_closed(id) {
                break;
            }
        }
        let stuck = backlog.load(Ordering::Relaxed) > MAX_BACKLOG;
        self.disconnect(id);
        if stuck {
            // It stopped reading: don't keep writing to it.
            writer.abort();
            return;
        }
        // Let queued frames (a last reply) go out before the socket closes.
        let _ = tokio::time::timeout(Duration::from_secs(2), writer).await;
    }

    fn is_closed(&self, id: u64) -> bool {
        self.lock().clients.get(&id).is_none_or(|c| c.closed)
    }

    fn disconnect(self: &Arc<Self>, id: u64) {
        let mut s = self.lock();
        let Some(client) = s.clients.remove(&id) else {
            return;
        };
        // A terminal attach resized its panes; give them back the window's size.
        if client.role == Role::Cli {
            for pane_id in &client.attached {
                let size = match s.panes.get(pane_id) {
                    Some(e) if e.exit.is_none() => e.gui_size,
                    _ => continue,
                };
                if let Some((_, pty)) = s.ptys.get(pane_id) {
                    pty.resize(size.0, size.1);
                }
                if let Some(e) = s.panes.get_mut(pane_id) {
                    e.screen.resize(size.0, size.1);
                }
            }
        }
        s.waiters.retain(|_, w| w.client != id);
        let gone: Vec<u64> = s
            .relays
            .iter()
            .filter(|(_, r)| r.gui == id)
            .map(|(k, _)| *k)
            .collect();
        for k in gone {
            if let Some(r) = s.relays.remove(&k) {
                let _ = r.done.send(protocol::err("The Wraithgrid window closed."));
            }
        }
        drop(s);
        self.check_idle();
    }

    fn send(&self, id: u64, frame: &Value) {
        if let Some(c) = self.lock().clients.get_mut(&id) {
            c.send(frame);
        }
    }

    fn reply(&self, client: u64, id: u64, reply: Value) {
        self.send(client, &protocol::reply(id, reply));
    }

    /// Handles one frame; false drops the client.
    async fn handle(self: Arc<Self>, client: u64, raw: Value) -> bool {
        let Some(f) = protocol::parse_client_frame(&raw) else {
            self.log("client dropped: invalid frame");
            return false;
        };
        let (authed, role) = {
            let s = self.lock();
            match s.clients.get(&client) {
                Some(c) => (c.authed, c.role),
                None => return false,
            }
        };
        if !authed {
            let ClientFrame::Hello { token, role, .. } = &f else {
                self.send(client, &protocol::refused("bad token"));
                return false;
            };
            if !token_matches(token, &self.cfg.token) {
                self.send(client, &protocol::refused("bad token"));
                return false;
            }
            let mut s = self.lock();
            if *role == Role::Cli && !s.cli_access {
                if let Some(c) = s.clients.get_mut(&client) {
                    c.send(&protocol::refused(CLI_OFF));
                }
                return false;
            }
            if let Some(c) = s.clients.get_mut(&client) {
                c.authed = true;
                c.role = *role;
                c.send(&protocol::welcome(&self.cfg.app_version, self.cfg.pid));
            }
            return true;
        }
        if role == Role::Cli && !CLI_FRAMES.contains(&f.kind()) {
            if let Some(id) = f.id() {
                self.reply(client, id, protocol::err(GUI_ONLY));
            }
            return true;
        }
        match f {
            ClientFrame::Hello { .. } => {}
            ClientFrame::Config { cli_access } => self.lock().cli_access = cli_access,
            ClientFrame::GuiReply { id, reply } => {
                let mut s = self.lock();
                if s.relays.get(&id).is_some_and(|r| r.gui == client) {
                    if let Some(r) = s.relays.remove(&id) {
                        let out = if reply.get("ok") == Some(&Value::Bool(true)) {
                            json!({ "ok": true, "result": reply })
                        } else {
                            let error = match reply.get("error") {
                                Some(Value::String(e)) => e.clone(),
                                Some(Value::Null) | None => "The window refused it.".to_string(),
                                Some(other) => js_string(other),
                            };
                            protocol::err(&error)
                        };
                        let _ = r.done.send(out);
                    }
                }
            }
            ClientFrame::Write { pane_id, data } => {
                let mut s = self.lock();
                if let Some(e) = s.panes.get_mut(&pane_id) {
                    e.last_input_at = Some(Instant::now());
                }
                if let Some((_, pty)) = s.ptys.get(&pane_id) {
                    pty.write(&data);
                }
            }
            ClientFrame::Resize {
                pane_id,
                cols,
                rows,
            } => {
                let mut s = self.lock();
                let Some(e) = s.panes.get_mut(&pane_id) else {
                    return true;
                };
                if e.exit.is_some() {
                    return true;
                }
                if role == Role::Gui {
                    e.gui_size = (cols, rows);
                }
                e.screen.resize(cols, rows);
                if let Some((_, pty)) = s.ptys.get(&pane_id) {
                    pty.resize(cols, rows);
                }
            }
            ClientFrame::Kill { pane_id } => {
                let pty = {
                    let mut s = self.lock();
                    drop_pane(&mut s, &pane_id);
                    s.ptys.remove(&pane_id)
                };
                let host = Arc::clone(&self);
                tokio::spawn(async move {
                    if let Some((_, pty)) = pty {
                        pty.kill().await;
                    }
                    host.check_idle();
                });
            }
            // Requests that can take long (a wait, the window, stopping every pane) run on
            // their own; the rest answer in order, so a `write` after a `create` finds its pane.
            other @ (ClientFrame::Wait { .. }
            | ClientFrame::Gui { .. }
            | ClientFrame::Shutdown { .. }) => {
                let host = Arc::clone(&self);
                tokio::spawn(async move {
                    let id = other.id().unwrap_or(0);
                    if let Some(reply) = Arc::clone(&host).request(client, other).await {
                        host.reply(client, id, reply);
                    }
                });
            }
            other => {
                let id = other.id().unwrap_or(0);
                if let Some(reply) = Arc::clone(&self).request(client, other).await {
                    self.reply(client, id, reply);
                }
            }
        }
        true
    }

    async fn request(self: Arc<Self>, client: u64, f: ClientFrame) -> Option<Value> {
        match f {
            ClientFrame::Spawn { .. } => Some(protocol::err(
                "Remote panes are started through wraithgrid host-stdio.",
            )),
            ClientFrame::Create { id: _, req } => {
                let old = {
                    let mut s = self.lock();
                    if s.stopping {
                        return Some(protocol::err("The background host is stopping."));
                    }
                    drop_pane(&mut s, &req.pane_id);
                    // A restart replaces the old process; its late exit must not reach the pane.
                    s.ptys.remove(&req.pane_id)
                };
                if let Some((_, pty)) = old {
                    tokio::spawn(pty.kill());
                }
                let mut s = self.lock();
                s.next_gen += 1;
                let gen = s.next_gen;
                let pty = match pty::spawn(&req, gen, self.events.clone()) {
                    Ok(p) => p,
                    Err(e) => return Some(protocol::err(&e)),
                };
                let pid = pty.pid;
                let approval = req.approval.as_deref().and_then(|src| {
                    regex::RegexBuilder::new(src)
                        .case_insensitive(true)
                        .build()
                        .ok()
                });
                s.panes.insert(
                    req.pane_id.clone(),
                    PaneEntry {
                        gen,
                        pid,
                        screen: Screen::new(req.cols, req.rows),
                        exit: None,
                        approval,
                        last_output_at: None,
                        last_input_at: None,
                        gui_size: (req.cols, req.rows),
                    },
                );
                s.ptys.insert(req.pane_id.clone(), (gen, pty));
                for c in s.clients.values_mut() {
                    c.attached.remove(&req.pane_id);
                }
                if let Some(c) = s.clients.get_mut(&client) {
                    c.attached.insert(req.pane_id.clone());
                }
                drop(s);
                self.check_idle();
                Some(json!({ "ok": true, "pid": pid }))
            }
            ClientFrame::Attach {
                id,
                pane_id,
                cols,
                rows,
            } => {
                // Atomic under the lock: the replay, then the reply, then live output.
                let mut s = self.lock();
                let role = s.clients.get(&client).map_or(Role::Gui, |c| c.role);
                let Some(entry) = s.panes.get_mut(&pane_id) else {
                    return Some(protocol::missing("Not running"));
                };
                if entry.exit.is_none() {
                    if role == Role::Gui {
                        entry.gui_size = (cols, rows);
                    }
                    entry.screen.resize(cols, rows);
                }
                let snapshot = entry.screen.serialize();
                let pid = entry.pid;
                let exit = entry.exit;
                if entry.exit.is_none() {
                    if let Some((_, pty)) = s.ptys.get(&pane_id) {
                        pty.resize(cols, rows);
                    }
                }
                // A command-line attach must not use up the exit the window has not shown yet.
                if exit.is_some() && role == Role::Gui {
                    drop_pane(&mut s, &pane_id);
                } else if exit.is_none() {
                    if let Some(c) = s.clients.get_mut(&client) {
                        c.attached.insert(pane_id.clone());
                    }
                }
                if let Some(c) = s.clients.get_mut(&client) {
                    // In pieces, so a big screen never exceeds a client's MAX_FRAME (#134).
                    for part in protocol::chunk_replay(&snapshot, protocol::REPLAY_CHUNK) {
                        c.send(&protocol::data(&pane_id, part, true));
                    }
                    let exit = exit.map(|(code, sig)| json!({ "exitCode": code, "signal": sig }));
                    c.send(&protocol::reply(
                        id,
                        json!({ "ok": true, "pid": pid, "attached": true, "exit": exit }),
                    ));
                }
                None
            }
            ClientFrame::List { .. } => {
                let mut s = self.lock();
                let now = Instant::now();
                let mut panes = Vec::new();
                for (pane_id, e) in s.panes.iter_mut() {
                    let state = pane_state(e, now);
                    panes.push(json!({
                        "paneId": pane_id,
                        "pid": e.pid,
                        "exit": e.exit.map(|(c, sig)| json!({ "exitCode": c, "signal": sig })),
                        "state": state.as_str(),
                    }));
                }
                Some(json!({ "ok": true, "panes": panes }))
            }
            ClientFrame::Read { pane_id, lines, .. } => {
                let mut s = self.lock();
                match s.panes.get_mut(&pane_id) {
                    None => Some(protocol::missing(&format!("No pane {pane_id} is running."))),
                    Some(e) => Some(json!({ "ok": true, "text": e.screen.text(lines) })),
                }
            }
            ClientFrame::Wait {
                pane_id,
                until,
                quiet_ms,
                timeout_ms,
                ..
            } => {
                let (tx, rx) = oneshot::channel();
                let wid = {
                    let mut s = self.lock();
                    if !s.panes.contains_key(&pane_id) {
                        return Some(protocol::missing(&format!("No pane {pane_id} is running.")));
                    }
                    s.next_waiter += 1;
                    let wid = s.next_waiter;
                    s.waiters.insert(
                        wid,
                        Waiter {
                            pane_id,
                            until,
                            quiet: Duration::from_millis(quiet_ms),
                            deadline: Instant::now() + Duration::from_millis(timeout_ms),
                            idle_since: None,
                            done: Some(tx),
                            client,
                        },
                    );
                    wid
                };
                let host = Arc::clone(&self);
                tokio::spawn(async move {
                    loop {
                        tokio::time::sleep(WAIT_TICK).await;
                        if !host.check_wait(wid) {
                            break;
                        }
                    }
                });
                Some(
                    rx.await
                        .unwrap_or_else(|_| protocol::err("The host stopped.")),
                )
            }
            ClientFrame::Gui { action, .. } => {
                let (tx, rx) = oneshot::channel();
                let rid = {
                    let mut s = self.lock();
                    let gui = s
                        .clients
                        .iter()
                        .filter(|(_, c)| c.authed && c.role == Role::Gui)
                        .map(|(k, _)| *k)
                        .max();
                    let Some(gui) = gui else {
                        return Some(protocol::err(
                            "Wraithgrid is not open. Start it to add panes.",
                        ));
                    };
                    s.next_relay += 1;
                    let rid = s.next_relay;
                    s.relays.insert(rid, Relay { gui, done: tx });
                    if let Some(c) = s.clients.get_mut(&gui) {
                        c.send(&protocol::gui(rid, &action));
                    }
                    rid
                };
                match tokio::time::timeout(GUI_TIMEOUT, rx).await {
                    Ok(Ok(reply)) => Some(reply),
                    Ok(Err(_)) => Some(protocol::err("The Wraithgrid window closed.")),
                    Err(_) => {
                        self.lock().relays.remove(&rid);
                        Some(protocol::err("The Wraithgrid window did not answer."))
                    }
                }
            }
            ClientFrame::Shutdown { id, exit } => {
                self.stop_all().await;
                self.reply(client, id, json!({ "ok": true }));
                if exit {
                    // Give the reply a moment to leave before the process goes.
                    let backlog = self
                        .lock()
                        .clients
                        .get(&client)
                        .map(|c| Arc::clone(&c.backlog));
                    if let Some(b) = backlog {
                        let until = Instant::now() + Duration::from_millis(500);
                        while b.load(Ordering::Relaxed) > 0 && Instant::now() < until {
                            tokio::time::sleep(Duration::from_millis(5)).await;
                        }
                    }
                    (self.cfg.on_exit)();
                } else {
                    self.lock().stopping = false;
                }
                None
            }
            _ => None,
        }
    }

    /// Stops every pane (signal, quit, shutdown).
    pub async fn stop_all(&self) {
        let ptys: Vec<Pty> = {
            let mut s = self.lock();
            s.stopping = true;
            s.panes.clear();
            s.ptys.drain().map(|(_, (_, p))| p).collect()
        };
        let kills: Vec<_> = ptys.into_iter().map(|p| tokio::spawn(p.kill())).collect();
        for k in kills {
            let _ = k.await;
        }
    }

    fn on_data(&self, pane_id: &str, gen: u64, data: &str) {
        let mut s = self.lock();
        let Some(entry) = s.panes.get_mut(pane_id) else {
            return;
        };
        if entry.gen != gen {
            return;
        }
        entry.screen.write(data);
        let now = Instant::now();
        let echo = entry
            .last_input_at
            .is_some_and(|t| now.duration_since(t) <= ECHO_WINDOW);
        if !echo {
            entry.last_output_at = Some(now);
        }
        let frame = protocol::data(pane_id, data, false);
        for c in s.clients.values_mut() {
            if c.attached.contains(pane_id) {
                c.send(&frame);
            }
        }
    }

    fn on_exit(self: &Arc<Self>, pane_id: &str, gen: u64, exit_code: i64, signal: Option<i64>) {
        let mut s = self.lock();
        // Only the current process of a pane reports; a replaced or killed one is silent.
        match s.ptys.get(pane_id) {
            Some((g, _)) if *g == gen => {}
            _ => return,
        }
        s.ptys.remove(pane_id);
        if !s.panes.get(pane_id).is_some_and(|e| e.gen == gen) {
            return;
        }
        let waiting: Vec<u64> = s
            .waiters
            .iter()
            .filter(|(_, w)| w.pane_id == pane_id)
            .map(|(k, _)| *k)
            .collect();
        for k in waiting {
            if let Some(mut w) = s.waiters.remove(&k) {
                let reply = if w.until == PaneState::Exited {
                    json!({ "ok": true, "state": "exited" })
                } else {
                    protocol::err(&format!("The pane exited (code {exit_code})."))
                };
                if let Some(done) = w.done.take() {
                    let _ = done.send(reply);
                }
            }
        }
        let frame = protocol::exit(pane_id, exit_code, signal);
        let mut gui_saw = false;
        let mut watchers = Vec::new();
        for (k, c) in s.clients.iter_mut() {
            if c.attached.contains(pane_id) {
                c.send(&frame);
                gui_saw |= c.role == Role::Gui;
                watchers.push(*k);
            }
        }
        if gui_saw {
            drop_pane(&mut s, pane_id);
        } else {
            // No window saw it end: keep the screen and the code for the next attach.
            if let Some(e) = s.panes.get_mut(pane_id) {
                e.exit = Some((exit_code, signal));
            }
            for k in watchers {
                if let Some(c) = s.clients.get_mut(&k) {
                    c.attached.remove(pane_id);
                }
            }
        }
        drop(s);
        self.check_idle();
    }

    /// One tick of a `wait`; false once it is answered.
    fn check_wait(&self, wid: u64) -> bool {
        let mut s = self.lock();
        let Some(w) = s.waiters.get(&wid) else {
            return false;
        };
        let pane_id = w.pane_id.clone();
        let now = Instant::now();
        let state = match s.panes.get_mut(&pane_id) {
            None => {
                if let Some(mut w) = s.waiters.remove(&wid) {
                    if let Some(done) = w.done.take() {
                        let _ = done.send(protocol::err(&format!("Pane {pane_id} is gone.")));
                    }
                }
                return false;
            }
            Some(e) => pane_state(e, now),
        };
        let Some(w) = s.waiters.get_mut(&wid) else {
            return false;
        };
        let met = if w.until == PaneState::Idle {
            w.idle_since = if state == PaneState::Idle {
                Some(w.idle_since.unwrap_or(now))
            } else {
                None
            };
            w.idle_since
                .is_some_and(|t| now.duration_since(t) >= w.quiet)
        } else {
            state == w.until
        };
        let timed_out = now >= w.deadline;
        if !met && !timed_out {
            return true;
        }
        let reply = if met {
            json!({ "ok": true, "state": state.as_str() })
        } else {
            protocol::err(&format!("Timed out; the pane is {}.", state.as_str()))
        };
        if let Some(mut w) = s.waiters.remove(&wid) {
            if let Some(done) = w.done.take() {
                let _ = done.send(reply);
            }
        }
        false
    }

    /// No pane and no client for ten minutes: the host exits.
    fn check_idle(self: &Arc<Self>) {
        let mut s = self.lock();
        s.idle_gen += 1;
        if !(s.clients.is_empty() && s.ptys.is_empty()) {
            return;
        }
        let gen = s.idle_gen;
        drop(s);
        let weak = Arc::downgrade(self);
        tokio::spawn(async move {
            tokio::time::sleep(IDLE_EXIT).await;
            let Some(h) = weak.upgrade() else { return };
            let s = h.lock();
            if s.idle_gen == gen && s.clients.is_empty() && s.ptys.is_empty() {
                drop(s);
                (h.cfg.on_exit)();
            }
        });
    }
}

/// What a pane is doing, read the way the window reads it, plus its screen for `blocked`.
fn pane_state(e: &mut PaneEntry, now: Instant) -> PaneState {
    if e.exit.is_some() {
        return PaneState::Exited;
    }
    if let Some(re) = &e.approval {
        if re.is_match(&e.screen.text(None)) {
            return PaneState::Blocked;
        }
    }
    let since = |t: Option<Instant>| t.map(|t| now.duration_since(t));
    let input_newer = match (e.last_input_at, e.last_output_at) {
        (Some(i), Some(o)) => i > o,
        (Some(_), None) => true,
        _ => false,
    };
    if input_newer && since(e.last_input_at).is_some_and(|d| d < PENDING_INPUT) {
        return PaneState::Running;
    }
    if since(e.last_output_at).is_some_and(|d| d < RUNNING_WINDOW) {
        PaneState::Running
    } else {
        PaneState::Idle
    }
}

fn drop_pane(s: &mut State, pane_id: &str) {
    if s.panes.remove(pane_id).is_some() {
        for c in s.clients.values_mut() {
            c.attached.remove(pane_id);
        }
    }
}

/// Constant-time comparison, as the Node host's timingSafeEqual.
fn token_matches(given: &str, token: &str) -> bool {
    let (a, b) = (given.as_bytes(), token.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// `String(value)` in JavaScript, for an error that isn't a string.
fn js_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::Array(a) => a.iter().map(js_string).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".to_string(),
        Value::Null => "null".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_compare_whole() {
        assert!(token_matches("abc", "abc"));
        assert!(!token_matches("abd", "abc"));
        assert!(!token_matches("ab", "abc"));
    }

    #[test]
    fn errors_read_like_javascript_strings() {
        assert_eq!(js_string(&json!(3)), "3");
        assert_eq!(js_string(&json!({ "a": 1 })), "[object Object]");
    }
}
