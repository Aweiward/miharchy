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
Core stamps `lastReadAt` with its own clock on a `lastPageRead` save, and no route sets another time. So mark the chapters read with a page save, then move each read time into the past in `$RUN/core/data/core.db` (SKILL.md, miharchy-core). On the core seed with three or four library manga:
```sh
.claude/skills/verify-miharchy/scripts/core.sh api chapter.update '{"ids":[<ids>],"isRead":true,"lastPageRead":0}'
sqlite3 <RUN>/core/data/core.db "UPDATE history SET read_at = CAST(strftime('%s', '2026-11-20 21:00', 'utc') AS INTEGER) * 1000 WHERE chapter_id = <id>; UPDATE history SET read_at = ... WHERE chapter_id = <id>"
.claude/skills/verify-miharchy/scripts/core.sh api history.list '{"readOnly":true}' | jq -c '[.chapters[] | [.manga.id, .id, (.lastReadAt | strflocaltime("%Y-%m-%dT%H:%M"))]]'
```
Give each chapter its own `UPDATE`, at a local time before now. The last command reads back each chapter with its read time; it must match what you wrote. Take the chapter ids from `chapter.list '{"mangaIds":[<ids>]}'`. Work the expected chapters, manga in progress, streak and covers out by hand before the drive, by the rules in `docs/agents/library.md`. Recipe that ran on 2026-11-22: chapters 1 and 2 of the seeded Berserk manga written at 2026-11-20 21:00 and 2026-11-19 20:00 read back as `"2026-11-20T21:00"` and `"2026-11-19T20:00"`.

## Driving it with drive.sh
Copy a theme into the run home first (SKILL.md, Drive), and put a logging `wl-copy` stub first on `PATH` (`PATH=<stubs>:/usr/bin:/bin drive.sh ...`).
```js
[
  [3000, function() { key("3") }],
  [3000, function() { key("c") }],
  [5000, function() { log("card", { phase: readingCard.phase, rows: readingCard.rows.length, card: readingCard.card, covers: readingCard.coversShown }); grab("card") }],
  [200, function() { key("S") }],
  [6000, function() { log("save", readingCard.note) }],
  [200, function() { key("Y") }],
  [4000, function() { log("copy", readingCard.note); key("h") }],
  [3000, function() { log("hidden", readingCard.coversShown); grab("nocovers") }],
  [300, function() { done() }]
]
```
Proof: the logged numbers match the hand count; `file $RUN/home/Pictures/Miharchy/reading-card-*.png` says 2400 x 1350 (read the PNG too: covers drawn, not blank); the stub logged `--type image/png` and its stdin is the same PNG; `core.sh api meta.get '{"scope":"global","keys":["miharchy.readingCardCovers"]}'` reads `hidden`, and a second drive that opens the card with `root.run("readingCard.open")` logs `coversShown` false.
