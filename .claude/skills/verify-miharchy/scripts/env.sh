# Sourced by the other scripts. One run = one directory and one port.
# MIHARCHY_VERIFY_DIR  run directory (default: ${TMPDIR:-/tmp}/miharchy-verify/run)
# MIHARCHY_VERIFY_PORT scratch server port (default 4591; never 4590, the user's server)
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)
RUN=${MIHARCHY_VERIFY_DIR:-${TMPDIR:-/tmp}/miharchy-verify/run}
PORT=${MIHARCHY_VERIFY_PORT:-4591}
SERVER_DIR=$RUN/server
SERVER_JSON=$RUN/server.json
EVIDENCE=$RUN/evidence
if [ "$PORT" = 4590 ]; then echo "refusing port 4590: that is the user's real server" >&2; exit 1; fi
