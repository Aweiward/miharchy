#!/usr/bin/env bash
# images.sh: convert the captures in $RUN/evidence into site/img/*.webp and copy the logo into site/.
# The bar-popup crop fits mark/harness.qml's 760x800 window at QT_SCALE_FACTOR=2 (mark.sh).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
source "$here/../../.claude/skills/verify-miharchy/scripts/env.sh"
site=$REPO/site
# steps/card.js saves the reading card with S, at its native 2400x1350, into the run home.
card=$(ls -t "$RUN"/home/Pictures/Miharchy/reading-card-*.png 2>/dev/null | head -1 || true)
[ -n "$card" ] && cp "$card" "$EVIDENCE/reading-card.png"
for f in g1-library g2-manga g3-reader-paged w-40000 g5-updates g6-browse mark-popup reading-card; do
  [ -f "$EVIDENCE/$f.png" ] || { echo "missing $EVIDENCE/$f.png" >&2; exit 1; }
done
mkdir -p "$site/img"
magick "$EVIDENCE/g1-library.png" -quality 82 "$site/img/library.webp"
magick "$EVIDENCE/g2-manga.png" -quality 82 "$site/img/manga.webp"
magick "$EVIDENCE/g3-reader-paged.png" -quality 82 "$site/img/reader-paged.webp"
magick "$EVIDENCE/w-40000.png" -quality 82 "$site/img/reader-webtoon.webp"
magick "$EVIDENCE/g5-updates.png" -quality 82 "$site/img/updates.webp"
magick "$EVIDENCE/g6-browse.png" -quality 82 "$site/img/browse.webp"
magick "$EVIDENCE/mark-popup.png" -crop 1520x1600+0+0 +repage -quality 88 "$site/img/bar-popup.webp"
magick "$EVIDENCE/reading-card.png" -quality 88 "$site/img/reading-card.webp"
cp "$REPO/icons/miharchy.svg" "$site/miharchy.svg"
ls -la "$site/img"
