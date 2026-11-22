.pragma library
.import "Prefs.js" as Prefs
.import "Library.js" as Library
.import "Browse.js" as Browse
.import "Chapters.js" as Chapters

// The download menu for a set of manga: the Library's selection or shown
// category tab (d), or every manga in Up next (the palette). Each manga's
// chapter list is fetched first, one at a time; then pick() takes the
// chapters to queue from one read of the whole set. The run (label, chapters
// queued, refresh failures) stays in window memory. Pure, so
// tests/nextchapters.test.js pins it; NextChaptersMenu.qml sends the payloads.

// The row each menu last ran, as rowKey() gives it: the manga's (U) and
// the set's (Library d, Up next).
var KEYS = Chapters.DOWNLOADS.map(rowKey)
var MENU_PREFS = [
  { key: "downloadMenuManga", default: KEYS[0], options: KEYS },
  { key: "downloadMenuSet", default: KEYS[0], options: KEYS }
]

function rowKey(row) {
  return row.id + (row.id === "next" ? row.count : "")
}

function rowIndex(key) {
  return Math.max(0, KEYS.indexOf(key))
}

// set: { label, manga: [{ id, title }] }. shown: Model.switcher()'s entry,
// filtered and sorted as the tab shows it.
function librarySet(shown, selected) {
  if (!selected.length) return { label: shown.name, manga: shown.manga.map(brief) }
  var manga = shown.manga.filter(function(m) { return selected.indexOf(m.id) !== -1 }).map(brief)
  return { label: manga.length === 1 ? manga[0].title : manga.length + " manga", manga: manga }
}

// list: UpNext.list(), all of it.
function upNextSet(list) {
  return { label: "Up next", manga: list.map(function(e) { return { id: e.mangaId, title: e.title } }) }
}

function brief(m) {
  return { id: m.id, title: m.title }
}

// The payloads and loads here are miharchy-core's routes (ADR 0010). A
// load's send(payload, done) is Session.send on core's config.
function refreshPayload(mangaId) {
  return { route: "manga.refresh", body: { id: mangaId } }
}

// The chapters of the set and their prefs: the manga's chapters, then the
// global and the manga's own chapter prefs in one meta.get.
function readLoad(send, mangaIds, done) {
  send({ route: "chapter.list", body: { mangaIds: mangaIds } }, function(ch) {
    if (ch.state !== "ok") return done(ch)
    var keys = Prefs.keys(Library.CHAPTER_PREFS)
    send({ route: "meta.get", body: { queries: [{ scope: "global", keys: keys }, { scope: "manga", owners: mangaIds, keys: keys }] } }, function(meta) {
      if (meta.state !== "ok") return done(meta)
      var own = function(id) { return meta.data.metas.filter(function(m) { return m.scope === "manga" && m.owner === id }) }
      done({ state: "ok", data: {
        metas: { nodes: meta.data.metas.filter(function(m) { return m.scope === "global" }) },
        mangas: { nodes: mangaIds.map(function(id) {
          return { id: id, meta: own(id), chapters: { nodes: ch.data.chapters.filter(function(c) { return c.mangaId === id }) } }
        }) }
      } })
    })
  })
}

// data: readLoad()'s reply. The chapters to queue: not on disk and not
// in the queue (items: Downloads queue items). "next" tops up: the next
// count unread chapters by the manga's own filters and excluded scanlators,
// Downloaded only and the downloaded filter off, so chapters already on
// disk count toward count. "unread" and "bookmarked" take every such
// chapter, as the Library's d always has.
function pick(data, row, count, items) {
  var out = []
  data.mangas.nodes.forEach(function(m) {
    var chapters = Browse.toChapters(m.chapters.nodes)
    var list = row.id === "next" ? Chapters.toDownload(chapters, Library.chapterPrefs({ metas: data.metas, manga: m }, false), true, row, count)
      : chapters.filter(function(c) { return row.id === "unread" ? !c.read : c.bookmarked })
    list.forEach(function(c) { if (!c.downloaded && !items.some(function(i) { return i.chapterId === c.id })) out.push(c) })
  })
  return out
}

// The run: state "refreshing" until queued() ends it. failures: [{
// mangaId, title, message }], message as the server sent it.
function start(set, row, count) {
  var what = row.id !== "next" ? row.label : count === 1 ? "Next chapter" : "Next " + count + " chapters"
  return { label: what + " of " + set.label, mangaIds: set.manga.map(function(m) { return m.id }), queued: [], failures: [], state: "refreshing" }
}

function failed(run, manga, message) {
  return Object.assign({}, run, { failures: run.failures.concat([{ mangaId: manga.id, title: manga.title, message: message }]) })
}

function queued(run, chapterIds) {
  return Object.assign({}, run, { queued: chapterIds, state: "done" })
}

