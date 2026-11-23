.pragma library
.import "Failure.js" as Failure

// Downloads: miharchy-core's download queue (ADR 0010) and the chapters a
// manga detail marks for download or removal. Pure, so tests/downloads.test.js
// pins it; DownloadsView.qml keeps the queue live, and it and MangaDetail.qml
// send the payloads built here.

// queue.state: "loading" | "ok" | a failed connection state.
// running: the downloader is started. items: in queue order, each
// { chapterId, mangaId, manga, chapter, chapterNumber, uploadDate (ms),
// state, progress, tries, sourceMissing } with state "QUEUED" | "DOWNLOADING" | "FINISHED" | "ERROR" and progress 0..1.
function initial() {
  return { state: "loading", message: "", running: false, items: [] }
}

// Whether a manga's chapters can be downloaded or deleted: those of the local
// source (id 0) are files already, so its detail offers neither.
function offered(manga) {
  return !(manga && manga.sourceId === "0")
}

// Every download route answers with the plain status, { state, queue }.
function statusIn(data) {
  return data.queue ? data : null
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
    sourceMissing: d.manga.source === null,
    // Core keeps why a download failed: { kind, message }.
    error: d.error || null
  }
}

function queueOf(running, items) {
  return { state: "ok", message: "", running: running, items: items }
}

// event.type:
//   "reply" { reply } for download.queue or any download route
//   "live"  { data } for a result of core's "downloads" topic, which sends
//           the whole status each time
// A failed request keeps the queue shown and only changes state.
function reduce(q, event) {
  if (event.type === "live") {
    if (!event.data || !event.data.queue) return q
    return queueOf(event.data.state === "STARTED", event.data.queue.map(item))
  }
  if (event.type !== "reply") return q
  var r = event.reply
  var s = r.state === "ok" ? statusIn(r.data) : null
  if (!s) return { state: r.state === "ok" ? q.state : r.state, message: r.message, running: q.running, items: q.items }
  return queueOf(s.state === "STARTED", (s.queue || []).map(item))
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

// miharchy-core's download routes (ADR 0010), each answering with the status.
function statusPayload() {
  return { route: "download.queue" }
}

// Mihon's cancel all; core also stops the downloader.
function clearPayload() {
  return { route: "download.clear" }
}

// Queues the chapters not on disk yet, or null when all are.
function enqueuePayload(chapters) {
  var todo = chapters.filter(function(c) { return !c.downloaded })
  return todo.length ? { route: "download.enqueue", body: { ids: ids(todo) } } : null
}

function find(items, chapterId) {
  for (var i = 0; i < items.length; i++) if (items[i].chapterId === chapterId) return items[i]
  return null
}

// Takes the chapters out of the queue and off the disk, or null when none
// is queued or downloaded. Core's delete dequeues first and takes any id.
function removePayload(chapters, items) {
  var held = chapters.filter(function(c) { return c.downloaded || find(items, c.id) })
  return held.length ? deletePayload(ids(held)) : null
}

// Mihon's delete after reading, from the deleteAfterRead setting: how many
// read chapters back from the one finished the delete goes, or -1 for off.
var SLOTS = { "false": -1, "true": 0, "1": 1, "2": 2, "3": 3, "4": 4 }

function deleteSlots(setting) {
  return SLOTS[setting] === undefined ? -1 : SLOTS[setting]
}

// A category's meta flag that keeps the downloads of its manga.
var KEEP_KEY = "miharchy.keepDownloads"

// What an automatic delete needs to know of each chapter, as the reply
// autoDeletePayload reads: send(payload, done) is Session.send on the core
// config. Core takes the chapters by id and the library's categories with
// their metas, in two routes.
function autoDeleteLoad(send, chapterIds, done) {
  send({ route: "chapter.list", body: { ids: chapterIds } }, function(ch) {
    if (ch.state !== "ok") return done(ch)
    send({ route: "library.list" }, function(lib) {
      if (lib.state !== "ok") return done(lib)
      var metas = {}
      lib.data.categories.forEach(function(c) { metas[c.id] = c.meta || [] })
      var cats = {}
      lib.data.mangas.forEach(function(m) { cats[m.id] = m.categories })
      done({ state: "ok", data: { chapters: { nodes: ch.data.chapters.map(function(c) {
        return { id: c.id, isRead: c.isRead, isBookmarked: c.isBookmarked, isDownloaded: c.isDownloaded,
          manga: { categories: { nodes: (cats[c.mangaId] || []).map(function(id) { return { meta: metas[id] || [] } }) } } }
      }) } } })
    })
  })
}

// meta: a category's [{ key, value }].
function keepsDownloads(meta) {
  return meta.some(function(m) { return m.key === KEEP_KEY && m.value === "true" })
}

function keeps(manga) {
  return manga.categories.nodes.some(function(c) { return keepsDownloads(c.meta) })
}

// Deletes the chapters of an autoDeleteLoad() reply that Mihon's
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
  return { route: "download.delete", body: { ids: chapterIds } }
}

function dequeuePayload(chapterId) {
  return { route: "download.dequeue", body: { ids: [chapterId] } }
}

// chapterIds: failed downloads, all in the queue.
// Core requeues a failed chapter in its place, keeping its tries.
function retryPayload(chapterIds) {
  return chapterIds.length ? { route: "download.enqueue", body: { ids: chapterIds } } : null
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

// Puts the queue in order (chapter ids) with one download.reorder, or null
// when nothing moves.
function orderPayload(q, order) {
  var now = chapterIds(q.items)
  return order.some(function(id, i) { return now[i] !== id }) ? { route: "download.reorder", body: { order: order } } : null
}

function togglePayload(q) {
  return { route: q.running ? "download.stop" : "download.start" }
}

function progressText(item) {
  switch (item.state) {
    case "DOWNLOADING": return Math.floor(item.progress * 100) + "%"
    case "ERROR": return "failed"
    case "FINISHED": return "downloaded"
  }
  return "queued"
}

// Core keeps the reason with each failed item, and Failure.coreReason
// labels it (Failure.js).
// reasons: { chapterId: Failure.reason } for failed items only: an item that
// is retried (no longer ERROR) or leaves the queue loses its reason, so a
// new failure is labelled again. -> { reasons }.
function failed(items, reasons) {
  var next = {}
  items.forEach(function(i) {
    if (i.state !== "ERROR") return
    var id = i.chapterId
    next[id] = reasons[id] !== undefined ? reasons[id] : Failure.coreReason(i.error)
  })
  return { reasons: next }
}

// A queue row's status: progressText, and on a failed row its reason once
// known. flareOn is unused: core's reasons carry no hint.
function statusText(item, reason, flareOn) {
  var text = progressText(item)
  if (item.state !== "ERROR" || !reason) return text
  return text + "   " + reason.text
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
    statusPayload: statusPayload,
    clearPayload: clearPayload,
    autoDeleteLoad: autoDeleteLoad,
    initial: initial,
    reduce: reduce,
    left: left,
    live: live,
    offered: offered,
    marked: marked,
    enqueuePayload: enqueuePayload,
    removePayload: removePayload,
    deletePayload: deletePayload,
    KEEP_KEY: KEEP_KEY,
    keepsDownloads: keepsDownloads,
    deleteSlots: deleteSlots,
    autoDeletePayload: autoDeletePayload,
    dequeuePayload: dequeuePayload,
    retryPayload: retryPayload,
    moved: moved,
    sorted: sorted,
    orderPayload: orderPayload,
    togglePayload: togglePayload,
    progressText: progressText,
    failed: failed,
    statusText: statusText,
    marker: marker
  }
}
