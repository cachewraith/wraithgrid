#!/usr/bin/env bash
# Stand-in for ssh in e2e tests (WRAITHGRID_SSH): skips the options and the host, then runs
# the remote command on "the other machine", which is this computer with its own home,
# user-data dir and PATH (WG_REMOTE_*), so it starts a host of its own. `wraithgrid …` runs
# the app under test; anything else (the Rust host's preflight, upload and bridge) runs in
# that home through sh, as ssh runs it through the login shell.
while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done
shift 2 # "--" and the host
remote_env=(env HOME="$WG_REMOTE_HOME" WRAITHGRID_USER_DATA_DIR="$WG_REMOTE_DATA"
  PATH="$WG_REMOTE_PATH:/usr/bin:/bin" TERM=dumb)
if [ "$1" = "wraithgrid" ]; then
  shift
  exec "${remote_env[@]}" "$WG_ELECTRON" "$WG_MAIN" "$@"
fi
cd "$WG_REMOTE_HOME" || exit 2
exec "${remote_env[@]}" /bin/sh -c "$*"
