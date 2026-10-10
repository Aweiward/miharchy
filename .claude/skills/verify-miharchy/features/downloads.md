# Download queue

`D` on the Library or a manga (or the palette's "Download queue") opens the server's download queue over the window (`DownloadsView.qml`, decisions in `window/Downloads.js`). It loads `downloadStatus` once, then follows the `downloadStatusChanged` subscription while it shows, and also while anything waits in the queue (see the SKILL's live updates section). `D` is bound on the Library and a manga only, not on Updates. Other ways in: the manga detail's `d`/`x` and `U` download menu (`manga.md`), the reader's download ahead (`reader.md`), Updates `d`, and the next chapters of a set of manga below, which opens the queue when it queued anything.

## Next chapters of a set of manga

`d` on the Library opens the download menu (`NextChaptersMenu.qml`, shell id `nextChapters`, scope `next-chapters`) for the selection, or with none for the shown category tab; the palette's "Download next chapters of Up next" opens it for all of Up next. The menu starts on the row chosen last (global meta `miharchy.downloadMenuSet`). A row fetches each manga's chapters (`fetchChapters`), one at a time, then queues only the missing chapters among each manga's next N unread (by its chapter filters and excluded scanlators; Downloaded only ignored). A failed fetch uses the stored chapters and lands in `nextChapters.lastRun.failures` with the server's message. Rules in `docs/agents/library.md`.

Setup: `seed.sh --library 3`; `createCategory`, `updateMangasCategories` for two manga; download one manga's next chapter (enqueue, `startDownloader`, poll `isDownloaded`), then `stopDownloader`. To force failed fetches, uninstall the extension (`updateExtension(patch:{uninstall:true})`): every refresh then fails with "Missing source <id>". Up next drops a manga whose source is missing, so drive Up next with the extension installed, and give it a manga by marking one chapter read.

```js
[
  [7000, function() { key("Tab"); key("Tab"); log("tab", root.shown.name) }],
  [500, function() { key("d") }],
  [1500, function() { log("menu", [nextChapters.set, nextChapters.cursor]); grab("menu") }],
  [300, function() { key("j"); key("Enter") }],
  [12000, function() {
    log("run", nextChapters.lastRun)
    log("queue", downloadsView.queue.items.map(function(i) { return i.chapterId }))
    grab("queue")
  }],
  [500, function() { done() }]
]
```

For Up next: `key(":")`, set the palette field's text (`find(palette, function(i) { return i.cursorPosition !== undefined })`) to "next chapters of up next", `key("Enter")`, then `key("Enter")` on the menu.

Read back `{ downloadStatus { queue { chapter { id } } } chapters(filter:{mangaId:{in:[...]}}) { nodes { id isDownloaded } } metas(filter:{key:{startsWith:"miharchy.downloadMenu"}}) { nodes { key value } } }`: the queue (or `isDownloaded`, once the downloader ran) holds exactly `lastRun.queued`, the chapter downloaded first is not queued again, and the meta holds the row (`next2`). The enqueue starts the downloader, so MangaDex may finish a chapter before the read-back.

## Keys

- `j`/`k` move the cursor. `x` takes the download out of the queue. `Space` starts or pauses the downloader. `Esc`/`D` close.
- `K`/`J` move the download up or down, `t` to the top, `b` to the bottom (Mihon's move actions). The cursor follows the download.
- `n` sorts by chapter number, `u` by upload date: ascending, or descending when the queue already runs ascending (Mihon's sort menu offers both directions). The whole queue sorts; Mihon sorts within each source group.
- `r` retries: on the run's summary line every failed chapter of the run, on a failed row that chapter (dequeue and enqueue in one request, so tries start over).
- `X` asks first and the second `X` cancels every download (Mihon's cancel all): `clearDownloader`, which also stops the downloader. Any other key keeps the queue (`shell.qml` disarms on every other key, as for Updates' `x`). With the queue empty, `X` does nothing.
- Every reorder is one request: one `reorderChapterDownload(chapterId, to)` per download out of place, run in order; only the last answers with the status. `to` counts from 0, and a `to` past the end fails the request, so `Downloads.moved` clamps.

### The run's summary

The queue shows the last run as a line above its rows ("Next 2 chapters of All: 2 on disk, 2 failed, 1 manga could not fetch chapters"), at cursor -1 (the queue opens there after a run), with each refresh failure under it. When none of the run's chapters is queued or downloading, the window runs `notify-send -a Miharchy -- <label> <counts>` once. Put a logging `notify-send` stub first on `PATH` (a literal `PATH=<stubdir>:/usr/local/bin:/usr/bin:... drive.sh ...`): never a real notification.

Setup, local source only (no extension): `$RUN/server/local/{Good,Broken,Gone}/{ch1,ch2}/001.png` (Gone needs only `ch1`), `fetchSourceManga(source: "0", type: POPULAR)`, `updateMangas(inLibrary: true)`, `fetchChapters` for each. Download Broken's `ch1` (it counts toward "Next 2"), then delete the image in Broken's `ch2` and the whole `Gone` folder: Gone's refresh then fails with "No chapters found" and its stored `ch1` fails to download (not found); Broken's `ch2` fails with no pages; Good's two download.

```js
[
  [7000, function() { key("d") }],
  [1500, function() { key("k"); key("k"); key("k"); key("j"); key("Enter") }],
  [15000, function() {
    log("tally", downloadsView.tally)
    log("line", find(downloadsView, function(i) { return typeof i.text === "string" && nextChapters.lastRun && i.text.indexOf(nextChapters.lastRun.label + ":") === 0 }).text)
    grab("summary")
  }],
  [300, function() { key("r") }],
  [800, function() { log("after r", downloadsView.queue.items.map(function(i) { return [i.chapterId, i.state] })); grab("retrying") }],
  [12000, function() { log("notified", downloadsView.notified) }],
  [300, function() { done() }]
]
```

Proof: the line reads 2 on disk, 2 failed, 1 manga; after `r` both failed chapters are `QUEUED` and the server log gains a new `downloadChapter(... tries= 0 ...)` warning for each; the stub logged one line. `fetchChapters` on a missing local folder reads "No chapters found", which `Failure.reason` leaves as "other".

## Failed rows

A failed download's row shows its reason after "failed" (`Downloads.statusText`, `window/Failure.js`): "Source not installed   see the library check, ! on the Library" for a manga whose extension is gone (no probe), else what one `fetchChapterPages` probe of the chapter says. Messages seen on Suwayomi v2.3.2243: `Chapter not found` (not found), `Source not installed: <source id>` (source missing), and an empty `pages` list for a chapter folder with no images (shown as "Chapter does not have any pages to download"). Cloudflare and network rows are node-tested only (`window/tests/failure.test.js`).

Setup, with the scratch server and `seed.sh --library 2`:

1. `seed.sh --hold-queue <MangaDex chapter ids>`, then uninstall MangaDex: `updateExtension(input: { id: "eu.kanade.tachiyomi.extension.all.mangadex", patch: { uninstall: true } })`.
2. A local-source manga with two chapters: `$RUN/server/local/Broken/ch1/001.png` and `ch2/001.png`; `fetchSourceManga(source: "0", type: POPULAR)`, `updateManga(inLibrary: true)`, `fetchChapters`.
3. Delete the `ch1` folder and the image in `ch2`, enqueue both, start the downloader. Every item turns `ERROR` (`tries` 3).

Drive: `root.run("downloads.open")`, wait 4 s, log `Downloads.statusText(i, downloadsView.reasons[i.chapterId], downloadsView.flareOn)` per item and grab. Proof of one probe per failure: `grep -F 'ChapterMutation$fetchChapterPages' $RUN/server.log` gains one line per window start (the not-found chapter only; the source-missing ones never), and one more after `x` and a new enqueue of that chapter fails it again.

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

MangaDex finishes a chapter in seconds, so a queue to drive must be stopped. `seed.sh --hold-queue` deletes the chapters' downloads, queues them, stops the downloader after its delayed start (a stop sent before it does not hold), and fails unless the queue still holds every chapter a few seconds later:

```sh
.claude/skills/verify-miharchy/scripts/seed.sh --hold-queue 4,5,6
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

Read back: `.claude/skills/verify-miharchy/scripts/gql.sh '{ downloadStatus { state queue { chapter { id } } } }'` holds the last order, and `state` stays `STOPPED`: a reorder does not start the downloader.
