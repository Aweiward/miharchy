#!/usr/bin/env bash
# mark.sh: render the real plugin/Mark.qml offscreen in a stand-in bar against the verify run's
# scratch core, then with its popup open: $RUN/evidence/mark-bar.png and mark-popup.png.
# It copies the shell's Commons and Ui into $RUN/mark/root, with KeyboardPanel.qml swapped for a
# stub that draws as a plain Item (the real one is a layer-shell surface grabToImage cannot see),
# and copies plugin/, window/ and icons/ into $RUN/mark/clone, laid out like an installed clone.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
source "$here/../../.claude/skills/verify-miharchy/scripts/env.sh"
shell=${OMARCHY_PATH:-$HOME/.local/share/omarchy}/shell
[ -d "$shell/Commons" ] || { echo "no Omarchy shell at $shell; set OMARCHY_PATH" >&2; exit 1; }
[ -f "$RUN/core/core.json" ] || { echo "no $RUN/core/core.json: start the scratch core first (start-at 0)" >&2; exit 1; }
root=$RUN/mark/root clone=$RUN/mark/clone
rm -rf "$root" "$clone"; mkdir -p "$root" "$clone" "$EVIDENCE"
cp -r "$shell/Commons" "$shell/Ui" "$root/"
cp "$here/mark/KeyboardPanel.qml" "$root/Ui/KeyboardPanel.qml"
cp "$here/mark/harness.qml" "$root/shell.qml"
cp -r "$REPO/plugin" "$REPO/window" "$REPO/icons" "$clone/"
HOME=$RUN/home MIHARCHY_CORE_CONFIG=$RUN/core/core.json MIHARCHY_CORE_DATA=$RUN/core/data QT_QPA_PLATFORM=offscreen QT_SCALE_FACTOR=2 CLONE=$clone SHOT=$EVIDENCE/mark \
  timeout 40 quickshell -p "$root" > "$RUN/mark/run.log" 2>&1 || true
grep -E "HARNESS|ERROR|rror" "$RUN/mark/run.log" | tail -5
ls "$EVIDENCE/mark-bar.png" "$EVIDENCE/mark-popup.png"
