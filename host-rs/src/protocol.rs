//! The wire format of `src/host/protocol.ts` (PROTOCOL_VERSION 1): newline-delimited JSON,
//! every client frame checked on arrival with the same limits as the zod schemas.

use serde_json::{json, Map, Value};

pub const PROTOCOL_VERSION: i64 = 1;
/// Largest frame accepted; a write is capped at 1 MB of text, JSON escaping can triple it.
pub const MAX_FRAME: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Gui,
    Cli,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaneState {
    Running,
    Idle,
    Blocked,
    Exited,
}

impl PaneState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Idle => "idle",
            Self::Blocked => "blocked",
            Self::Exited => "exited",
        }
    }
    fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "running" => Self::Running,
            "idle" => Self::Idle,
            "blocked" => Self::Blocked,
            "exited" => Self::Exited,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone)]
pub enum Args {
    List(Vec<String>),
    /// A prebuilt command line (Windows `.cmd` shims); on POSIX one argument.
    Line(String),
}

#[derive(Debug, Clone)]
pub struct SpawnRequest {
    pub pane_id: String,
    pub file: String,
    pub args: Args,
    pub cwd: String,
    pub env: Vec<(String, String)>,
    pub cols: u16,
    pub rows: u16,
    pub approval: Option<String>,
}

#[derive(Debug, Clone)]
pub enum ClientFrame {
    /// `protocol` is checked to be an integer; the client compares versions, not the host.
    Hello {
        token: String,
        role: Role,
    },
    Create {
        id: u64,
        req: SpawnRequest,
    },
    Spawn {
        id: u64,
    },
    Attach {
        id: u64,
        pane_id: String,
        cols: u16,
        rows: u16,
    },
    List {
        id: u64,
    },
    Write {
        pane_id: String,
        data: String,
    },
    Resize {
        pane_id: String,
        cols: u16,
        rows: u16,
    },
    Kill {
        pane_id: String,
    },
    Shutdown {
        id: u64,
        exit: bool,
    },
    Read {
        id: u64,
        pane_id: String,
        lines: Option<usize>,
    },
    Wait {
        id: u64,
        pane_id: String,
        until: PaneState,
        quiet_ms: u64,
        timeout_ms: u64,
    },
    Gui {
        id: u64,
        action: Map<String, Value>,
    },
    GuiReply {
        id: u64,
        reply: Map<String, Value>,
    },
    Config {
        cli_access: bool,
    },
}

impl ClientFrame {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Hello { .. } => "hello",
            Self::Create { .. } => "create",
            Self::Spawn { .. } => "spawn",
            Self::Attach { .. } => "attach",
            Self::List { .. } => "list",
            Self::Write { .. } => "write",
            Self::Resize { .. } => "resize",
            Self::Kill { .. } => "kill",
            Self::Shutdown { .. } => "shutdown",
            Self::Read { .. } => "read",
            Self::Wait { .. } => "wait",
            Self::Gui { .. } => "gui",
            Self::GuiReply { .. } => "guiReply",
            Self::Config { .. } => "config",
        }
    }

    /// The request id, for frames that are answered.
    pub fn id(&self) -> Option<u64> {
        match self {
            Self::Create { id, .. }
            | Self::Spawn { id }
            | Self::Attach { id, .. }
            | Self::List { id }
            | Self::Shutdown { id, .. }
            | Self::Read { id, .. }
            | Self::Wait { id, .. }
            | Self::Gui { id, .. }
            | Self::GuiReply { id, .. } => Some(*id),
            _ => None,
        }
    }
}

/// JavaScript string length (UTF-16 code units), which is what the zod limits count.
fn js_len(s: &str) -> usize {
    s.encode_utf16().count()
}

fn string(o: &Map<String, Value>, k: &str, min: usize, max: usize) -> Option<String> {
    let s = o.get(k)?.as_str()?;
    let n = js_len(s);
    (n >= min && n <= max).then(|| s.to_string())
}

fn int(o: &Map<String, Value>, k: &str, min: i64, max: i64) -> Option<i64> {
    let v = o.get(k)?;
    let n = if let Some(n) = v.as_i64() {
        n
    } else {
        // 3.0 is an integer to zod; 3.5 is not.
        let f = v.as_f64()?;
        if f.fract() != 0.0 || !f.is_finite() {
            return None;
        }
        f as i64
    };
    (n >= min && n <= max).then_some(n)
}

