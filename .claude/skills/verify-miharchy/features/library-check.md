# Library check

`!` on the Library, the palette's "Library check", or Enter on the Settings row "Library check" (its value is the count, "6 problems"): a screen like Setup that lists the problems in the library, grouped by kind, then by source.

## Sub-features
- Scope `check`: `j`/`k` move over group headers and rows; `space` selects a row, or on a header the whole group (again deselects it); `x` dismisses the selection, else the group or row under the cursor; `X` lists the dismissed problems, where `x` brings them back; Enter on an extension update row updates that extension; Enter on a duplicate row opens the merge prompt; `r` loads again; `Esc` and `q` quit, as on Setup.
- Kinds, in screen order: Source missing, Update failed, No chapters, Extension update, Duplicate, Stalled (`LibraryCheck.KINDS`).
- The Settings row loads the check whenever Settings shows (`settingsView.checkWanted`).
- Merge (scope `check-merge`, `checkView.merge`): both copies of a duplicate pair with source, chapters read, categories and tracks; `j`/`k` move, Enter keeps the copy under the cursor, Esc cancels. The other copy then goes through Migrate's confirm (`migrateView.merge` true, heading "Merge … into …"); Enter there writes, the check reloads and the kept copy's detail opens.

## How to get to it (user POV)
Library, `!`. Or `5`, the "Library check" row, Enter.

## Driving it with drive.sh
Build the library with `seed.sh --library 2 eu.kanade.tachiyomi.extension.all.mangadex eu.kanade.tachiyomi.extension.en.weebcentral`, then search both sources for "Eleceed" and "Solo Leveling" (`fetchSourceManga(type: SEARCH)`), `fetchMangaAndChapters` and `updateManga(inLibrary: true)` all four. MangaDex's "Solo Leveling" has no chapters. Set global meta `miharchy.sourceNames` to `{"2131019126180322627":"Weeb Central"}` so the missing source has a name, then uninstall Weeb Central (`updateExtension(id: "eu.kanade.tachiyomi.extension.en.weebcentral", patch: { uninstall: true })`). The check then lists Source missing (Weeb Central, 2), No chapters (MangaDex, 1) and two Duplicate groups.
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
Read back: `manga(id: <the Weeb Central Eleceed>) { meta { key value } }` holds `miharchy.checkDismissed` `{"missing":<ms>}`; after `X` then `x` on it, `{}`.

### Merge
Keep both extensions installed. Search both for "Eleceed" and `fetchMangaAndChapters` both (MangaDex is manga 1, Weeb Central manga 2 on a fresh server), `createCategory` "Alpha" and "Beta", put both in the library. Give the MangaDex copy Alpha and chapter 5 read; give the Weeb Central copy Alpha and Beta, chapters 1 to 3 read, 2 bookmarked, and `miharchy.readingMode` `webtoon`.
```js
[
  [5000, function() { root.run("view.check") }],
  [4000, function() { for (var i = 0; i < 20 && !(checkView.current && checkView.current.key === "duplicate:1"); i++) key("j"); log("cursor", checkView.current.key) }],
  [500, function() { key("Enter") }],
  [3000, function() { log("prompt", checkView.merge.copies.map(function(c) { return JSON.stringify(c) })); grab("prompt") }],
  [500, function() { key("Enter") }],
  [15000, function() { log("confirm", [migrateView.step, migrateView.merge]); grab("confirm") }],
  [800, function() { key("Enter") }],
  [15000, function() { key("Esc") }],
  [4000, function() { log("check after", checkView.rows.map(function(r) { return r.key })); grab("check-after") }],
  [500, function() { done() }]
]
```
Read back: manga 1 `inLibrary: true`, categories Alpha and Beta, `miharchy.readingMode` `webtoon`, chapters 1, 2, 3 and 5 read (`chapters(condition: { isRead: true })` at the root; `manga.chapters` takes no condition), 2 bookmarked; manga 2 `inLibrary: false`. The check lists no problem afterwards.

## Gotchas
- A scratch server never ran a library update (`lastUpdateTimestamp` 0) and keeps no `mangaUpdates`, so Update failed cannot show there; `window/tests/librarycheck.test.js` pins it. Stalled needs an ongoing manga with no upload for 6 months; it depends on what the sources list today.
- Extension update needs a store of your own with a higher `versionCode` (`extensions.md`, Gotchas).
- `grab()` runs after the step: a key later in the same step shows in the capture. Grab in a step of its own.
