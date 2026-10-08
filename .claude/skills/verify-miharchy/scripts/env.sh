# Sourced by the other scripts. One run = one directory and one port.
# MIHARCHY_VERIFY_DIR  run directory (default: ${TMPDIR:-/tmp}/miharchy-verify/<checkout folder name>,
#                      so each worktree gets its own run)
# MIHARCHY_VERIFY_PORT scratch server port (default: the one `server.sh start` picked, kept in $RUN/port;
#                      never 4590, the user's server)
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)
RUN=${MIHARCHY_VERIFY_DIR:-${TMPDIR:-/tmp}/miharchy-verify/$(basename "$REPO")}
PORT=${MIHARCHY_VERIFY_PORT:-$(cat "$RUN/port" 2>/dev/null || true)}
SERVER_DIR=$RUN/server
SERVER_JSON=$RUN/server.json
EVIDENCE=$RUN/evidence
if [ "$PORT" = 4590 ]; then echo "refusing port 4590: that is the user's real server" >&2; exit 1; fi

# A fresh access token from the server's ui_login, empty when the login fails.
token() {
  jq -n --slurpfile c "$SERVER_JSON" '{query: "mutation($u: String!, $p: String!) { login(input: {username: $u, password: $p}) { accessToken } }", variables: {u: $c[0].username, p: $c[0].password}}' \
    | curl -s -m 30 -H 'content-type: application/json' -X POST -d @- "http://127.0.0.1:$PORT/api/graphql" \
    | jq -r '.data.login.accessToken // empty' 2>/dev/null || true
}

# Runs "$@" with the environment a verify run gives the window: the run's own
# home (the sync helper and its baselines), runtime dir (server images and
# Quickshell's IPC, list and logs), server and offscreen platform.
window_env() {
  mkdir -p "$RUN/home"
  install -d -m 700 "$RUN/runtime"
  HOME=$RUN/home XDG_RUNTIME_DIR=$RUN/runtime JAVA_OPTS=-Duser.home=$RUN/home MIHARCHY_SERVER_JSON=$SERVER_JSON MIHARCHY_SERVER_ROOT=$SERVER_DIR MIHARCHY_SERVER_TMPDIR=$SERVER_DIR/tmp QT_QPA_PLATFORM=offscreen "$@"
}