fn id(o: &Map<String, Value>) -> Option<u64> {
    int(o, "id", 0, i64::MAX).map(|n| n as u64)
}

fn dim(o: &Map<String, Value>, k: &str) -> Option<u16> {
    int(o, k, 1, 1000).map(|n| n as u16)
}

/// `idSchema` in src/shared/schema.ts: 1..64 of `[A-Za-z0-9_-]`.
fn pane_id(o: &Map<String, Value>, k: &str) -> Option<String> {
    let s = o.get(k)?.as_str()?;
    let ok = !s.is_empty()
        && s.len() <= 64
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    ok.then(|| s.to_string())
}

fn record(o: &Map<String, Value>, k: &str) -> Option<Map<String, Value>> {
    o.get(k)?.as_object().cloned()
}

fn spawn_request(v: &Value) -> Option<SpawnRequest> {
    let o = v.as_object()?;
    let args = match o.get("args")? {
        Value::Array(items) if items.len() <= 64 => Args::List(
            items
                .iter()
                .map(|a| {
                    a.as_str()
                        .filter(|s| js_len(s) <= 32_000)
                        .map(str::to_string)
                })
                .collect::<Option<Vec<_>>>()?,
        ),
        Value::String(s) if js_len(s) <= 32_000 => Args::Line(s.clone()),
        _ => return None,
    };
    let env = o
        .get("env")?
        .as_object()?
        .iter()
        .map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
        .collect::<Option<Vec<_>>>()?;
    let approval = match o.get("approval") {
        None => None,
        Some(v) => Some(v.as_str().filter(|s| js_len(s) <= 2000)?.to_string()),
    };
    Some(SpawnRequest {
        pane_id: pane_id(o, "paneId")?,
        file: string(o, "file", 1, 4096)?,
        args,
        cwd: string(o, "cwd", 1, 4096)?,
        env,
        cols: dim(o, "cols")?,
        rows: dim(o, "rows")?,
        approval,
    })
}

/// A client frame, or None when it doesn't match the schema (the client is then dropped).
pub fn parse_client_frame(v: &Value) -> Option<ClientFrame> {
    let o = v.as_object()?;
    Some(match o.get("t")?.as_str()? {
        "hello" => ClientFrame::Hello {
            // protocol and appVersion are checked but not used by the host.
            token: {
                int(o, "protocol", i64::MIN, i64::MAX)?;
                string(o, "appVersion", 0, 64)?;
                string(o, "token", 0, 256)?
            },
            role: match o.get("role") {
                None => Role::Gui,
                Some(r) => match r.as_str()? {
                    "gui" => Role::Gui,
                    "cli" => Role::Cli,
                    _ => return None,
                },
            },
        },
        "create" => ClientFrame::Create {
            id: id(o)?,
            req: spawn_request(o.get("req")?)?,
        },
        "spawn" => {
            record(o, "spec")?;
            ClientFrame::Spawn { id: id(o)? }
        }
        // A plan is the bridge's to resolve (bridge.rs); a host reached directly refuses it.
        "plan" => {
            record(o, "plan")?;
            ClientFrame::Spawn { id: id(o)? }
        }
        "attach" => ClientFrame::Attach {
            id: id(o)?,
            pane_id: pane_id(o, "paneId")?,
            cols: dim(o, "cols")?,
            rows: dim(o, "rows")?,
        },
        "list" => ClientFrame::List { id: id(o)? },
        "write" => ClientFrame::Write {
            pane_id: pane_id(o, "paneId")?,
            data: string(o, "data", 0, 1_000_000)?,
        },
        "resize" => ClientFrame::Resize {
            pane_id: pane_id(o, "paneId")?,
            cols: dim(o, "cols")?,
            rows: dim(o, "rows")?,
        },
        "kill" => ClientFrame::Kill {
            pane_id: pane_id(o, "paneId")?,
        },
        "shutdown" => ClientFrame::Shutdown {
            id: id(o)?,
            exit: o.get("exit")?.as_bool()?,
        },
        "read" => ClientFrame::Read {
            id: id(o)?,
            pane_id: pane_id(o, "paneId")?,
            lines: match o.get("lines") {
                None => None,
                Some(_) => Some(int(o, "lines", 1, 100_000)? as usize),
            },
        },
        "wait" => ClientFrame::Wait {
            id: id(o)?,
            pane_id: pane_id(o, "paneId")?,
            until: PaneState::parse(o.get("until")?.as_str()?)?,
            quiet_ms: match o.get("quietMs") {
                None => 1500,
                Some(_) => int(o, "quietMs", 0, 600_000)? as u64,
            },
            timeout_ms: int(o, "timeoutMs", 1, 86_400_000)? as u64,
        },
        "gui" => ClientFrame::Gui {
            id: id(o)?,
            action: record(o, "action")?,
        },
        "guiReply" => ClientFrame::GuiReply {
            id: id(o)?,
            reply: record(o, "reply")?,
        },
        "config" => ClientFrame::Config {
            cli_access: o.get("cliAccess")?.as_bool()?,
        },
        _ => return None,
    })
}

