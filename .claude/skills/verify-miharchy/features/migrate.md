# Migrate

`M` on a manga's detail (one manga), on Browse's sources (a whole source) or on the library check (the selection, `library-check.md`): search the other sources, pick the target, confirm. Enter migrates (the old manga leaves the library), `c` copies (it stays).

## Sub-features
- Batch target order (Browse's `M` and the check's): per manga, a same-named source in its language, then the pinned sources (global meta `miharchy.pinnedSources`, a JSON list of source ids) in pin order, one search at a time, the first match wins; the row names the source it searched, except "No source to search" and "No source has more chapters." With nothing pinned and no same-named source, step `to` picks one source for all; a manga already on it says "No source to search". A stalled manga takes a match only with a higher chapter number, else "No source has more chapters."
- Confirm (scope `migrate-confirm`): the plan (chapters marked read and bookmarked), the categories, `d` deletes the old downloads (yes when the window starts; a toggle carries over to the next migration in the same window, shown when the old manga has downloads; it applies to `c` too, `Migrate.oldPayload`), `t` takes the old manga's tracks along (yes when the window starts and carries over like `d`; shown when it has tracks, and always for a batch).
- One write to the target (`Migrate.targetPayload`): library, categories, read and bookmarked chapters, reading mode, and one `track.bind` per track. A target already in the library merges instead (its `inLibrary` from the fetch, `Migrate.mergeInto`): it keeps its categories and gains the old ones, keeps its reading mode (the old one only when it has none) and its tracks (the old ones bind only on trackers it lacks); the confirm says "Merge ... into" and the done row "Merged." Only after it succeeds does the old manga leave the library and lose its downloads (`Migrate.oldPayload`).
- Merge (`targetPayload`'s `merge`): a target already in the library makes it, from any entry point; the library check's duplicate merge (`library-check.md`) is a plain `startWith` whose kept copy is in the library. The same write, but the target's own state wins: no `clearCategories`, so it keeps its categories and gains the old ones; the old reading mode only when it has none; the old tracks only on trackers it has no track on (`Migrate.movingTracks`).

## How to get to it (user POV)
Library, Enter on a manga, `M`, pick a result with `hjkl`, Enter, then Enter or `c`.

## Driving it with drive.sh
The seeded manga have no twin on another source. Use Eleceed: MangaDex and Weeb Central both carry it with chapters (MangaDex's "Solo Leveling" has none, and the pick then stops on "No chapters found"). On the scratch core: `core.sh api extension.install '{"pkgName":"eu.kanade.tachiyomi.extension.en.weebcentral"}'`, then `source.search '{"source":"<id>","page":1,"query":"Eleceed"}'` on MangaDex (EN) (`2499283573021220255`) and Weeb Central (`2131019126180322627`), and `manga.refresh` both. Put the MangaDex one in the library and in a category (`manga.update '{"ids":[<id>],"inLibrary":true,"addToCategories":[<cat>]}'`), mark chapters 1 to 3 read and bookmark 2 (`chapter.update`), and set its `miharchy.readingMode` (`meta.set`, scope `manga`). Then drive with `m.id === <its id>`. `M` searches the manga's title by itself, and `Enter` picks the first result of the first source. Read back: `core.sh api library.list '{}' | jq -c '[.mangas[] | {id, sourceId, categories, meta}]'` lists the target with the category and the reading mode and no longer the old manga; `chapter.list` on the target has chapters 1 to 3 read and 2 bookmarked.

A scratch core has no tracker login. Write a track record for the old manga straight into `$RUN/core/data/core.db` (SKILL.md, miharchy-core).
```js
[
  [5000, function() { mangaDetail.openManga(<Eleceed's id>, false) }],
  [6000, function() { key("M") }],
  [15000, function() { log("search", [migrateView.step, migrateView.search.groups.map(function(g) { return [g.source.name, g.state, g.items.length] })]); key("Enter") }],
  [12000, function() { log("confirm", [migrateView.step, migrateView.tracks, migrateView.job.target.id]); grab("confirm") }],
  [800, function() { key("Enter") }],
  [12000, function() { log("after", migrateView.step); done() }]
]
```
Read back: `core.sh api track.list '{"mangaIds":[<old>,<target>]}' | jq -c '[.tracks[] | {mangaId, trackerId, remoteId, lastChapterRead, private, startDate}]'`: the target's records match the old manga's, and the old manga keeps its own. With `t` pressed on the confirm, the target has none.

A batch: pin the target with `core.sh api meta.set '{"metas":[{"scope":"global","owner":0,"key":"miharchy.pinnedSources","value":"[\"<source id>\"]"}]}'` before the drive (the window reads it at start), then `root.run("migrate.batch")`, set `migrateView.cursor` to the `froms` index of the source, `key("Enter")`, wait ~20 s and log `migrateView.rows` (each right side ends with the source searched, except the two messages above). With `[]` pinned and one MangaDex language, the batch stops on step `to` instead. The stalled rule needs old upload dates on a scratch core (`library-check.md`); `migrateView.startList([{ id, title, sourceId, sourceName, stalled: true }, ...])` drives the same path: with Eleceed on MangaDex (highest 390) and Weeb Central (421) both pinned, the MangaDex one takes Weeb Central and the Weeb Central one says "No source has more chapters."

## After a move from Suwayomi
Migrate runs on core (#394). Recipe: move a seeded scratch Suwayomi into the scratch core (SKILL.md, Move from Suwayomi; that block ran on 2026-11-22 and moved 2 manga), then the core steps above. The UI steps have not been re-run on core. This is the crossed-id check: core's ids differ from the Suwayomi ids the move read, so dump both servers before and after (every manga, chapter state, meta, track and category; `gql.sh` for the Suwayomi side) and `diff` the whole dumps: the server Migrate did not run on must not change.

## Gotchas
- A view key or a launcher path during an apply leaves Migrate open on step `busy` (`MigrateView.close` refuses while `running`); the jobs run to the end.
- A failed pick (the target fetch errors) stays on step `busy` with the error in `migrateView.busyText`; log it.
- A single migration that succeeds closes the view and opens the target's detail, so `migrateView.jobs` is empty afterwards; read the target id from the confirm step (`migrateView.job.target.id`).
- `grab()` runs after the step; a key in the same step shows in the capture. Grab the confirm in a step of its own.
- `track.update` on a logged-out tracker answers "Log in to <tracker> first.", but `track.bind` with a `recordId` (Migrate's copy) needs no login.
