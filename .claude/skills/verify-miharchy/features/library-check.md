# Library check

`!` on the Library, the palette's "Library check", or Enter on the Settings row "Library check" (its value is the count, "6 problems"): a screen like Setup that lists the problems in the library, grouped by kind, then by source.

## Sub-features
- Scope `check`: `j`/`k` move over group headers and rows; `space` selects a row, or on a header the whole group (again deselects it); `x` dismisses the selection, else the group or row under the cursor; `M` migrates the same manga as a batch (`migrate.md`), and the check loads again after; `X` lists the dismissed problems, where `x` brings them back; Enter on an extension update row updates that extension; Enter on a duplicate row opens the merge prompt; `r` loads again; `Esc` and `q` quit, as on Setup.
- Kinds, in screen order: Source missing, Update failed, No chapters, Extension update, Duplicate, Stalled (`LibraryCheck.KINDS`).
- The Settings row loads the check whenever Settings shows (`settingsView.checkWanted`).
- Merge (scope `check-merge`, `checkView.merge`): both copies of a duplicate pair with source, chapters read, categories and tracks; `j`/`k` move, Enter keeps the copy under the cursor, Esc cancels. A copy whose source is missing shows "source missing" and the cursor never lands on it; with both missing the prompt says no copy can be kept. The other copy then goes through Migrate's confirm (`migrateView.job.merge` set because the kept copy is in the library, heading "Merge … into …"); Enter there writes, the check reloads and the kept copy's detail opens.

## How to get to it (user POV)
Library, `!`. Or `5`, the "Library check" row, Enter.

