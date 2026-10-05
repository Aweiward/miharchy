.pragma library
.import "Prefs.js" as Prefs

// Chapter actions any view can run on a set of chapters: mark read or
// unread, bookmark, and push the trackers after. Also the manga's chapter
// list as shown: its filters and sort (Mihon's chapterFlags), the next
// chapter to read. Pure, so tests/chapters.test.js pins it; shell.qml's
// markChapters() sends the action payloads, for every view.

// Setting lastPageRead also stamps lastReadAt, which puts the chapter in the
// history, so only chapters with a page read get the reset; Suwayomi skips an
// empty id list.
var MARK_MUTATION = "mutation($ids: [Int!]!, $started: [Int!]!, $read: Boolean!) {"
  + " marked: updateChapters(input: { ids: $ids, patch: { isRead: $read } }) { chapters { id } }"
  + " reset: updateChapters(input: { ids: $started, patch: { isRead: false, lastPageRead: 0 } }) { chapters { id } } }"

var BOOKMARK_MUTATION = "mutation($ids: [Int!]!, $bookmarked: Boolean!) {"
  + " marked: updateChapters(input: { ids: $ids, patch: { isBookmarked: $bookmarked } }) { chapters { id } } }"

// chapters: [{ id, read, lastPage }]. Mihon's SetReadStatus: marking read
// touches the unread chapters and keeps their page; marking unread touches
// the read or started ones and sends them back to page 1. null when nothing
// changes.
function markPayload(chapters, read) {
  var todo = chapters.filter(function(c) { return read ? !c.read : c.read || c.lastPage > 0 })
  if (!todo.length) return null
  var started = read ? [] : todo.filter(function(c) { return c.lastPage > 0 })
  var ids = todo.filter(function(c) { return started.indexOf(c) === -1 }).map(function(c) { return c.id })
  return { query: MARK_MUTATION, variables: { ids: ids, started: started.map(function(c) { return c.id }), read: read } }
}

// One key toggles: Mihon's menu offers bookmark while any chapter lacks
// one, else remove. null when nothing changes.
function bookmarkPayload(chapters) {
  var bookmarked = chapters.some(function(c) { return !c.bookmarked })
  var todo = chapters.filter(function(c) { return c.bookmarked !== bookmarked })
  return todo.length ? { query: BOOKMARK_MUTATION, variables: { ids: todo.map(function(c) { return c.id }), bookmarked: bookmarked } } : null
}

// The GraphQL updateChapters leaves the trackers alone (only Suwayomi's REST
// call pushes), so a mark read asks for the push. The server sends each
// tracker the highest read chapter number, when it is above the tracker's.
// null for no manga: an empty mutation is a GraphQL error.
function trackPayload(mangaIds) {
  if (!mangaIds.length) return null
  var fields = mangaIds.filter(function(id, i) { return mangaIds.indexOf(id) === i }).map(function(id) {
    return "m" + id + ": trackProgress(input: { mangaId: " + Number(id) + " }) { trackRecords { id lastChapterRead } }"
  })
  return { query: "mutation { " + fields.join(" ") + " }" }
}

// Chapters here are the shape Browse.toChapters() builds.
var FILTERS = [
  { id: "unread", label: "Unread", test: function(c) { return !c.read } },
  { id: "downloaded", label: "Downloaded", test: function(c) { return c.downloaded } },
  { id: "bookmarked", label: "Bookmarked", test: function(c) { return c.bookmarked } }
]

// Mihon's alphabetical sort is left out.
var SORTS = [
  { id: "source", label: "By source", value: function(c) { return c.sourceOrder } },
  { id: "number", label: "By chapter number", value: function(c) { return c.number } },
  { id: "uploadDate", label: "By upload date", value: function(c) { return c.uploadDate } }
]

function filterKey(f) {
  return "chapterFilter" + f.id.charAt(0).toUpperCase() + f.id.slice(1)
}

// Kept per manga through Prefs (with a mangaId); the global value is the
// default for every manga. Source order, newest first, as Mihon starts.
var PREFS = FILTERS.map(function(f) { return { key: filterKey(f), default: "off", options: Prefs.TRI_STATE } }).concat([
  { key: "chapterSort", default: "source", options: SORTS.map(function(s) { return s.id }) },
  { key: "chapterSortDirection", default: "desc", options: ["asc", "desc"] }
])

function sortOf(prefs) {
  return SORTS.filter(function(s) { return s.id === prefs.chapterSort })[0] || SORTS[0]
}

