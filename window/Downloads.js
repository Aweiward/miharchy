.pragma library

// Downloads: the server's download queue and the chapters a manga detail
// marks for download or removal. Pure, so tests/downloads.test.js pins it;
// shell.qml polls the queue, and MangaDetail.qml and DownloadsView.qml send
// the payloads built here.

var STATUS = "downloadStatus { state queue { state progress tries chapter { id name mangaId } manga { id title } } }"
var STATUS_QUERY = "{ " + STATUS + " }"
var ENQUEUE_MUTATION = "mutation($ids: [Int!]!) { enqueueChapterDownloads(input: { ids: $ids }) { " + STATUS + " } }"
var DEQUEUE_MUTATION = "mutation($ids: [Int!]!) { dequeueChapterDownloads(input: { ids: $ids }) { " + STATUS + " } }"
var DELETE_MUTATION = "mutation($ids: [Int!]!) { deleteDownloadedChapters(input: { ids: $ids }) { chapters { id isDownloaded } } }"
// Mutation fields run in order, so a download in flight stops before its
// folder goes.
var REMOVE_MUTATION = "mutation($queued: [Int!]!, $ids: [Int!]!) { dequeueChapterDownloads(input: { ids: $queued }) { " + STATUS + " }"
  + " deleteDownloadedChapters(input: { ids: $ids }) { chapters { id isDownloaded } } }"
var START_MUTATION = "mutation { startDownloader(input: {}) { " + STATUS + " } }"
var STOP_MUTATION = "mutation { stopDownloader(input: {}) { " + STATUS + " } }"

// queue.state: "loading" | "ok" | a failed connection state.
// running: the downloader is started. items: in queue order, each
// { chapterId, mangaId, manga, chapter, state, progress, tries } with
// state "QUEUED" | "DOWNLOADING" | "FINISHED" | "ERROR" and progress 0..1.
function initial() {
  return { state: "loading", message: "", running: false, items: [] }
}

// Every download mutation answers with the status, under its own name.
function statusIn(data) {
  if (data.downloadStatus) return data.downloadStatus
  for (var k in data) if (data[k] && data[k].downloadStatus) return data[k].downloadStatus
  return null
}

// event.type: "reply" { reply } for a poll or any download mutation.
// A failed request keeps the queue shown and only changes state.
function reduce(q, event) {
  if (event.type !== "reply") return q
  var r = event.reply
  var s = r.state === "ok" ? statusIn(r.data) : null
  if (!s) return { state: r.state === "ok" ? q.state : r.state, message: r.message, running: q.running, items: q.items }
  return {
    state: "ok",
    message: "",
    running: s.state === "STARTED",
    items: (s.queue || []).map(function(d) {
      return {
        chapterId: d.chapter.id,
        mangaId: d.chapter.mangaId,
        manga: String(d.manga.title || ""),
        chapter: String(d.chapter.name || ""),
        state: d.state,
        progress: Number(d.progress) || 0,
        tries: d.tries
      }
    })
  }
}

// The items in before that next no longer holds: finished, or taken out.
function left(before, next) {
  var still = {}
  next.forEach(function(i) { still[i.chapterId] = true })
  return before.filter(function(i) { return !still[i.chapterId] })
}

// Downloads the server starts on its own, as new chapters, show once the
// overlay opens; nothing polls an idle queue.
function polling(q, overlayOpen) {
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

function deletePayload(chapterIds) {
  return { query: DELETE_MUTATION, variables: { ids: chapterIds } }
}

function dequeuePayload(chapterId) {
  return { query: DEQUEUE_MUTATION, variables: { ids: [chapterId] } }
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
    initial: initial,
    reduce: reduce,
    left: left,
    polling: polling,
    marked: marked,
    enqueuePayload: enqueuePayload,
    removePayload: removePayload,
    deletePayload: deletePayload,
    dequeuePayload: dequeuePayload,
    togglePayload: togglePayload,
    progressText: progressText,
    marker: marker
  }
}
