.pragma library
.import "Failure.js" as Failure

// Downloads: the server's download queue and the chapters a manga detail
// marks for download or removal. Pure, so tests/downloads.test.js pins it;
// DownloadsView.qml keeps the queue live, and it and MangaDetail.qml send
// the payloads built here.

var DOWNLOAD = "state progress tries chapter { id name mangaId chapterNumber uploadDate } manga { id title source { id } }"
var STATUS = "downloadStatus { state queue { " + DOWNLOAD + " } }"
var STATUS_QUERY = "{ " + STATUS + " }"
// Its first result holds the whole queue (initial), each later one only
// what changed. Past maxUpdates changes in one result the server leaves
// them out (omittedUpdates), and the queue is due a STATUS_QUERY.
var LIVE_QUERY = "subscription { downloadStatusChanged(input: { maxUpdates: 50 }) { state omittedUpdates"
  + " initial { position " + DOWNLOAD + " } updates { type download { position " + DOWNLOAD + " } } } }"
var ENQUEUE_MUTATION = "mutation($ids: [Int!]!) { enqueueChapterDownloads(input: { ids: $ids }) { " + STATUS + " } }"
var DEQUEUE_MUTATION = "mutation($ids: [Int!]!) { dequeueChapterDownloads(input: { ids: $ids }) { " + STATUS + " } }"
var DELETE_MUTATION = "mutation($ids: [Int!]!) { deleteDownloadedChapters(input: { ids: $ids }) { chapters { id isDownloaded } } }"
// Mutation fields run in order, so a download in flight stops before its
// folder goes.
var REMOVE_MUTATION = "mutation($queued: [Int!]!, $ids: [Int!]!) { dequeueChapterDownloads(input: { ids: $queued }) { " + STATUS + " }"
  + " deleteDownloadedChapters(input: { ids: $ids }) { chapters { id isDownloaded } } }"
var START_MUTATION = "mutation { startDownloader(input: {}) { " + STATUS + " } }"
var STOP_MUTATION = "mutation { stopDownloader(input: {}) { " + STATUS + " } }"
// Mihon's cancel all; the server also stops the downloader.
var CLEAR_PAYLOAD = { query: "mutation { clearDownloader(input: {}) { " + STATUS + " } }" }

// queue.state: "loading" | "ok" | a failed connection state.
// running: the downloader is started. items: in queue order, each
// { chapterId, mangaId, manga, chapter, chapterNumber, uploadDate (ms),
// state, progress, tries, sourceMissing } with state "QUEUED" | "DOWNLOADING" | "FINISHED" | "ERROR" and progress 0..1.
function initial() {
  return { state: "loading", message: "", running: false, items: [] }
}

// Every download mutation answers with the status, under its own name.
function statusIn(data) {
  if (data.downloadStatus) return data.downloadStatus
  for (var k in data) if (data[k] && data[k].downloadStatus) return data[k].downloadStatus
  return null
}

function item(d) {
  return {
    chapterId: d.chapter.id,
    mangaId: d.chapter.mangaId,
    manga: String(d.manga.title || ""),
    chapter: String(d.chapter.name || ""),
    chapterNumber: Number(d.chapter.chapterNumber),
    uploadDate: Number(d.chapter.uploadDate),
    state: d.state,
    progress: Number(d.progress) || 0,
    tries: d.tries,
    sourceMissing: d.manga.source === null
  }
}

function queueOf(running, items) {
  return { state: "ok", message: "", running: running, items: items }
}

// A finished download leaves the server's queue, as a dequeued one does.
// The rest change in place, or move to their position when they are new
// or moved.
function changed(items, updates) {
  var next = items.slice()
  updates.forEach(function(u) {
    var at = next.findIndex(function(i) { return i.chapterId === u.download.chapter.id })
    if (at !== -1) next.splice(at, 1)
    if (u.type === "DEQUEUED" || u.type === "FINISHED") return
    next.splice(at !== -1 && u.type !== "POSITION" ? at : Math.min(u.download.position, next.length), 0, item(u.download))
  })
  return next
}

// event.type:
//   "reply" { reply } for STATUS_QUERY or any download mutation
//   "live"  { data } for a LIVE_QUERY result
// A failed request keeps the queue shown and only changes state.
function reduce(q, event) {
  if (event.type === "live") {
    var l = event.data.downloadStatusChanged
    if (!l) return q
    return queueOf(l.state === "STARTED", l.initial ? l.initial.map(item) : changed(q.items, l.updates || []))
  }
  if (event.type !== "reply") return q
  var r = event.reply
  var s = r.state === "ok" ? statusIn(r.data) : null
  if (!s) return { state: r.state === "ok" ? q.state : r.state, message: r.message, running: q.running, items: q.items }
  return queueOf(s.state === "STARTED", (s.queue || []).map(item))
}

