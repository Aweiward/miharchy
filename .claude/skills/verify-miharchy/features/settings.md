# Settings

The Settings view (key `5`) lists the rows of `window/Settings.js` `ROWS`. Each row is stored one of three ways: a `meta` row as global meta `miharchy.<key>`, a `server` row through `setSettings` (some send more keys: `whenOn` when turned on, `with` on every save), an `action` row runs a command. Enter flips a bool, steps a choice, or opens a text field; a folder row saves only once `test -d` finds the folder. Under the rows, it shows a Storage line with the disk space downloads use and a "Clear the cache" row with the cache's size. Enter on that row empties Suwayomi's cached pages and cached covers, then shows "Freed <size>". Downloads keep their size. The tracker rows follow it.

## Sub-features
- Sizes come from `du` on the server's folders (`window/Storage.js`), measured each time Settings shows and after a clear.
- The clear sends `clearCachedImages(cachedPages: true, cachedThumbnails: true)`; library covers (`downloadedThumbnails`) and downloads stay.
- Catch-up (meta `miharchy.catchUp`, "0" Off, "1" to "10", default "3"): what a peek's reader reads per turn (`peek.md`). A drive sets it before the window starts with `setGlobalMeta(input: {meta: {key: "miharchy.catchUp", value: "2"}})` and logs `root.settingsState.values.catchUp`.

## How to get to it (user POV)
Press `5`. The "Clear the cache" row comes after the last setting row ("Create a backup"), at cursor `Settings.ROWS.length`; the trackers follow at `Settings.ROWS.length + 1 + i`.

## Seeding varied state
`server.sh start` gives the scratch server its own `java.io.tmpdir` (`$RUN/server/tmp`), and `drive.sh` sets `MIHARCHY_SERVER_ROOT` and `MIHARCHY_SERVER_TMPDIR` to match. Never clear the cache of a server started without it: its cache is the shared `/tmp/Tachidesk`, the user's server's too.

Fill the cache over REST with an access token (`Authorization: Bearer`, from `token` in `scripts/env.sh`): `fetchChapterPages(input:{chapterId})`, then GET each returned page path (fills `tmp/Tachidesk/manga-cache`), and GET `/api/v1/manga/<id>/thumbnail` for manga not in the library (fills `tmp/Tachidesk/thumbnails`).

## Driving it with drive.sh
```js
[
  [5000, function() { key("5") }],
  [3000, function() { log("before", settingsView.storage); for (var i = 0; i < Settings.ROWS.length; i++) key("j"); grab("before") }],
  [300, function() { key("Enter") }],
  [4000, function() { log("after", settingsView.storage); log("note", settingsView.storageNote); grab("after"); done() }]
]
```
To change a row, find its index by key (`Settings.ROWS.map(function(r) { return r.key }).indexOf("updateMangas")`), press `j` that many times from the top and Enter; for a text or folder row, set the focused field's text (`find(settingsView, function(i) { return i.cursorPosition !== undefined && i.activeFocus })`) and Enter. Read back `settings { updateMangas localSourcePath }` or `metas`. Count `Settings.ROWS.length` at run time rather than hard-coding it: rows keep being added. Settings scrolls, so the cursor's row is always on screen. Read back: `du -s -B1` on `$RUN/server/tmp/Tachidesk/*` and `$RUN/server/downloads`. The server deletes both cache folders, and downloads keep their byte count. `ls /tmp/Tachidesk` must be unchanged.
