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
# Setup probes the real machine (systemd unit, Java, ...) and jumps to Setup
# when a step is due; the one-time offer also writes meta. Verification wants
# the view it drives, so both jumps are off in the copy.
python3 - "$copy/window/SetupView.qml" "$copy/window/shell.qml" <<'PY'
import sys
view, shell = sys.argv[1:]
s = open(view).read(); s = s.replace("  function offer() {\n", "  function offer() {\n    return\n", 1); open(view, "w").write(s)
s = open(shell).read()
assert 'onNeeded: if (root.view === "library") root.view = "setup"' in s, "shell.qml onNeeded changed; update drive.sh"
s = s.replace('onNeeded: if (root.view === "library") root.view = "setup"', "onNeeded: {}", 1); open(shell, "w").write(s)
PY
python3 - "$copy/window/shell.qml" "$here/driver.qml.part" "$steps" "$EVIDENCE" <<'PY'
import sys
shell, part, steps, ev = sys.argv[1:]
s = open(shell).read()
d = open(part).read().replace("@EVIDENCE@", ev).replace("@STEPS@", open(steps).read())
i = s.rindex("}"); open(shell, "w").write(s[:i] + d + s[i:])
PY
cd "$RUN"
set +e
MIHARCHY_SERVER_JSON=$SERVER_JSON QT_QPA_PLATFORM=offscreen timeout "$secs" quickshell -p "$copy/window" > "$RUN/window.log" 2>&1
code=$?
set -e
grep -o 'DRIVER .*' "$RUN/window.log" | cut -c8- | tee "$EVIDENCE/drive.log"
grep -E 'ERROR|TypeError|ReferenceError|is not a type' "$RUN/window.log" | grep -v -E 'portal|DBus' | head -5 >&2 || true
[ "$code" = 0 ] || [ "$code" = 124 ] || { echo "quickshell exited $code; see $RUN/window.log" >&2; exit "$code"; }
