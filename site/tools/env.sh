# Source from the repo root: . site/tools/env.sh
# Sets the showcase run dir, port and libfaketime path, keeping any value already exported.
export MIHARCHY_VERIFY_DIR=${MIHARCHY_VERIFY_DIR:-${TMPDIR:-/tmp}/miharchy-verify/showcase}
export MIHARCHY_VERIFY_PORT=${MIHARCHY_VERIFY_PORT:-4648}
local_faketime=$MIHARCHY_VERIFY_DIR/libfaketime/src/libfaketime-time64.so.1
[ -f "$local_faketime" ] && export FAKETIME_LIB=${FAKETIME_LIB:-$local_faketime}
unset local_faketime
T=site/tools S=.claude/skills/verify-miharchy/scripts