// Whether a LIVE_QUERY result left changes out, so the queue is due a
// STATUS_QUERY.
function omitted(data) {
  return !!(data.downloadStatusChanged && data.downloadStatusChanged.omittedUpdates)
}

// The items in before that next no longer holds: finished, or taken out.
function left(before, next) {
  var still = {}
  next.forEach(function(i) { still[i.chapterId] = true })
  return before.filter(function(i) { return !still[i.chapterId] })
}

// The queue stays live while the overlay shows or anything waits in it.
// Downloads the server starts on its own, as new chapters, show once the
// overlay opens or a download reply lists them.
function live(q, overlayOpen) {
  return overlayOpen || q.items.length > 0
}

// chapters: newest first, as Browse.detail holds them. anchor: -1, or where
// v started the selection.
function marked(chapters, cursor, anchor) {
  if (anchor < 0) return chapters[cursor] ? [chapters[cursor]] : []
  return chapters.slice(Math.min(cursor, anchor), Math.max(cursor, anchor) + 1)
}

function ids(chapters) {
  return chapters.map(function(c) { return c.id })
}

// Queues the chapters not on disk yet, or null when all are.
function enqueuePayload(chapters) {
  var todo = chapters.filter(function(c) { return !c.downloaded })
  return todo.length ? { query: ENQUEUE_MUTATION, variables: { ids: ids(todo) } } : null
}

function find(items, chapterId) {
  for (var i = 0; i < items.length; i++) if (items[i].chapterId === chapterId) return items[i]
  return null
}

// Takes the chapters out of the queue and off the disk, or null when none
// is queued or downloaded. Only queued ids are dequeued: the server waits
// 30 s for any other id and then fails.
function removePayload(chapters, items) {
  var queued = chapters.filter(function(c) { return find(items, c.id) })
  var held = chapters.filter(function(c) { return c.downloaded || find(items, c.id) })
  if (!held.length) return null
  if (!queued.length) return deletePayload(ids(held))
  return { query: REMOVE_MUTATION, variables: { queued: ids(queued), ids: ids(held) } }
}

// Mihon's delete after reading, from the deleteAfterRead setting: how many
// read chapters back from the one finished the delete goes, or -1 for off.
var SLOTS = { "false": -1, "true": 0, "1": 1, "2": 2, "3": 3, "4": 4 }

function deleteSlots(setting) {
  return SLOTS[setting] === undefined ? -1 : SLOTS[setting]
}

// A category's meta flag that keeps the downloads of its manga.
var KEEP_KEY = "miharchy.keepDownloads"

// What an automatic delete needs to know of each chapter.
function autoDeleteQuery(chapterIds) {
  return {
    query: "query($ids: [Int!]!) { chapters(filter: { id: { in: $ids } }) { nodes { id isRead isBookmarked isDownloaded"
      + " manga { categories { nodes { meta { key value } } } } } } }",
    variables: { ids: chapterIds }
  }
}

// meta: a category's [{ key, value }].
function keepsDownloads(meta) {
  return meta.some(function(m) { return m.key === KEEP_KEY && m.value === "true" })
}

function keeps(manga) {
  return manga.categories.nodes.some(function(c) { return keepsDownloads(c.meta) })
}

// Deletes the chapters of an autoDeleteQuery() reply that Mihon's
// getChaptersToDelete lets go: on disk, read, not bookmarked unless
// deleteBookmarked, and in no category that keeps its downloads. Mihon's
// check of those categories reads the chapters from before a mark read,
// so it never keeps one; here it does. readIds: chapters read whose save
// may not have reached the server yet. null when none goes.
function autoDeletePayload(data, deleteBookmarked, readIds) {
  var gone = data.chapters.nodes.filter(function(c) {
    return c.isDownloaded && (c.isRead || readIds.indexOf(c.id) !== -1) && (deleteBookmarked || !c.isBookmarked) && !keeps(c.manga)
  })
  return gone.length ? deletePayload(ids(gone)) : null
}

function deletePayload(chapterIds) {
  return { query: DELETE_MUTATION, variables: { ids: chapterIds } }
}

function dequeuePayload(chapterId) {
  return { query: DEQUEUE_MUTATION, variables: { ids: [chapterId] } }
}

function chapterIds(items) {
  return items.map(function(i) { return i.chapterId })
}

// The queue's chapter ids with items[index] moved to position to, clamped:
// Mihon's move up, down, to the top and to the bottom.
function moved(q, index, to) {
  var order = chapterIds(q.items)
  var id = order.splice(index, 1)[0]
  order.splice(Math.max(0, Math.min(order.length, to)), 0, id)
  return order
}

