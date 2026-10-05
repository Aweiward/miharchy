# Settings storage

The Settings view (key `5`) shows, under the setting rows, a Storage line with the disk space downloads use and a "Clear the cache" row with the cache's size. Enter on that row empties Suwayomi's cached pages and cached covers, then shows "Freed <size>". Downloads keep their size. The tracker rows follow it.

## Sub-features
- Sizes come from `du` on the server's folders (`window/Storage.js`), measured each time Settings shows and after a clear.
- The clear sends `clearCachedImages(cachedPages: true, cachedThumbnails: true)`; library covers (`downloadedThumbnails`) and downloads stay.

## How to get to it (user POV)
Press `5`, then `j` to the row after "Sync folder".

## Seeding varied state
`server.sh start` gives the scratch server its own `java.io.tmpdir` (`$RUN/server/tmp`), and `drive.sh` sets `MIHARCHY_SERVER_ROOT` and `MIHARCHY_SERVER_TMPDIR` to match. Never clear the cache of a server started without it: its cache is the shared `/tmp/Tachidesk`, the user's server's too.

Fill the cache over REST with the server.json credentials: `fetchChapterPages(input:{chapterId})`, then GET each returned page path (fills `tmp/Tachidesk/manga-cache`), and GET `/api/v1/manga/<id>/thumbnail` for manga not in the library (fills `tmp/Tachidesk/thumbnails`).

## Driving it with drive.sh
```js
[
  [5000, function() { key("5") }],
  [3000, function() { log("before", settingsView.storage); for (var i = 0; i < Settings.ROWS.length; i++) key("j"); grab("before") }],
  [300, function() { key("Enter") }],
  [4000, function() { log("after", settingsView.storage); log("note", settingsView.storageNote); grab("after"); done() }]
]
```
Count `Settings.ROWS.length` at run time rather than hard-coding it: rows keep being added. Settings scrolls, so the cursor's row is always on screen. Read back: `du -s -B1` on `$RUN/server/tmp/Tachidesk/*` and `$RUN/server/downloads`. The server deletes both cache folders, and downloads keep their byte count. `ls /tmp/Tachidesk` must be unchanged.
