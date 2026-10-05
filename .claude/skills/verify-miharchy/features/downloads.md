# Download queue

`D` on the Library or a manga (or the palette's "Download queue") opens the server's download queue over the window (`DownloadsView.qml`, decisions in `window/Downloads.js`). It polls `downloadStatus` each second while it shows.

## Keys

- `j`/`k` move the cursor. `x` takes the download out of the queue. `Space` starts or pauses the downloader. `Esc`/`D` close.
- `K`/`J` move the download up or down, `t` to the top, `b` to the bottom (Mihon's move actions). The cursor follows the download.
- `n` sorts by chapter number, `u` by upload date: ascending, or descending when the queue already runs ascending (Mihon's sort menu offers both directions). The whole queue sorts; Mihon sorts within each source group.
- `X` asks first and the second `X` cancels every download (Mihon's cancel all): `clearDownloader`, which also stops the downloader. Any other key keeps the queue (`shell.qml` disarms on every other key, as for Updates' `x`). With the queue empty, `X` does nothing.
- Every reorder is one request: one `reorderChapterDownload(chapterId, to)` per download out of place, run in order; only the last answers with the status. `to` counts from 0, and a `to` past the end fails the request, so `Downloads.moved` clamps.

## Settings

- "Save downloads as CBZ" is the server setting `downloadAsCbz` (Mihon's "Save as CBZ archive"). It applies to new downloads: the chapter lands as `<scanlator>_<name>.cbz` in the manga's folder under `$RUN/server/downloads/mangas/<source>/`, and `fetchChapterPages` still serves its pages. Proof: Enter on the row, `settings { downloadAsCbz }` reads `true`, download a chapter, `find` the `.cbz`.

## Setup

Enqueuing starts the downloader a moment later, and MangaDex finishes a chapter in seconds, so a queue to drive must be stopped after the enqueue:

```sh
Q=$S/gql.sh
$Q 'mutation { deleteDownloadedChapters(input:{ids:[4,5,6]}) { chapters { id } } }'
$Q 'mutation { enqueueChapterDownloads(input:{ids:[4,5,6]}) { downloadStatus { state } } }'
$Q 'mutation { stopDownloader(input:{}) { downloadStatus { state } } }'; sleep 1
$Q 'mutation { stopDownloader(input:{}) { downloadStatus { state } } }'
```

## Drive

```js
[
  [5000, function() {
    root.v.order = function() { return downloadsView.queue.items.map(function(i) { return i.chapterId }) }
    root.v.part = function(t) { return find(downloadsView, function(i) { return i.modelData && i.modelData.text === t }) }
    root.run("downloads.open")
  }],
  [2500, function() { log("opened", root.v.order()) }],
  [100, function() { key("b") }],
  [2000, function() { log("bottom", [root.v.order(), downloadsView.cursor]) }],
  [100, function() { click(root.v.part("t top")) }],
  [2000, function() { log("top", root.v.order()) }],
  [100, function() { key("n") }],
  [2000, function() { log("by number", root.v.order()) }],
  [100, function() { done() }]
]
```

Read back: `$S/gql.sh '{ downloadStatus { state queue { chapter { id } } } }'` holds the last order, and `state` stays `STOPPED`: a reorder does not start the downloader.