/// JavaScript may send a lone surrogate (`"\ud800"`), which strict JSON parsers refuse; the
/// Node host takes it. Such escapes become U+FFFD so one stray key never drops the window.
pub fn mend_surrogates(line: &str) -> std::borrow::Cow<'_, str> {
    if !line.contains("\\u") {
        return std::borrow::Cow::Borrowed(line);
    }
    let b = line.as_bytes();
    let hex = |i: usize| -> Option<u16> {
        let s = line.get(i..i + 4)?;
        u16::from_str_radix(s, 16).ok()
    };
    let mut out = String::with_capacity(line.len());
    let mut i = 0;
    let mut changed = false;
    while i < b.len() {
        if b[i] == b'\\' && i + 1 < b.len() {
            if b[i + 1] == b'u' {
                if let Some(u) = hex(i + 2) {
                    let is_high = (0xD800..0xDC00).contains(&u);
                    let is_low = (0xDC00..0xE000).contains(&u);
                    if is_high {
                        let low = (b.get(i + 6) == Some(&b'\\') && b.get(i + 7) == Some(&b'u'))
                            .then(|| hex(i + 8))
                            .flatten();
                        if let Some(l) = low.filter(|l| (0xDC00..0xE000).contains(l)) {
                            let _ = l;
                            out.push_str(&line[i..i + 12]);
                            i += 12;
                            continue;
                        }
                        out.push_str("\\ufffd");
                        changed = true;
                        i += 6;
                        continue;
                    }
                    if is_low {
                        out.push_str("\\ufffd");
                        changed = true;
                        i += 6;
                        continue;
                    }
                }
            }
            // Any other escape: copy both bytes so an escaped backslash isn't misread.
            out.push_str(&line[i..i + 2]);
            i += 2;
            continue;
        }
        let ch = line[i..].chars().next().unwrap_or('\u{fffd}');
        out.push(ch);
        i += ch.len_utf8();
    }
    if changed {
        std::borrow::Cow::Owned(out)
    } else {
        std::borrow::Cow::Borrowed(line)
    }
}

/// A reattached screen goes out in pieces of this many UTF-16 units (#134), as the Node host
/// does: escaping can make one character six bytes, so a piece stays under `MAX_FRAME`.
pub const REPLAY_CHUNK: usize = 512 * 1024;

/// Splits a replay into consecutive pieces of at most `max` UTF-16 units (whole characters).
pub fn chunk_replay(text: &str, max: usize) -> Vec<&str> {
    let mut out = Vec::new();
    let mut start = 0;
    let mut units = 0;
    for (i, c) in text.char_indices() {
        let n = c.len_utf16();
        if units + n > max && i > start {
            out.push(&text[start..i]);
            start = i;
            units = 0;
        }
        units += n;
    }
    if start < text.len() {
        out.push(&text[start..]);
    }
    out
}

pub fn encode(frame: &Value) -> String {
    let mut s = frame.to_string();
    s.push('\n');
    s
}

pub fn welcome(app_version: &str, pid: u32) -> Value {
    json!({ "t": "welcome", "protocol": PROTOCOL_VERSION, "appVersion": app_version, "pid": pid })
}

pub fn refused(error: &str) -> Value {
    json!({ "t": "refused", "error": error })
}

pub fn reply(id: u64, reply: Value) -> Value {
    json!({ "t": "reply", "id": id, "reply": reply })
}

pub fn data(pane_id: &str, data: &str, replay: bool) -> Value {
    if replay {
        json!({ "t": "data", "paneId": pane_id, "data": data, "replay": true })
    } else {
        json!({ "t": "data", "paneId": pane_id, "data": data })
    }
}

