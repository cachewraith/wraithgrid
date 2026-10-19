#!/usr/bin/env bash
# Stand-in for ssh in e2e tests (WRAITHGRID_SSH): skips the options and the host, then runs
# the remote command on "the other machine", which is this computer with its own home,
# user-data dir and PATH (WG_REMOTE_*), so it starts a host of its own.
while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done
shift 2 # "--" and the host
[ "$1" = "wraithgrid" ] || { echo "fake ssh: unexpected command $*" >&2; exit 2; }
shift
exec env HOME="$WG_REMOTE_HOME" WRAITHGRID_USER_DATA_DIR="$WG_REMOTE_DATA" \
  PATH="$WG_REMOTE_PATH:/usr/bin:/bin" TERM=dumb "$WG_ELECTRON" "$WG_MAIN" "$@"
