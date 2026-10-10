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

function refreshPayload(mangaId) {
  return { query: "mutation($id: Int!) { fetchChapters(input: { mangaId: $id }) { chapters { id } } }", variables: { id: mangaId } }
}

function readPayload(mangaIds) {
  return {
    query: "query($keys: [String!], $ids: [Int!]) { metas(filter: { key: { in: $keys } }) { nodes { key value } }"
      + " mangas(filter: { id: { in: $ids } }) { nodes { id meta { key value }"
      + " chapters { nodes { id name chapterNumber uploadDate isRead isBookmarked lastPageRead isDownloaded scanlator sourceOrder } } } } }",
    variables: { keys: Prefs.keys(Library.CHAPTER_PREFS), ids: mangaIds }
  }
}

// data: readPayload()'s reply. The chapters to queue: not on disk and not
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

if (typeof module !== "undefined") {
  module.exports = {
    MENU_PREFS: MENU_PREFS,
    rowKey: rowKey,
    rowIndex: rowIndex,
    librarySet: librarySet,
    upNextSet: upNextSet,
    refreshPayload: refreshPayload,
    readPayload: readPayload,
    pick: pick,
    start: start,
    failed: failed,
    queued: queued
  }
}