// The queue's chapter ids sorted by key, "chapterNumber" or "uploadDate":
// ascending, or descending when the queue already runs ascending. Mihon
// offers both directions of each sort; here one key flips between them.
function sorted(q, key) {
  var by = function(sign) {
    return chapterIds(q.items.slice().sort(function(a, b) { return sign * (a[key] - b[key]) }))
  }
  var up = by(1)
  return String(up) === String(chapterIds(q.items)) ? by(-1) : up
}

// Puts the queue in order (chapter ids) with one reorderChapterDownload
// per item out of place, all in one request; null when nothing moves.
// Only the last move answers with the status, so a long queue does not
// come back once per move.
function orderPayload(q, order) {
  var now = chapterIds(q.items)
  var moves = []
  order.forEach(function(id, to) {
    if (now[to] === id) return
    now.splice(now.indexOf(id), 1)
    now.splice(to, 0, id)
    moves.push("m" + to + ": reorderChapterDownload(input: { chapterId: " + id + ", to: " + to + " })")
  })
  if (!moves.length) return null
  return { query: "mutation { " + moves.join(" { clientMutationId } ") + " { " + STATUS + " } }" }
}

function togglePayload(q) {
  return { query: q.running ? STOP_MUTATION : START_MUTATION }
}

function progressText(item) {
  switch (item.state) {
    case "DOWNLOADING": return Math.floor(item.progress * 100) + "%"
    case "ERROR": return "failed"
    case "FINISHED": return "downloaded"
  }
  return "queued"
}

// Suwayomi keeps no reason for a failed download, so the queue asks for
// the chapter's pages once and labels what goes wrong (Failure.js).
// reasons: { chapterId: Failure.reason, or null while its probe is out },
// for failed items only: an item that is retried (no longer ERROR) or
// leaves the queue loses its reason, so a new failure is probed again.
// A manga with no source needs no probe. -> { reasons, probe: the chapter
// ids to probe now }.
function failed(items, reasons) {
  var next = {}
  var probe = []
  items.forEach(function(i) {
    if (i.state !== "ERROR") return
    var id = i.chapterId
    if (reasons[id] !== undefined) next[id] = reasons[id]
    else if (i.sourceMissing) next[id] = Failure.reason("Source not installed")
    else {
      next[id] = null
      probe.push(id)
    }
  })
  return { reasons: next, probe: probe }
}

var PROBE_MUTATION = "mutation($id: Int!) { fetchChapterPages(input: { chapterId: $id }) { pages } }"

function probePayload(chapterId) {
  return { query: PROBE_MUTATION, variables: { id: chapterId } }
}

// The reasons once the probe of chapterId answers (reply as Model.reply
// gives). Only a probe still waited on lands. One the server never
// answered drops out, so the next queue change probes again. Pages that
// load leave no error to read; no pages is what the downloader logs.
function probed(reasons, chapterId, reply) {
  if (reasons[chapterId] !== null) return reasons
  var next = Object.assign({}, reasons)
  if (reply.state === "ok") {
    var pages = reply.data.fetchChapterPages ? reply.data.fetchChapterPages.pages : []
    next[chapterId] = Failure.reason(pages.length ? "Its pages load now" : "Chapter does not have any pages to download")
  } else if (reply.state === "error") next[chapterId] = Failure.reason(reply.message)
  else delete next[chapterId]
  return next
}

// A queue row's status: progressText, and on a failed row its reason and
// hint once known.
function statusText(item, reason, flareOn) {
  var text = progressText(item)
  if (item.state !== "ERROR" || !reason) return text
  var hint = Failure.hint(reason, flareOn)
  return text + "   " + reason.text + (hint ? "   " + hint : "")
}

// What the chapter list shows beside a chapter: "" when it is neither
// queued nor on disk.
function marker(chapter, items) {
  var item = find(items, chapter.id)
  if (item) return progressText(item)
  return chapter.downloaded ? "downloaded" : ""
}

if (typeof module !== "undefined") {
  module.exports = {
    STATUS_QUERY: STATUS_QUERY,
    LIVE_QUERY: LIVE_QUERY,
    CLEAR_PAYLOAD: CLEAR_PAYLOAD,
    initial: initial,
    reduce: reduce,
    omitted: omitted,
    left: left,
    live: live,
    marked: marked,
    enqueuePayload: enqueuePayload,
    removePayload: removePayload,
    deletePayload: deletePayload,
    KEEP_KEY: KEEP_KEY,
    keepsDownloads: keepsDownloads,
    deleteSlots: deleteSlots,
    autoDeleteQuery: autoDeleteQuery,
    autoDeletePayload: autoDeletePayload,
    dequeuePayload: dequeuePayload,
    moved: moved,
    sorted: sorted,
    orderPayload: orderPayload,
    togglePayload: togglePayload,
    progressText: progressText,
    failed: failed,
    probePayload: probePayload,
    probed: probed,
    statusText: statusText,
    marker: marker
  }
}