pub fn exit(pane_id: &str, exit_code: i64, signal: Option<i64>) -> Value {
    json!({ "t": "exit", "paneId": pane_id, "exitCode": exit_code, "signal": signal })
}

pub fn gui(id: u64, action: &Map<String, Value>) -> Value {
    json!({ "t": "gui", "id": id, "action": action })
}

pub fn err(error: &str) -> Value {
    json!({ "ok": false, "error": error })
}

pub fn missing(error: &str) -> Value {
    json!({ "ok": false, "error": error, "missing": true })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(s: &str) -> Option<ClientFrame> {
        parse_client_frame(&serde_json::from_str(s).unwrap())
    }

    #[test]
    fn hello_defaults_to_the_gui_role() {
        match parse(r#"{"t":"hello","protocol":1,"appVersion":"1.0","token":"x"}"#) {
            Some(ClientFrame::Hello {
                role: Role::Gui, ..
            }) => {}
            other => panic!("{other:?}"),
        }
        assert!(
            parse(r#"{"t":"hello","protocol":1,"appVersion":"1.0","token":"x","role":"x"}"#)
                .is_none()
        );
    }

    #[test]
    fn checks_the_same_limits_as_zod() {
        assert!(parse(r#"{"t":"resize","paneId":"p1","cols":80,"rows":24}"#).is_some());
        assert!(parse(r#"{"t":"resize","paneId":"p1","cols":0,"rows":24}"#).is_none());
        assert!(parse(r#"{"t":"resize","paneId":"p1","cols":1001,"rows":24}"#).is_none());
        assert!(parse(r#"{"t":"resize","paneId":"p 1","cols":80,"rows":24}"#).is_none());
        assert!(parse(r#"{"t":"list","id":-1}"#).is_none());
        assert!(parse(r#"{"t":"list","id":2.5}"#).is_none());
        assert!(parse(r#"{"t":"list","id":2.0}"#).is_some());
        assert!(parse(r#"{"t":"nope","id":1}"#).is_none());
        match parse(r#"{"t":"wait","id":1,"paneId":"p","until":"idle","timeoutMs":5}"#) {
            Some(ClientFrame::Wait { quiet_ms: 1500, .. }) => {}
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_create_needs_a_whole_spawn_request() {
        let ok = r#"{"t":"create","id":1,"req":{"paneId":"p1","file":"/bin/sh","args":["-c","true"],"cwd":"/","env":{"A":"1"},"cols":80,"rows":24}}"#;
        assert!(parse(ok).is_some());
        assert!(parse(&ok.replace(r#""env":{"A":"1"}"#, r#""env":{"A":1}"#)).is_none());
        assert!(parse(&ok.replace(r#""file":"/bin/sh""#, r#""file":"""#)).is_none());
        match parse(&ok.replace(r#"["-c","true"]"#, r#""-c true""#)) {
            Some(ClientFrame::Create { req, .. }) => assert!(matches!(req.args, Args::Line(_))),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_replay_is_split_into_whole_characters() {
        assert!(chunk_replay("", 4).is_empty());
        assert_eq!(chunk_replay("abcdefghij", 4), ["abcd", "efgh", "ij"]);
        // An emoji is two UTF-16 units and is never split.
        assert_eq!(chunk_replay("ab😀cd", 3), ["ab", "😀c", "d"]);
        let big = "x".repeat(REPLAY_CHUNK * 2 + 5);
        let parts = chunk_replay(&big, REPLAY_CHUNK);
        assert_eq!(parts.len(), 3);
        assert_eq!(parts.concat(), big);
    }

    #[test]
    fn lone_surrogates_are_mended_pairs_kept() {
        assert_eq!(
            mend_surrogates(r#"{"d":"a\ud800b"}"#),
            r#"{"d":"a\ufffdb"}"#
        );
        assert_eq!(mend_surrogates(r#"{"d":"\udc00"}"#), r#"{"d":"\ufffd"}"#);
        let pair = r#"{"d":"\ud83d\ude00"}"#;
        assert_eq!(mend_surrogates(pair), pair);
        let escaped = r#"{"d":"\\ud800"}"#;
        assert_eq!(mend_surrogates(escaped), escaped);
        let v: Value = serde_json::from_str(&mend_surrogates(r#"{"d":"x\ud800"}"#)).unwrap();
        assert_eq!(v["d"], "x\u{fffd}");
    }
}
