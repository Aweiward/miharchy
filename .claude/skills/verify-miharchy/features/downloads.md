# Download queue

`D` on the Library or a manga (or the palette's "Download queue") opens core's download queue over the window (`DownloadsView.qml`, decisions in `window/Downloads.js`). It loads `download.queue` once, then follows core's `downloads` topic while it shows, and also while anything waits in the queue (see the SKILL's live updates section). `D` is bound on the Library and a manga only, not on Updates. Other ways in: the manga detail's `d`/`x` and `U` download menu (`manga.md`), the reader's download ahead (`reader.md`), Updates `d`, and the next chapters of a set of manga below, which opens the queue when it queued anything.

## Next chapters of a set of manga

`d` on the Library opens the download menu (`NextChaptersMenu.qml`, shell id `nextChapters`, scope `next-chapters`) for the selection, or with none for the shown category tab; the palette's "Download next chapters of Up next" opens it for all of Up next. The menu starts on the row chosen last (global meta `miharchy.downloadMenuSet`). A row fetches each manga's chapters (`manga.refresh`), one at a time, then queues only the missing chapters among each manga's next N unread (by its chapter filters and excluded scanlators; Downloaded only ignored). A failed fetch uses the stored chapters and lands in `nextChapters.lastRun.failures` with core's message. Rules in `docs/agents/library.md`.

Setup: the core seed with three library manga; `category.create`, then `manga.update` with `addToCategories` for two of them; download one manga's next chapter (`download.enqueue`, poll `chapter.list` until `isDownloaded`). To force failed fetches, uninstall the extension (`extension.remove '{"pkgName":"<pkg>"}'`): every refresh then fails with "The source <id> is not installed." Up next drops a manga whose source is missing, so drive Up next with the extension installed, and give it a manga by marking one chapter read.

