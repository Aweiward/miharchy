.pragma library
.import "Prefs.js" as Prefs

// The Library's search, filters and sort, after Mihon's library sheet and
// toolbar search. Pure, so tests/library.test.js pins it; shell.qml runs
// apply() on the library before Model.switcher() groups it by category.
// The choices live in server meta through Prefs.js (PREFS); the search
// does not persist, as in Mihon.

var STATES = Prefs.TRI_STATE

// A manga is the shape Model.fromResponse() builds.
var FILTERS = [
  { id: "downloaded", label: "Downloaded", test: function(m) { return m.downloads > 0 } },
  { id: "unread", label: "Unread", test: function(m) { return m.unread > 0 } },
  { id: "started", label: "Started", test: function(m) { return m.read > 0 } },
  { id: "bookmarked", label: "Bookmarked", test: function(m) { return m.bookmarks > 0 } },
  { id: "completed", label: "Completed", test: function(m) { return m.status === "COMPLETED" } },
  { id: "tracked", label: "Tracked", test: function(m) { return m.tracks > 0 } }
]

// Mihon's order. Mihon's chapter fetch date, tracker score and random
// sorts are left out.
var SORTS = [
  { id: "title", label: "Title" },
  { id: "total", label: "Total chapters", value: function(m) { return m.total } },
  { id: "lastRead", label: "Last read", value: function(m) { return m.lastRead } },
  { id: "lastUpdate", label: "Last update", value: function(m) { return m.lastUpdate } },
  { id: "unread", label: "Unread count" },
  { id: "latestChapter", label: "Latest chapter", value: function(m) { return m.latestUpload } },
  { id: "added", label: "Date added", value: function(m) { return m.added } }
]

function filterKey(f) {
  return "libraryFilter" + f.id.charAt(0).toUpperCase() + f.id.slice(1)
}

// One sort for the whole library, as Mihon keeps it unless its per-category
// display setting is on.
var PREFS = [
  { key: "librarySort", default: "title", options: SORTS.map(function(s) { return s.id }) },
  { key: "librarySortDirection", default: "asc", options: ["asc", "desc"] }
].concat(FILTERS.map(function(f) { return { key: filterKey(f), default: "off", options: STATES } }))

function sortOf(prefs) {
  return SORTS.filter(function(s) { return s.id === prefs.librarySort })[0] || SORTS[0]
}

function words(query) {
  return String(query || "").toLowerCase().split(/\s+/).filter(function(w) { return w })
}

function searchable(m) {
  return [m.title, m.author, m.artist].concat(m.genre).join("\n").toLowerCase()
}

function byTitle(a, b) {
  return a.title.toLowerCase().localeCompare(b.title.toLowerCase())
}

function comparator(prefs) {
  var sort = sortOf(prefs)
  var dir = prefs.librarySortDirection === "desc" ? -1 : 1
  var primary = function(a, b) {
    if (sort.id === "title") return dir * byTitle(a, b)
    if (sort.id !== "unread") return dir * (sort.value(a) - sort.value(b))
    // Manga with nothing unread go last either way.
    if (a.unread === b.unread) return 0
    if (a.unread === 0) return 1
    if (b.unread === 0) return -1
    return dir * (a.unread - b.unread)
  }
  return function(a, b) { return primary(a, b) || byTitle(a, b) || a.id - b.id }
}

// The manga that match the search and every active filter, sorted.
function apply(manga, prefs, query) {
  var w = words(query)
  return manga.filter(function(m) {
    var text = w.length ? searchable(m) : ""
    for (var i = 0; i < w.length; i++) if (text.indexOf(w[i]) === -1) return false
    return FILTERS.every(function(f) {
      var state = prefs[filterKey(f)]
      return state === "off" || f.test(m) === (state === "include")
    })
  }).sort(comparator(prefs))
}

// The panel: each filter with its state, then each sort with "asc" or
// "desc" on the chosen one and "" on the rest.
function rows(prefs) {
  return FILTERS.map(function(f) {
    return { kind: "filter", id: f.id, label: f.label, state: prefs[filterKey(f)] }
  }).concat(SORTS.map(function(s) {
    return { kind: "sort", id: s.id, label: s.label, state: s === sortOf(prefs) ? prefs.librarySortDirection : "" }
  }))
}

// What Enter on a panel row changes, as { key, value } for Prefs.
function choose(prefs, row) {
  if (row.kind === "filter") return { key: filterKey(row), value: STATES[(STATES.indexOf(row.state) + 1) % STATES.length] }
  if (row.state) return { key: "librarySortDirection", value: row.state === "asc" ? "desc" : "asc" }
  return { key: "librarySort", value: row.id }
}

// Whether the search or a filter may hide manga.
function narrowed(prefs, query) {
  return words(query).length > 0 || FILTERS.some(function(f) { return prefs[filterKey(f)] !== "off" })
}

// The category header's note: the search, the active filters, and the sort
// when it is not the default; "" for none.
function summary(prefs, query) {
  var parts = []
  var q = String(query || "").trim()
  if (q) parts.push("/ " + q)
  var on = FILTERS.filter(function(f) { return prefs[filterKey(f)] !== "off" }).map(function(f) {
    return (prefs[filterKey(f)] === "exclude" ? "not " : "") + f.label.toLowerCase()
  })
  if (on.length) parts.push(on.join(", "))
  var sort = sortOf(prefs)
  if (sort !== SORTS[0] || prefs.librarySortDirection !== "asc") parts.push(sort.label.toLowerCase() + (prefs.librarySortDirection === "desc" ? " ↓" : " ↑"))
  return parts.join("   ")
}

if (typeof module !== "undefined") {
  module.exports = {
    PREFS: PREFS,
    apply: apply,
    rows: rows,
    choose: choose,
    narrowed: narrowed,
    summary: summary
  }
}