## On miharchy-core
The check, its dismisses, the merge prompt and `M` run on core (#394). For Stalled, give a manga old upload dates in `$RUN/core/data/core.db` (`chapter.remote_date_upload`). For Update failed, set `manga.state_chapter_last_update` old and the global meta `miharchy.lastUpdateTimestamp` recent in the database, then `core.sh stop` and `start` (core reads it at start); a manga no one started stays out under the default `excludeNotStarted`. A recipe that ran on 2026-11-22 built this library by a move from a seeded scratch Suwayomi (SKILL.md, Move from Suwayomi), to check that a check on one server never writes the other: dump both servers before and after and `diff` the dumps, both ways. Without that check, seed core directly as below.

## Driving it with drive.sh
Build the library on core: `core.sh seed`, then `extension.install '{"pkgName":"eu.kanade.tachiyomi.extension.en.weebcentral"}'`. Search both sources for "Eleceed" and "Solo Leveling" (`source.search`, MangaDex (EN) `2499283573021220255`, Weeb Central `2131019126180322627`), then `manga.refresh` each and `manga.update '{"ids":[...],"inLibrary":true}'` all four. MangaDex's "Solo Leveling" has no chapters. Set global meta `miharchy.sourceNames` to `{"2131019126180322627":"Weeb Central"}` (`meta.set`) so the missing source has a name, then uninstall Weeb Central (`extension.remove '{"pkgName":"eu.kanade.tachiyomi.extension.en.weebcentral"}'`). The check then lists Source missing (Weeb Central, 2), No chapters (MangaDex, 1) and two Duplicate groups.
```js
[
  [5000, function() { root.run("view.check") }],
  [4000, function() { log("rows", checkView.rows.map(function(r) { return r.type === "group" ? r.label : "  " + r.key })); grab("check") }],
  [500, function() { key(" ") }],
  [500, function() { log("selected", checkView.selectedIds); grab("selected") }],
  [500, function() { key(" "); key("j"); log("cursor row", checkView.current.key); key("x") }],
  [3000, function() { log("after x", checkView.count) }],
  [500, function() { key("X") }],
  [1000, function() { log("dismissed", checkView.rows.map(function(r) { return r.key })); grab("dismissed") }],
  [500, function() { key("X"); root.run("view.settings"); root.settingsCursor = Settings.ROWS.map(function(r) { return r.key }).indexOf("libraryCheck") }],
  [3000, function() { log("settings row", settingsView.notes.libraryCheck); grab("settings-row") }],
  [500, function() { done() }]
]
```
Read back: `core.sh api meta.get '{"scope":"manga","owners":[<the Weeb Central Eleceed>],"keys":["miharchy.checkDismissed"]}'` holds `{"missing":<ms>}`; after `X` then `x` on it, `{}`.

### Merge
Keep both extensions installed. Search both for "Eleceed" and `manga.refresh` both (take the ids from the search replies), `category.create` "Alpha" and "Beta", put both in the library. Give the MangaDex copy Alpha (`manga.update` with `addToCategories`) and chapter 5 read (`chapter.update`); give it `miharchy.readingMode` `pager` (`meta.set`, scope `manga`). Give the Weeb Central copy Alpha and Beta, chapters 1 to 3 read, 2 bookmarked, and `miharchy.readingMode` `webtoon`. For the missing-source case, uninstall Weeb Central first, Enter on `duplicate:<id>`: `checkView.merge.cursor` is 1 (MangaDex) and stays there on `k`; reinstall it (`extension.install`) before the merge.
```js
[
  [5000, function() { root.run("view.check") }],
  [4000, function() { for (var i = 0; i < 20 && !(checkView.current && checkView.current.key === "duplicate:<the MangaDex Eleceed id>"); i++) key("j"); log("cursor", checkView.current.key) }],
  [500, function() { key("Enter") }],
  [3000, function() { log("prompt", checkView.merge.copies.map(function(c) { return JSON.stringify(c) })); grab("prompt") }],
  [500, function() { key("Enter") }],
  [15000, function() { log("confirm", [migrateView.step, migrateView.job.merge]); grab("confirm") }],
  [800, function() { key("Enter") }],
  [15000, function() { key("Esc") }],
  [4000, function() { log("check after", checkView.rows.map(function(r) { return r.key })); grab("check-after") }],
  [500, function() { done() }]
]
```
Read back: `core.sh api library.list '{}' | jq -c '[.mangas[] | {id, categories, meta}]'` lists the MangaDex copy with Alpha and Beta and `miharchy.readingMode` still `pager`, and no longer the Weeb Central copy; `core.sh api chapter.list '{"mangaIds":[<MangaDex copy>]}' | jq -c '[.chapters[] | select(.isRead or .isBookmarked) | [.chapterNumber, .isRead, .isBookmarked]]'` has chapters 1, 2, 3 and 5 read and 2 bookmarked. The check lists no problem afterwards.

### Migrate the selection (`M`)
Seed MangaDex and Weeb Central on core, put only the Weeb Central Eleceed in the library (a category, chapters 1 to 3 read, 2 bookmarked, `miharchy.readingMode`), name it in `miharchy.sourceNames`, pin MangaDex (EN) (`meta.set` of global `miharchy.pinnedSources` = `["2499283573021220255"]`), uninstall Weeb Central (`extension.remove`). Then:
```js
[
  [5000, function() { root.run("view.check") }],
  [4000, function() { checkView.cursor = checkView.rows.findIndex(function(r) { return r.key === "missing:<id>" }); key(" ") }],
  [500, function() { key("M") }],
  [20000, function() { log("match", migrateView.rows); grab("match") }],
  [500, function() { key("Enter") }],
  [1000, function() { log("confirm", migrateView.jobs.map(function(j) { return [j.old.id, j.target.id, j.target.source] })); grab("confirm") }],
  [500, function() { key("Enter") }],
  [20000, function() { log("done", migrateView.rows); key("Enter") }],
  [4000, function() { log("check after", checkView.rows.map(function(r) { return r.key })); done() }]
]
```
Read back: `core.sh api library.list '{}' | jq -c '[.mangas[] | {id, sourceId, categories, meta}]'` lists the MangaDex one with the category and the reading mode, and no longer the old one; `chapter.list` on the MangaDex one has chapters 1 to 3 read and 2 bookmarked; the check lists nothing.

## Gotchas
- A scratch core never ran a library update (`lastUpdateTimestamp` 0), so Update failed shows only after the database edit above; `window/tests/librarycheck.test.js` pins it. Stalled needs an ongoing manga with no upload for 6 months: the database edit above, or what the sources list today.
- Extension update needs a store of your own with a higher `versionCode` (`extensions.md`, Gotchas).
- `grab()` runs after the step: a key later in the same step shows in the capture. Grab in a step of its own.