```js
[
  [7000, function() { key("Tab"); key("Tab"); log("tab", libraryView.shown.name) }],
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

Read back `core.sh api download.queue '{}' | jq -c '[.queue[].chapter.id]'`, `core.sh api chapter.list '{"mangaIds":[...]}' | jq -c '[.chapters[] | select(.isDownloaded) | .id]'` and `core.sh api meta.get '{"scope":"global","keys":["miharchy.downloadMenuSet"]}'`: the queue (or `isDownloaded`, once the downloader ran) holds exactly `lastRun.queued`, the chapter downloaded first is not queued again, and the meta holds the row (`next2`). The enqueue starts the downloader, so MangaDex may finish a chapter before the read-back.

## Keys

- `j`/`k` move the cursor. `x` takes the download out of the queue. `Space` starts or pauses the downloader. `Esc`/`D` close.
- `K`/`J` move the download up or down, `t` to the top, `b` to the bottom (Mihon's move actions). The cursor follows the download.
- `n` sorts by chapter number, `u` by upload date: ascending, or descending when the queue already runs ascending (Mihon's sort menu offers both directions). The whole queue sorts; Mihon sorts within each source group.
- `r` retries: on the run's summary line every failed chapter of the run, on a failed row that chapter (one `download.enqueue`; core puts a failed chapter back to `QUEUED` where it is, and it keeps its tries).
- `X` asks first and the second `X` cancels every download (Mihon's cancel all): `download.clear`, which also stops the downloader. Any other key keeps the queue (`shell.qml` disarms on every other key, as for Updates' `x`). With the queue empty, `X` does nothing.
- Every reorder is one `download.reorder` with the whole new order (`Downloads.orderPayload`); nothing is sent when nothing moves.

### The run's summary

The queue shows the last run as a line above its rows ("Next 2 chapters of All: 2 on disk, 2 failed, 1 manga could not fetch chapters"), at cursor -1 (the queue opens there after a run), with each refresh failure under it. When none of the run's chapters is queued or downloading, the window runs `notify-send -a Miharchy -- <label> <counts>` once. Put a logging `notify-send` stub first on `PATH` (a literal `PATH=<stubdir>:/usr/local/bin:/usr/bin:... drive.sh ...`): never a real notification.

The recipe for this line used local-source fixtures (a manga whose folder is gone, one with a chapter with no images), and core has no local source yet (#374). Until it lands, a refresh failure comes from an uninstalled extension (above), and a download failure from a chapter whose source is gone (Failed rows). The steps stay:

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

Proof: the line's counts match the fixture; after `r` the failed chapters are `QUEUED` in `core.sh api download.queue '{}' | jq -c '[.queue[] | {id: .chapter.id, state, tries}]'`; the stub logged one line. To prove the end needs no live update, stop the topic before the run: `var ls = downloadsView.children.find(function(c) { return c.topic === "downloads" }); ls.running = false`. The window then sees none of the run's chapters; `ls.running = true` brings the failed ones back, the settle read marks the finished ones `disk`, and the stub logs one notification (from `LiveSocket.qml`: `onRunningChanged` closes or reconnects; this step has not run on core yet).

## Failed rows

A failed download's row shows its reason after "failed" (`Downloads.statusText`, `window/Failure.js`). The reason is the `error` core's queue carries for the chapter (`{ kind, message }`, read by `Failure.coreReason`); the window sends no probe. Messages seen on core on 2026-11-22: `Source not installed` (kind `notFound`) for a chapter whose extension is gone. Cloudflare and network rows are node-tested only (`window/tests/failure.test.js`).

Recipe that ran on 2026-11-22: `core.sh api extension.install '{"pkgName":"eu.kanade.tachiyomi.extension.en.weebcentral"}'`, `source.search` "Eleceed" on Weeb Central (`2131019126180322627`), `manga.refresh` it, `extension.remove` Weeb Central, then `download.enqueue` one of its chapters. Within seconds the read-back `core.sh api download.queue '{}' | jq -c '{state, queue: [.queue[] | {id: .chapter.id, state, tries, error}]}'` gave `{"state":"STOPPED","queue":[{"id":102,"state":"ERROR","tries":1,"error":{"kind":"notFound","message":"Source not installed"}}]}`.

Drive: `root.run("downloads.open")`, wait 4 s, log `Downloads.statusText(i, downloadsView.reasons[i.chapterId], downloadsView.flareOn)` per item and grab.

## Settings

- "Save downloads as CBZ" is the setting `downloadAsCbz` (Mihon's "Save as CBZ archive"). Core stores it and does not act on it: it always writes a chapter as a `.cbz` under `$RUN/core/data/downloads`. Proof of the row: Enter on it, then `core.sh api settings.get '{}' | jq -c '{downloadAsCbz: .settings.downloadAsCbz, unapplied}'` reads `true` with `downloadAsCbz` in `unapplied`.

## Auto-download

Mihon's "Auto-download" group: "Auto-download new chapters" (`autoDownloadNewChapters`), "only for manga with no unread chapters" (`excludeEntryWithUnreadChapters`, default on), "skips re-uploaded chapters" (`autoDownloadIgnoreReUploads`). Core stores all three and has no auto-download yet, so `settings.get` lists them in `unapplied` and only the rows can be proven. `d` on Categories cycles a category's `includeInDownload` through unset, included and excluded (Mihon's include and exclude lists); read it back with `core.sh api category.list '{}' | jq -c '[.categories[] | {id, name, includeInDownload}]'`. Neither `d` nor deleting a category touches the setting. Not offered: `autoDownloadNewChaptersLimit`.

## Delete after reading

Mihon's "Delete chapters" group. The window deletes, and `Downloads.autoDeletePayload` holds the rules both paths share (Mihon's `DownloadManager.getChaptersToDelete`): a chapter goes only when it is on disk and read, not bookmarked unless "Delete bookmarked chapters" is on, and its manga is in no category flagged with `p` in Categories (category meta `miharchy.keepDownloads` = `"true"`, Mihon's excluded categories). The rules read core at delete time (`autoDeleteQuery`).

- "Delete after reading" (global meta `miharchy.deleteAfterRead`): Off, last read chapter, or the second to fifth to last. Once the chapter open in the reader is read there for the first time, the chapter that many slots back in reading order (`reader.chapters`, Mihon's `chapterList`) goes as the reader leaves the chapter (`Reader.deleteTarget`). Mihon defers the delete until the reader closes. The stored values `"false"`/`"true"` are those of the on/off row this replaced, so an old "on" reads as "last read chapter".
- "Delete downloads marked read" (`miharchy.deleteAfterMarkRead`): after a mark read from the manga detail or Updates (`shell.qml` `markChapters` → `deleteRead`), the chapters that mark read go. Mihon's own check of excluded categories reads the chapters from before the mark, so it never keeps one there; Miharchy keeps them.
- A manga in no category is in Default, which the Categories screen does not list, so Default cannot keep downloads.

Proof. Set up with `core.sh api`: every chapter of two seeded manga downloaded (`download.enqueue`, poll `chapter.list` until `isDownloaded`), chapter 4 read (`chapter.update` with `isRead`) and 6 bookmarked (`isBookmarked`) on the second manga, the first manga in a category. With "second to last" on, reading chapter 5 to its end and leaving deletes 4 and keeps 5; `R` on bookmarked 6 keeps it; `R` on the first manga's chapter 1 keeps it while `p` flags the category, and `R` on chapter 2 deletes it once `p` clears the flag. Read back `core.sh api chapter.list '{"ids":[...]}' | jq -c '[.chapters[] | [.id, .isRead, .isBookmarked, .isDownloaded]]'` and `core.sh api category.list '{}' | jq -c '[.categories[] | {id, meta}]'`.

## Setup

MangaDex finishes a chapter in seconds, so a queue to drive must be stopped. `download.enqueue` starts the downloader, so stop it right after; the chapter it was on goes back to `QUEUED`:

```sh
.claude/skills/verify-miharchy/scripts/core.sh api download.enqueue '{"ids":[4,5,6]}'
.claude/skills/verify-miharchy/scripts/core.sh api download.stop '{}'
.claude/skills/verify-miharchy/scripts/core.sh api download.queue '{}' | jq -c '{state, queue: [.queue[].chapter.id]}'
```

On an empty queue the last command must print `{"state":"STOPPED","queue":[4,5,6]}`; on 2026-11-22 it held all three, behind a failed chapter already queued. A chapter already on disk is not queued: `download.delete '{"ids":[...]}'` deletes it first.

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

Read back: `.claude/skills/verify-miharchy/scripts/core.sh api download.queue '{}' | jq -c '{state, queue: [.queue[].chapter.id]}'` holds the last order, and `state` stays `STOPPED`: a reorder does not start the downloader.
