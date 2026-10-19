# What's new in 1.10: agents that keep running

*Unreleased (draft)*

Agents no longer stop when you close Wraithgrid. A new `wraithgrid` command lets scripts, and
agents in other panes, drive your panes, and a workspace can run its panes on another
computer over ssh.

---

## At a glance

| Feature | How to use it |
|---|---|
| Keep agents running after closing | Close the window, pick **Keep running** (or **Settings → When the window closes**) |
| Stop them later | Tray icon → **Stop all agents and quit**, or open Wraithgrid and quit with **Stop** |
| Drive panes from a terminal | **Settings → Command line**, then `wraithgrid list`, `send`, `wait`, `read`, `new`, `split` |
| Watch one pane in a terminal | `wraithgrid attach <pane>`; Ctrl+] leaves it running |
| Run a workspace on another computer | **Settings → Machines → Add machine**, then right-click an empty workspace → **Run on …** |

---

## 1. Agents keep running

Panes now run in a small background process instead of the window. Close the window (or quit)
and choose **Keep running**: the agents carry on, a tray icon shows how many, and the next
launch shows every pane exactly as it is, screen and all. A pane that ended meanwhile shows
its exit code. **Stop agents and quit** works as before. A crashed window no longer takes the
agents with it either.

## 2. The `wraithgrid` command

Off until you turn on **Settings → Command line**. Then:

```sh
wraithgrid list
wraithgrid send alpha "run the tests and fix what fails"
wraithgrid wait alpha --until idle
wraithgrid read alpha --lines 40
```

`wait --until blocked` returns when the agent asks for approval. Inside a pane,
`$WRAITHGRID_PANE` is its own id, so an agent can open a helper pane with `wraithgrid split`
and prompt it.

## 3. Attach from any terminal

`wraithgrid attach alpha` shows the pane in your terminal, keys go to it, and **Ctrl+]**
leaves it running. Over ssh, use `ssh -t`.

## 4. Other machines

Add a computer under **Settings → Machines** (a host from `~/.ssh/config`), then set an empty
workspace to **Run on** it. Its panes start there, with that computer's CLIs, folders and
logins, and keep running when you disconnect or quit. It needs Wraithgrid installed there
and ssh with a key or agent.
