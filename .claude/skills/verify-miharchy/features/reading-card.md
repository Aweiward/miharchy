# Reading card

An overlay over History: chapters read in the last 7 days, manga in progress, the streak, up to 3 covers and the dates, in the theme's colors (`ReadingCard.js`, `ReadingCard.qml`). `docs/agents/library.md` has the rules.

## Sub-features
- `S` saves `reading-card-YYYY-MM-DD.png`, 2400 × 1350, into the "Save pages to" folder (`pageFolder`, default `~/Pictures/Miharchy`, so `$RUN/home/Pictures/Miharchy` in a drive).
- `Y` copies it: `wl-copy --type image/png` with the PNG on stdin.
- `h` hides or shows the covers: global meta `miharchy.readingCardCovers` (`shown`, `hidden`).
- Esc, `q`, `Backspace` or `c` close it; a view key (`1` to `5`) closes it and switches.
- An empty week renders 0, 0, 0 with a line instead of covers (node test only so far).

## How to get to it (user POV)
`c` on History (`3`), or `:` → "Reading card".

## Seeding reads across days
Suwayomi stamps `lastReadAt` with its own clock on a `lastPageRead` save. A restored backup's `BackupHistory` keeps its own time, so `scripts/history.py` builds a minimal `.tachibk` (each named chapter read, with a history entry at its local time) and restores it through `restoreBackup`, then prints each chapter's `lastReadAt` read back with `ok`:
```sh
.claude/skills/verify-miharchy/scripts/seed.sh --library 4
.claude/skills/verify-miharchy/scripts/history.py 1=2026-10-09T21:00 2=2026-10-08T20:00 3=2026-10-03T12:00 7=2026-10-08T09:00 8=2026-10-07T23:50 9=2026-10-07T23:55 12=2026-10-06T00:05 4=2026-10-04T18:00 13=2026-09-19T10:00 5=2026-08-30T10:00
```
Take the chapter ids from `gql.sh '{ mangas(condition: { inLibrary: true }) { nodes { id chapters { nodes { id } } } } }'` and pick times before now. Work the expected numbers out by hand before the drive. With the seed above on 2026-10-09 at 22:30 (manga 1 has chapters 1 to 3, all read): chapters 8, in progress 3 (manga 1 has nothing unread), streak 4 (Oct 9 to Oct 6, a gap on Oct 5), covers of manga 1, 3, 4.

## Driving it with drive.sh
Copy a theme into the run home first (`site/tools/README.md`, step 1), and put a logging `wl-copy` stub first on `PATH` (`PATH=<stubs>:/usr/bin:/bin drive.sh ...`).
```js
[
  [3000, function() { key("3") }],
  [3000, function() { key("c") }],
  [5000, function() { log("card", { phase: readingCard.phase, rows: readingCard.rows.length, card: readingCard.card, covers: readingCard.coversShown }); grab("card") }],
  [200, function() { key("S") }],
  [6000, function() { log("save", readingCard.note) }],
  [200, function() { key("Y") }],
  [4000, function() { log("copy", readingCard.note); key("h") }],
  [3000, function() { log("hidden", readingCard.coversShown); grab("nocovers"); done() }]
]
```
Proof: the logged numbers match the hand count; `file $RUN/home/Pictures/Miharchy/reading-card-*.png` says 2400 x 1350 (read the PNG too: covers drawn, not blank); the stub logged `--type image/png` and its stdin is the same PNG; `gql.sh '{ metas(filter: { key: { startsWith: "miharchy.readingCard" } }) { nodes { key value } } }'` reads `hidden`, and a second drive that opens the card with `root.run("readingCard.open")` logs `coversShown` false.