// The chapters that pass every filter, sorted; descending is newest first,
// and source order breaks ties. A copy: the list given stays in source
// order, which the reader turns chapters by.
function apply(chapters, prefs) {
  var sort = sortOf(prefs)
  var dir = prefs.chapterSortDirection === "asc" ? 1 : -1
  return chapters.filter(function(c) { return passes(c, prefs) }).sort(function(a, b) {
    return dir * ((sort.value(a) - sort.value(b)) || (a.sourceOrder - b.sourceOrder))
  })
}

function passes(c, prefs) {
  return FILTERS.every(function(f) {
    var state = prefs[filterKey(f)]
    return state === "off" || f.test(c) === (state === "include")
  })
}

// The reader's chapter list, like Mihon's ReaderViewModel.chapterList: the
// manga's chosen sort, read ascending whatever the list's direction. skip:
// the { read, filtered, dupe } reader settings. Skip read and skip filtered
// drop chapters; skip duplicates keeps one chapter per chapter number: the
// one opened, else one by its scanlator, else the first in reading order.
// The chapter opened always stays. Newest first, because the reader
// reverses its input.
function readingOrder(chapters, prefs, chapterId, skip) {
  var sort = sortOf(prefs)
  var opened = chapters.filter(function(c) { return c.id === chapterId })[0]
  var list = chapters.filter(function(c) {
    return c === opened || !(skip.read && c.read) && !(skip.filtered && !passes(c, prefs))
  }).sort(function(a, b) {
    return (sort.value(a) - sort.value(b)) || (a.sourceOrder - b.sourceOrder)
  })
  if (skip.dupe && opened) {
    var groups = {}
    var numbers = []
    list.forEach(function(c) {
      if (!groups[c.number]) { groups[c.number] = []; numbers.push(c.number) }
      groups[c.number].push(c)
    })
    list = numbers.map(function(n) {
      var g = groups[n]
      return g.indexOf(opened) !== -1 ? opened : g.filter(function(c) { return c.scanlator === opened.scanlator })[0] || g[0]
    })
  }
  return list.reverse()
}

// The panel: each filter with its state, each sort with "asc" or "desc" on
// the chosen one and "" on the rest, then the two ways to save as default.
function rows(prefs) {
  return FILTERS.map(function(f) {
    return { kind: "filter", id: f.id, label: f.label, state: prefs[filterKey(f)] }
  }).concat(SORTS.map(function(s) {
    return { kind: "sort", id: s.id, label: s.label, state: s === sortOf(prefs) ? prefs.chapterSortDirection : "" }
  })).concat([
    { kind: "default", id: "default", label: "Save as default", state: "" },
    { kind: "default", id: "defaultAll", label: "Save as default for every manga in the library", state: "" }
  ])
}

// What Enter on a row changes, as [{ key, value }] for Prefs. Mihon's
// SetMangaChapterFlags: the chosen sort flips, a new one starts ascending.
function choose(prefs, row) {
  if (row.kind === "filter") return [{ key: filterKey(row), value: Prefs.TRI_STATE[(Prefs.TRI_STATE.indexOf(row.state) + 1) % Prefs.TRI_STATE.length] }]
  if (row.kind !== "sort") return []
  if (row.state) return [{ key: "chapterSortDirection", value: row.state === "asc" ? "desc" : "asc" }]
  return [{ key: "chapterSort", value: row.id }, { key: "chapterSortDirection", value: "asc" }]
}

// Mihon's "mark previous as read": the chapters before the one under the
// cursor in reading order, among those shown. shown: apply()'s list.
function previous(shown, cursor, prefs) {
  return prefs.chapterSortDirection === "asc" ? shown.slice(0, cursor) : shown.slice(cursor + 1)
}

// Mihon's getNextUnread: the first unread chapter in reading order among
// those shown, or null.
function nextUnread(shown, prefs) {
  var unread = shown.filter(function(c) { return !c.read })
  if (!unread.length) return null
  return prefs.chapterSortDirection === "asc" ? unread[0] : unread[unread.length - 1]
}

// Mihon says Start until any chapter is read. "" with nothing to read.
function resumeLabel(chapters, next) {
  if (!next) return ""
  if (!chapters.some(function(c) { return c.read })) return "Start"
  return "Resume " + (next.number >= 0 ? "chapter " + next.number : next.name)
}

if (typeof module !== "undefined") {
  module.exports = {
    PREFS: PREFS,
    markPayload: markPayload,
    bookmarkPayload: bookmarkPayload,
    trackPayload: trackPayload,
    apply: apply,
    readingOrder: readingOrder,
    rows: rows,
    choose: choose,
    previous: previous,
    nextUnread: nextUnread,
    resumeLabel: resumeLabel
  }
}
