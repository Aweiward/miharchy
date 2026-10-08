# Migrate

`M` on a manga's detail (one manga) or on Browse's sources (a whole source): search the other sources, pick the target, confirm. Enter migrates (the old manga leaves the library), `c` copies (it stays).

## Sub-features
- Confirm (scope `migrate-confirm`): the plan (chapters marked read and bookmarked), the categories, `d` deletes the old downloads (default yes, shown when the old manga has downloads; it applies to `c` too, `Migrate.oldPayload`), `t` takes the old manga's tracks along (default yes; shown when it has tracks, and always for a batch).
- One write to the target (`Migrate.targetPayload`): library, categories, read and bookmarked chapters, reading mode, and one `bindTrackRecord` per track. Only after it succeeds does the old manga leave the library and lose its downloads (`Migrate.oldPayload`).

## How to get to it (user POV)
Library, Enter on a manga, `M`, pick a result with `hjkl`, Enter, then Enter or `c`.

## Driving it with drive.sh
The seeded manga have no twin on another source. Use Eleceed: MangaDex and Weeb Central both carry it with chapters (MangaDex's "Solo Leveling" has none, and the pick then stops on "No chapters found"). Install Weeb Central (`seed.sh eu.kanade.tachiyomi.extension.en.weebcentral`), search both with `fetchSourceManga(type: SEARCH, query: "Eleceed")`, `fetchMangaAndChapters` both, put the MangaDex one in the library, mark chapters 1 to 3 read, bookmark 2, add it to a category and set its `miharchy.readingMode`. Then drive with `m.id === <its id>`. `M` searches the manga's title by itself, and `Enter` picks the first result of the first source. Read back: the old manga has `inLibrary: false`; the target has `inLibrary: true`, the category, the reading mode, chapters 1 to 3 read and 2 bookmarked.

A scratch server has no tracker login, but a restored backup brings track records: build a `.tachibk` with `BackupTracking` entries for a library manga (a throwaway test in a copy of `sync/` under your run dir, as `restore.md` describes), then restore it with `.claude/skills/verify-miharchy/scripts/qs.sh env sync/build/install/miharchy-sync/bin/miharchy-sync restore <file>`.
```js
[
  [5000, function() { root.libraryCursor = root.shown.manga.findIndex(function(m) { return m.id === <Eleceed's id> }); key("Enter") }],
  [6000, function() { key("M") }],
  [15000, function() { log("search", [migrateView.step, migrateView.search.groups.map(function(g) { return [g.source.name, g.state, g.items.length] })]); key("Enter") }],
  [12000, function() { log("confirm", [migrateView.step, migrateView.tracks, migrateView.job.target.id]); grab("confirm") }],
  [800, function() { key("Enter") }],
  [12000, function() { log("after", migrateView.step); done() }]
]
```
Read back: `manga(id: <target>) { inLibrary trackRecords { nodes { trackerId remoteId lastChapterRead private startDate } } }` matches the old manga's records; the old manga has `inLibrary: false` and keeps its own records. With `t` pressed on the confirm, the target has none.

## Gotchas
- A failed pick (the target fetch errors) stays on step `busy` with the error in `migrateView.busyText`; log it.
- A single migration that succeeds closes the view and opens the target's detail, so `migrateView.jobs` is empty afterwards; read the target id from the confirm step (`migrateView.job.target.id`).
- `grab()` runs after the step; a key in the same step shows in the capture. Grab the confirm in a step of its own.
- `updateTrack` on a logged-out tracker fails at the tracker, but `bindTrackRecord` never calls it.
