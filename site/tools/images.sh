#!/usr/bin/env bash
# images.sh: convert the captures in $RUN/evidence into site/img/*.webp and copy the logo into site/.
# The bar-popup crop fits mark/harness.qml's 760x720 window at QT_SCALE_FACTOR=2 (mark.sh).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
source "$here/../../.claude/skills/verify-miharchy/scripts/env.sh"
site=$REPO/site
for f in g1-library g2-manga g3-reader-paged w-40000 g5-updates g6-browse mark-popup; do
  [ -f "$EVIDENCE/$f.png" ] || { echo "missing $EVIDENCE/$f.png" >&2; exit 1; }
done
mkdir -p "$site/img"
magick "$EVIDENCE/g1-library.png" -quality 82 "$site/img/library.webp"
magick "$EVIDENCE/g2-manga.png" -quality 82 "$site/img/manga.webp"
magick "$EVIDENCE/g3-reader-paged.png" -quality 82 "$site/img/reader-paged.webp"
magick "$EVIDENCE/w-40000.png" -quality 82 "$site/img/reader-webtoon.webp"
magick "$EVIDENCE/g5-updates.png" -quality 82 "$site/img/updates.webp"
magick "$EVIDENCE/g6-browse.png" -quality 82 "$site/img/browse.webp"
magick "$EVIDENCE/mark-popup.png" -crop 1520x1220+0+0 +repage -quality 88 "$site/img/bar-popup.webp"
cp "$REPO/icons/miharchy.svg" "$site/miharchy.svg"
ls -la "$site/img"
