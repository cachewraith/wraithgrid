//! A remote pane's plan (ADR 0004 phase 5, `src/main/remote-plan.ts`) made into the exact
//! process on this machine. The window keeps the rules; this only does what needs this
//! machine: PATH from the login shell, the first candidate that exists, the folder, `~`, and
//! applying the environment rules to this process's own environment.

use std::collections::HashSet;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde_json::{json, Map, Value};

/// How long the login shell may take to print its PATH (platform.ts uses 4 s too).
const PROBE_TIMEOUT: Duration = Duration::from_secs(4);

pub fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

/// `~` and `~/x` under `home`; a relative path is under `home` too (resolveUserPath).
pub fn user_path(p: &str, home: &Path) -> PathBuf {
    if p == "~" {
        return home.to_path_buf();
    }
    if let Some(rest) = p.strip_prefix("~/") {
        return home.join(rest);
    }
    let path = PathBuf::from(p);
    if path.is_absolute() {
        path
    } else {
        home.join(path)
    }
}

fn executable(p: &Path) -> bool {
    std::fs::metadata(p).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

fn strs(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// The PATH this machine's login shell sets up, then the inherited one, then the extra dirs,
/// without repeats (cli-entry.ts does the same for `wraithgrid host-stdio`).
pub fn login_path(probe: &Value, home: &Path) -> String {
    let mark = probe.get("mark").and_then(Value::as_str).unwrap_or("");
    let run = |file: &str, args: &[String]| -> Option<String> {
        if mark.is_empty() {
            return None;
        }
        let mut child = Command::new(file)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let mut out = child.stdout.take()?;
        let reader = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = std::io::Read::read_to_string(&mut out, &mut s);
            s
        });
        let deadline = std::time::Instant::now() + PROBE_TIMEOUT;
        loop {
            if let Ok(Some(_)) = child.try_wait() {
                break;
            }
            if std::time::Instant::now() > deadline {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let text = reader.join().ok()?;
        let start = text.find(mark)? + mark.len();
        let end = text.rfind(mark)?;
        (end > start)
            .then(|| text[start..end].trim().to_string())
            .filter(|s| !s.is_empty() && !s.contains('\n'))
    };
    let shell = std::env::var("SHELL").unwrap_or_default();
    let mut found = None;
    if !shell.is_empty() {
        let kind = shell.rsplit('/').next().unwrap_or("").to_lowercase();
        let args = probe
            .get("byKind")
            .and_then(|m| m.get(&kind))
            .map(|v| strs(Some(v)))
            .unwrap_or_else(|| strs(probe.get("otherwise")));
        found = run(&shell, &args);
    }
    if found.is_none() {
        if let Some(fb) = probe.get("fallback") {
            let file = fb.get("file").and_then(Value::as_str).unwrap_or("/bin/sh");
            found = run(file, &strs(fb.get("args")));
        }
    }
    let extra: Vec<String> = strs(probe.get("extraDirs"))
        .iter()
        .map(|d| user_path(d, home).to_string_lossy().into_owned())
        .collect();
    let inherited = std::env::var("PATH").unwrap_or_default();
    let mut seen = HashSet::new();
    found
        .unwrap_or_default()
        .split(':')
        .chain(inherited.split(':'))
        .chain(extra.iter().map(String::as_str))
        .filter(|d| !d.is_empty() && seen.insert(d.to_string()))
        .collect::<Vec<_>>()
        .join(":")
}

/// The first candidate that exists: `$SHELL`, a path, or a name on `path`.
pub fn pick(candidates: &[String], path: &str, home: &Path) -> Option<PathBuf> {
    for c in candidates {
        if c == "$SHELL" {
            if let Ok(s) = std::env::var("SHELL") {
                let p = PathBuf::from(s);
                if p.is_absolute() && executable(&p) {
                    return Some(p);
                }
            }
            continue;
        }
        if c.starts_with('/') || c.starts_with('~') {
            let p = user_path(c, home);
            if executable(&p) {
                return Some(p);
            }
            continue;
        }
        for dir in path.split(':').filter(|d| !d.is_empty()) {
            let p = Path::new(dir).join(c);
            if executable(&p) {
                return Some(p);
            }
        }
    }
    None
}

/// `applyEnvPlan` in pane-env.ts, applied to this process's environment.
pub fn apply_env(
    base: impl Iterator<Item = (String, String)>,
    plan: &Value,
    home: &Path,
) -> Map<String, Value> {
    let drop: HashSet<String> = strs(plan.get("drop")).into_iter().collect();
    let prefixes = strs(plan.get("dropPrefixes"));
    let mut env = Map::new();
    for (k, v) in base {
        let up = k.to_uppercase();
        if drop.contains(&up) || prefixes.iter().any(|p| up.starts_with(p.as_str())) {
            continue;
        }
        env.insert(k, Value::String(v));
    }
    if let Some(set) = plan.get("set").and_then(Value::as_object) {
        for (k, v) in set {
            let Some(v) = v.as_str() else { continue };
            let value = if v == "~" || v.starts_with("~/") {
                user_path(v, home).to_string_lossy().into_owned()
            } else {
                v.to_string()
            };
            env.insert(k.clone(), Value::String(value));
        }
    }
    let has_locale = ["LC_ALL", "LC_CTYPE", "LANG"].iter().any(|k| {
        env.get(*k)
            .and_then(Value::as_str)
            .is_some_and(|v| !v.is_empty())
    });
    if let Some(lang) = plan.get("lang").and_then(Value::as_str) {
        if !has_locale {
            env.insert("LANG".into(), Value::String(lang.into()));
        }
    }
    env
}

/// A `create` request for the host, or the error to answer with.
pub fn resolve(plan: &Value, path: &str) -> Result<Value, String> {
    let home = home();
    let get = |k: &str| plan.get(k).and_then(Value::as_str).unwrap_or("");
    let cwd_text = get("cwd");
    let cwd = user_path(cwd_text, &home);
    match std::fs::metadata(&cwd) {
        Ok(m) if m.is_dir() => {}
        Ok(_) => return Err(format!("Not a folder: {cwd_text}")),
        Err(_) => return Err(format!("Folder not found: {cwd_text}")),
    }
    let candidates = strs(plan.get("candidates"));
    let Some(file) = pick(&candidates, path, &home) else {
        let msg = get("notFound");
        return Err(if msg.is_empty() {
            "Nothing to run was found.".into()
        } else {
            msg.into()
        });
    };
    // The pane's PATH is the one just found, so its CLI finds what a terminal would.
    let base = std::env::vars().map(|(k, v)| {
        if k == "PATH" {
            (k, path.to_string())
        } else {
            (k, v)
        }
    });
    let mut env = apply_env(base, plan.get("env").unwrap_or(&Value::Null), &home);
    if !env.contains_key("PATH") {
        env.insert("PATH".into(), Value::String(path.into()));
    }
    let mut req = json!({
        "paneId": get("paneId"),
        "file": file.to_string_lossy(),
        "args": strs(plan.get("args")),
        "cwd": cwd.to_string_lossy(),
        "env": env,
        "cols": plan.get("cols").cloned().unwrap_or(json!(80)),
        "rows": plan.get("rows").cloned().unwrap_or(json!(24)),
    });
    if let Some(a) = plan.get("approval").and_then(Value::as_str) {
        req["approval"] = json!(a);
    }
    Ok(req)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_resolve_under_home() {
        let home = Path::new("/home/u");
        assert_eq!(user_path("~", home), PathBuf::from("/home/u"));
        assert_eq!(user_path("~/proj", home), PathBuf::from("/home/u/proj"));
        assert_eq!(user_path("proj", home), PathBuf::from("/home/u/proj"));
        assert_eq!(user_path("/srv/x", home), PathBuf::from("/srv/x"));
    }

    #[test]
    fn the_environment_follows_the_plan() {
        let plan = json!({
            "drop": ["TMUX", "CLAUDE_CONFIG_DIR"],
            "dropPrefixes": ["ELECTRON_", "VSCODE_"],
            "set": { "TERM": "xterm-256color", "CLAUDE_CONFIG_DIR": "~/.wraithgrid/accounts/work" },
            "lang": "C.UTF-8"
        });
        let base = [
            ("PATH", "/usr/bin"),
            ("tmux", "x"),
            ("CLAUDE_CONFIG_DIR", "/elsewhere"),
            ("ELECTRON_RUN_AS_NODE", "1"),
            ("vscode_pid", "9"),
            ("KEEP", "yes"),
        ]
        .map(|(k, v)| (k.to_string(), v.to_string()));
        let env = apply_env(base.into_iter(), &plan, Path::new("/home/u"));
        let keys: Vec<&String> = env.keys().collect();
        assert_eq!(keys.len(), 5, "{keys:?}");
        assert_eq!(
            env["CLAUDE_CONFIG_DIR"],
            "/home/u/.wraithgrid/accounts/work"
        );
        assert_eq!(env["TERM"], "xterm-256color");
        assert_eq!(env["LANG"], "C.UTF-8");
        assert_eq!(env["KEEP"], "yes");
        // A locale already set wins.
        let with_lc = [("LC_ALL".to_string(), "de_DE.UTF-8".to_string())];
        let env = apply_env(with_lc.into_iter(), &plan, Path::new("/h"));
        assert!(!env.contains_key("LANG"));
    }

    #[test]
    fn the_first_candidate_that_exists_runs() {
        let home = Path::new("/nonexistent-home");
        assert_eq!(
            pick(
                &["nope-not-a-binary".into(), "sh".into()],
                "/usr/bin:/bin",
                home
            ),
            Some(PathBuf::from("/usr/bin/sh"))
                .filter(|p| p.exists())
                .or(Some(PathBuf::from("/bin/sh")))
        );
        assert_eq!(pick(&["/no/such".into()], "/bin", home), None);
        assert_eq!(
            pick(&["/bin/sh".into()], "", home),
            Some(PathBuf::from("/bin/sh"))
        );
    }

    #[test]
    fn a_missing_folder_or_binary_is_an_error() {
        let plan = json!({ "paneId": "p", "cwd": "/no/such/dir", "candidates": ["sh"], "notFound": "none" });
        assert_eq!(
            resolve(&plan, "/bin").unwrap_err(),
            "Folder not found: /no/such/dir"
        );
        let plan = json!({ "paneId": "p", "cwd": "/", "candidates": ["no-such-bin-x"], "notFound": "no x here" });
        assert_eq!(resolve(&plan, "/bin").unwrap_err(), "no x here");
        let plan = json!({ "paneId": "p", "cwd": "/", "candidates": ["sh"], "args": ["-c", "true"],
            "env": { "drop": [], "dropPrefixes": [], "set": { "WRAITHGRID_PANE": "p" }, "lang": null },
            "cols": 100, "rows": 30, "approval": "proceed" });
        let req = resolve(&plan, "/usr/bin:/bin").unwrap();
        assert!(req["file"].as_str().unwrap().ends_with("/sh"));
        assert_eq!(req["args"], json!(["-c", "true"]));
        assert_eq!(req["env"]["WRAITHGRID_PANE"], "p");
        assert_eq!(req["env"]["PATH"], "/usr/bin:/bin");
        assert_eq!(req["cols"], 100);
        assert_eq!(req["approval"], "proceed");
    }
}