// The run in the download queue. A finished download leaves the queue as a
// dequeued one does, so the queue view keeps marks, { chapterId: "seen" |
// "out" | "disk" }: a run chapter the queue has shown, or what settle() or
// goneMarks() read from the server. items: Downloads queue items. updates
// stays for the callers' sake; core sends none.
function track(marks, run, items, updates) {
  var next = Object.assign({}, marks)
  items.forEach(function(i) {
    if (run.queued.indexOf(i.chapterId) !== -1) next[i.chapterId] = "seen"
  })
  return next
}

function inRun(run, items) {
  return items.filter(function(i) { return run.queued.indexOf(i.chapterId) !== -1 })
}

// The live queue alone cannot end a run. So once the window's queue holds
// none of the run's chapters queued or downloading, the view reads
// settleLoad and settle() decides.
function looksOver(run, items) {
  return run.state === "done" && run.queued.length > 0
    && !inRun(run, items).some(function(i) { return i.state === "QUEUED" || i.state === "DOWNLOADING" })
}

// The queue, then the run's chapters by id.
function settleLoad(send, run, done) {
  send({ route: "download.queue" }, function(q) {
    if (q.state !== "ok") return done(q)
    send({ route: "chapter.list", body: { ids: run.queued } }, function(ch) {
      if (ch.state !== "ok") return done(ch)
      done({ state: "ok", data: { downloadStatus: { queue: q.data.queue }, chapters: { nodes: ch.data.chapters } } })
    })
  })
}

// data: settleLoad()'s reply. Each run chapter outside the window's
// queue is "disk" when the server has it on disk, taken out ("out") when
// its queue no longer holds it either, else unchanged: the live queue
// lags, so it still waits.
function settle(marks, run, items, data) {
  var next = Object.assign({}, marks)
  var queued = data.downloadStatus.queue.map(function(d) { return d.chapter.id })
  data.chapters.nodes.forEach(function(c) {
    if (run.queued.indexOf(c.id) === -1 || items.some(function(i) { return i.chapterId === c.id })) return
    if (c.isDownloaded) next[c.id] = "disk"
    else if (queued.indexOf(c.id) === -1) next[c.id] = "out"
  })
  return next
}

// The run's chapters among items, which left the queue: each is "disk" or
// "out" by chapter.list's isDownloaded (chapters) once that reply is in.
function goneIds(run, items) {
  return run ? items.map(function(i) { return i.chapterId }).filter(function(id) { return run.queued.indexOf(id) !== -1 }) : []
}

function goneMarks(marks, chapters) {
  var next = Object.assign({}, marks)
  chapters.forEach(function(c) { next[c.id] = c.isDownloaded ? "disk" : "out" })
  return next
}

// -> { onDisk, queued, failed: [chapterId] } over the run's chapters: in
// the queue by its state; out of it, on disk once seen or settled so, and
// still to come when never seen (the queue lags the enqueue reply). One
// taken out counts nowhere.
function tally(run, items, marks) {
  var t = { onDisk: 0, queued: 0, failed: [] }
  run.queued.forEach(function(id) {
    var item = items.find(function(i) { return i.chapterId === id })
    if (item) {
      if (item.state === "ERROR") t.failed.push(id)
      else if (item.state !== "FINISHED") t.queued++
      else t.onDisk++
    } else if (marks[id] === "seen" || marks[id] === "disk") t.onDisk++
    else if (marks[id] !== "out") t.queued++
  })
  return t
}

function ended(run, t) {
  return run.state === "done" && t.queued === 0
}

// A run with nothing queued and no failure leaves the menu's note only.
function shown(run) {
  return !!run && (run.state === "refreshing" || run.queued.length > 0 || run.failures.length > 0)
}

function counts(run, t) {
  if (run.state === "refreshing") return "fetching chapters"
  var parts = [t.onDisk + " on disk"]
  if (t.queued) parts.push(t.queued + " queued")
  if (t.failed.length) parts.push(t.failed.length + " failed")
  if (run.failures.length) parts.push(run.failures.length + " manga could not fetch chapters")
  return parts.join(", ")
}

function summary(run, t) {
  return run.label + ": " + counts(run, t)
}

// The desktop notification at the end of a run, or null when it queued
// nothing (the menu's note says so) or every chapter of it was taken out.
function notifyCommand(run, t) {
  if (!t.onDisk && !t.failed.length) return null
  return ["notify-send", "-a", "Miharchy", "--", run.label, counts(run, t)]
}

if (typeof module !== "undefined") {
  module.exports = {
    MENU_PREFS: MENU_PREFS,
    rowKey: rowKey,
    rowIndex: rowIndex,
    librarySet: librarySet,
    upNextSet: upNextSet,
    refreshPayload: refreshPayload,
    readLoad: readLoad,
    settleLoad: settleLoad,
    goneIds: goneIds,
    goneMarks: goneMarks,
    pick: pick,
    start: start,
    failed: failed,
    queued: queued,
    track: track,
    looksOver: looksOver,
    settle: settle,
    tally: tally,
    ended: ended,
    shown: shown,
    summary: summary,
    notifyCommand: notifyCommand
  }
}
