# Settings

The Settings view (key `5`) lists the rows of `window/Settings.js` `ROWS`. Each row is stored one of three ways: a `meta` row as global meta `miharchy.<key>`, a `server` row as one of core's settings through `settings.set` (some send more keys: `whenOn` when turned on, `with` on every save), an `action` row runs a command. Core keeps its settings as global meta `miharchy.<key>` too, and names in `settings.get`'s `unapplied` the ones it stores but does not act on yet. Enter flips a bool, steps a choice, or opens a text field; a folder row saves only once `test -d` finds the folder. Under the rows, it shows a Storage line with the disk space downloads use and a "Clear the cache" row with the cache's size. Enter on that row deletes core's cached covers of manga outside the library, then shows "Freed <size>". Downloads keep their size. The tracker rows follow it.

## Sub-features
- Sizes come from core's `storage.get` (`window/Storage.js`): `downloads`, the bytes under `$RUN/core/data/downloads`, and `cache`, the covers `cache.clear` would delete. The window asks each time Settings shows and after a clear.
- The clear sends `cache.clear`; library covers and downloads stay. Core keeps no page cache: pages come from the source or a download.
- Catch-up (meta `miharchy.catchUp`, "0" Off, "1", "2", "3", "5" or "10", default "3"; any other value reads back as "3"): what a peek's reader reads per turn (`peek.md`). A drive sets it before the window starts with `core.sh api meta.set '{"metas":[{"scope":"global","owner":0,"key":"miharchy.catchUp","value":"2"}]}'` and logs `root.settingsState.values.catchUp`.

## How to get to it (user POV)
Press `5`. The "Clear the cache" row comes after the last setting row ("Create a backup"), at cursor `Settings.ROWS.length`; the trackers follow at `Settings.ROWS.length + 1 + i`.

## Seeding varied state
Core's cache is `$RUN/core/data/covers`, one file per cover the window fetched (`<manga id>-<hash>`). Fill it with a drive that shows covers of manga outside the library: Browse (`4`), Enter on MangaDex (EN), wait for the grid. Then `core.sh api storage.get '{}'` reads a `cache` above 0. Each cover is a `GET /api/cover/<manga id>` with the bearer secret; `core.sh` only POSTs. Recipe that ran on 2026-11-22: one such GET for a manga outside the library gave `{"downloads":0,"cache":1887651}`, and `cache.clear` answered `{"freed":1887651}`. Core never touches the user's cache, so a clear here is safe.

## Driving it with drive.sh
```js
[
  [5000, function() { key("5") }],
  [3000, function() { log("before", settingsView.storage); for (var i = 0; i < Settings.ROWS.length; i++) key("j"); grab("before") }],
  [300, function() { key("Enter") }],
  [4000, function() { log("after", settingsView.storage); log("note", settingsView.storageNote); grab("after"); done() }]
]
```
To change a row, find its index by key (`Settings.ROWS.map(function(r) { return r.key }).indexOf("updateMangas")`), press `j` that many times from the top and Enter; for a text or folder row, set the focused field's text (`find(settingsView, function(i) { return i.cursorPosition !== undefined && i.activeFocus })`) and Enter. Read back `core.sh api settings.get '{}' | jq -c '.settings | {updateMangas, localSourcePath}'`, or `meta.get` for a meta row. Count `Settings.ROWS.length` at run time rather than hard-coding it: rows keep being added. Settings scrolls, so the cursor's row is always on screen. Read back the clear: `core.sh api storage.get '{}'` before and after (`cache` drops to 0, `downloads` stays), and `du -s -B1 <RUN>/core/data/covers <RUN>/core/data/downloads`. The covers of library manga stay in the folder.
