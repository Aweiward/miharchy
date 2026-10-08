#!/usr/bin/env bash
# Drive the real window offscreen against the scratch server.
#   drive.sh <steps.js> [seconds]
# steps.js holds a JS array literal of [delayMs, function] pairs (see driver.qml.part for helpers:
# key(text|"Enter"|"Esc"|"Tab"|"Backspace"), run(commandId), grab(name), log(label, value), done()).
# Captures land in $RUN/evidence/<name>.png; the DRIVER log in $RUN/evidence/drive.log.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); source "$here/env.sh"
steps=$1; secs=${2:-120}
copy=$RUN/app
rm -rf "$copy"; mkdir -p "$copy" "$EVIDENCE"
cp -r "$REPO/window" "$copy/"
python3 "$here/patch-window.py" "$copy/window" "$steps" "$EVIDENCE"
cd "$RUN"
set +e
window_env timeout "$secs" quickshell -p "$copy/window" > "$RUN/window.log" 2>&1
code=$?
set -e
grep -o 'DRIVER .*' "$RUN/window.log" | cut -c8- | tee "$EVIDENCE/drive.log"
grep -E 'ERROR|TypeError|ReferenceError|is not a type' "$RUN/window.log" | grep -v -E 'portal|DBus' | head -5 >&2 || true
[ "$code" = 0 ] || [ "$code" = 124 ] || { echo "quickshell exited $code; see $RUN/window.log" >&2; exit "$code"; }
