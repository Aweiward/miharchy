# Download queue

`D` on the Library or a manga (or the palette's "Download queue") opens the server's download queue over the window (`DownloadsView.qml`, decisions in `window/Downloads.js`). It polls `downloadStatus` each second while it shows, and also while anything waits in the queue. `D` is bound on the Library and a manga only, not on Updates. Other ways in: the manga detail's `d`/`x` and `U` download menu (`manga.md`), the reader's download ahead (`reader.md`), Library and Updates `d`.

## Keys

- `j`/`k` move the cursor. `x` takes the download out of the queue. `Space` starts or pauses the downloader. `Esc`/`D` close.
- `K`/`J` move the download up or down, `t` to the top, `b` to the bottom (Mihon's move actions). The cursor follows the download.
- `n` sorts by chapter number, `u` by upload date: ascending, or descending when the queue already runs ascending (Mihon's sort menu offers both directions). The whole queue sorts; Mihon sorts within each source group.
- `X` asks first and the second `X` cancels every download (Mihon's cancel all): `clearDownloader`, which also stops the downloader. Any other key keeps the queue (`shell.qml` disarms on every other key, as for Updates' `x`). With the queue empty, `X` does nothing.
- Every reorder is one request: one `reorderChapterDownload(chapterId, to)` per download out of place, run in order; only the last answers with the status. `to` counts from 0, and a `to` past the end fails the request, so `Downloads.moved` clamps.

## Settings

- "Save downloads as CBZ" is the server setting `downloadAsCbz` (Mihon's "Save as CBZ archive"). It applies to new downloads: the chapter lands as `<scanlator>_<name>.cbz` in the manga's folder under `$RUN/server/downloads/mangas/<source>/`, and `fetchChapterPages` still serves its pages. Proof: Enter on the row, `settings { downloadAsCbz }` reads `true`, download a chapter, `find` the `.cbz`.

## Auto-download

Mihon's "Auto-download" group, all Suwayomi server settings: "Auto-download new chapters" (`autoDownloadNewChapters`), "only for manga with no unread chapters" (`excludeEntryWithUnreadChapters`, the server's default is on), "skips re-uploaded chapters" (`autoDownloadIgnoreReUploads`: a new chapter numbered below the latest one). The server queues the new chapters a chapter fetch finds (a library update or `fetchChapters`), never on a manga's first fetch. `d` on Categories cycles a category's `includeInDownload` through unset, included and excluded (Mihon's include and exclude lists): once one is included, only manga in an included category download, and an excluded one always stays out. Neither `d` nor deleting a category touches the server setting any more. Not offered: `autoDownloadNewChaptersLimit`.

Proof with a real new chapter: a local-source manga (`$RUN/server/local/<title>/<chapter>/001.png`, source `"0"`) in the library and in an included category; `fetchChapters` once, add a chapter folder, `fetchChapters` again, and `isDownloaded` turns true for the new chapter only. With the category excluded, the next new chapter stays off disk.

## Delete after reading

Mihon's "Delete chapters" group. Suwayomi has none of it, so the window deletes, and `Downloads.autoDeletePayload` holds the rules both paths share (Mihon's `DownloadManager.getChaptersToDelete`): a chapter goes only when it is on disk and read, not bookmarked unless "Delete bookmarked chapters" is on, and its manga is in no category flagged with `p` in Categories (category meta `miharchy.keepDownloads` = `"true"`, Mihon's excluded categories). The rules read the server at delete time (`autoDeleteQuery`).

- "Delete after reading" (global meta `miharchy.deleteAfterRead`): Off, last read chapter, or the second to fifth to last. Once the chapter open in the reader is read there for the first time, the chapter that many slots back in reading order (`reader.chapters`, Mihon's `chapterList`) goes as the reader leaves the chapter (`Reader.deleteTarget`). Mihon defers the delete until the reader closes. The stored values `"false"`/`"true"` are those of the on/off row this replaced, so an old "on" reads as "last read chapter".
- "Delete downloads marked read" (`miharchy.deleteAfterMarkRead`): after a mark read from the manga detail or Updates (`shell.qml` `markChapters` → `deleteRead`), the chapters that mark read go. Mihon's own check of excluded categories reads the chapters from before the mark, so it never keeps one there; Miharchy keeps them.
- A manga in no category is in Default, which the Categories screen does not list, so Default cannot keep downloads.

Proof. Set up with `gql.sh`: every chapter of both seeded manga downloaded (enqueue, `startDownloader`, poll `isDownloaded`), chapter 4 read and 6 bookmarked on manga 2, manga 1 in a category. With "second to last" on, reading chapter 5 to its end and leaving deletes 4 and keeps 5; `R` on bookmarked 6 keeps it; `R` on manga 1's chapter 1 keeps it while `p` flags the category, and `R` on chapter 2 deletes it once `p` clears the flag. Read back `chapters(filter:{id:{in:[...]}}){ nodes{ id isRead isBookmarked isDownloaded } }` and `category(id){ meta{ key value } }`.

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
