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
