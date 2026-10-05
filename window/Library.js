.pragma library
.import "Prefs.js" as Prefs
.import "Chapters.js" as Chapters

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

// Mihon's display modes, its three cover grids folded into one; the grid's
// columns follow the window width.
var DISPLAYS = [
  { id: "grid", label: "Cover grid" },
  { id: "list", label: "List" }
]

// Mihon's overlay badges and tab item count, each on or off; all start
// off, as in Mihon. The unread badge always shows.
var TOGGLES = [
  { kind: "badge", key: "libraryBadgeDownloads", label: "Downloaded chapters" },
  { kind: "badge", key: "libraryBadgeLanguage", label: "Language" },
  { kind: "tabs", key: "libraryTabCounts", label: "Number of items" }
]

// One sort for the whole library, as Mihon keeps it unless its per-category
// display setting is on.
var PREFS = [
  { key: "librarySort", default: "title", options: SORTS.map(function(s) { return s.id }) },
  { key: "librarySortDirection", default: "asc", options: ["asc", "desc"] },
  { key: "libraryDisplay", default: "grid", options: DISPLAYS.map(function(d) { return d.id }) }
].concat(FILTERS.map(function(f) { return { key: filterKey(f), default: "off", options: STATES } }))
  .concat(TOGGLES.map(function(t) { return { key: t.key, default: "off", options: ["off", "on"] } }))

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
// "desc" on the chosen one and "" on the rest, then each display mode with
// "picked" on the chosen one and "unpicked" on the rest, then the badges
// and the tab count, "on" or "off".
function rows(prefs) {
  return FILTERS.map(function(f) {
    return { kind: "filter", id: f.id, label: f.label, state: prefs[filterKey(f)] }
  }).concat(SORTS.map(function(s) {
    return { kind: "sort", id: s.id, label: s.label, state: s === sortOf(prefs) ? prefs.librarySortDirection : "" }
  })).concat(DISPLAYS.map(function(d) {
    return { kind: "display", id: d.id, label: d.label, state: d.id === prefs.libraryDisplay ? "picked" : "unpicked" }
  })).concat(TOGGLES.map(function(t) {
    return { kind: t.kind, id: t.key, label: t.label, state: prefs[t.key] }
  }))
}

// The other display mode, as { key, value } for Prefs: one key switches
// between the grid and the list.
function toggleDisplay(prefs) {
  return { key: "libraryDisplay", value: prefs.libraryDisplay === "list" ? "grid" : "list" }
}

// What Enter on a panel row changes, as { key, value } for Prefs.
function choose(prefs, row) {
  if (row.kind === "filter") return { key: filterKey(row), value: STATES[(STATES.indexOf(row.state) + 1) % STATES.length] }
  if (row.kind === "display") return { key: "libraryDisplay", value: row.id }
  if (row.kind === "badge" || row.kind === "tabs") return { key: row.id, value: row.state === "on" ? "off" : "on" }
  if (row.state) return { key: "librarySortDirection", value: row.state === "asc" ? "desc" : "asc" }
  return { key: "librarySort", value: row.id }
}

// What a manga's cover shows: unread always, downloads and the source's
// language when their badge is on; 0 and "" show nothing.
function badges(m, prefs) {
  return {
    unread: m.unread,
    downloads: prefs.libraryBadgeDownloads === "on" ? m.downloads : 0,
    lang: prefs.libraryBadgeLanguage === "on" ? m.lang.toUpperCase() : ""
  }
}

// A category tab's name, with its manga count when the tab count is on or
// a search runs, as Mihon. entry: a Model.switcher() entry, already
// searched and filtered.
function tabLabel(entry, prefs, query) {
  return entry.name + (prefs.libraryTabCounts === "on" || words(query).length ? " (" + entry.manga.length + ")" : "")
}

// Mihon's continue reading button: the manga's next unread chapter, by its
// own chapter filters and sort (Chapters.PREFS), or null. chapters: as
// Browse.toChapters() builds them.
function continueChapter(chapters, chapterPrefs) {
  return Chapters.nextUnread(Chapters.apply(chapters, chapterPrefs), chapterPrefs)
}

// The actions on selected manga (Mihon's library selection) take their
// chapters from one query; Browse.toChapters() gives them the shape the
// chapter actions read.
var CHAPTERS_QUERY = "query($ids: [Int!]) { chapters(filter: { mangaId: { in: $ids } }) {"
  + " nodes { id name chapterNumber uploadDate isRead isBookmarked lastPageRead isDownloaded scanlator sourceOrder } } }"
var REMOVE_MUTATION = "mutation($ids: [Int!]!) { updateMangas(input: { ids: $ids, patch: { inLibrary: false } }) { mangas { id inLibrary } } }"
var CATEGORIES_MUTATION = "mutation($ids: [Int!]!, $add: [Int!]!, $remove: [Int!]!) {"
  + " updateMangasCategories(input: { ids: $ids, patch: { addToCategories: $add, removeFromCategories: $remove } }) { mangas { id } } }"

function chaptersPayload(mangaIds) {
  return { query: CHAPTERS_QUERY, variables: { ids: mangaIds } }
}

// Takes the manga out of the library. Their chapters, read state and
// downloads stay, as in Mihon.
function removePayload(mangaIds) {
  return { query: REMOVE_MUTATION, variables: { ids: mangaIds } }
}

// Mihon's change category dialog for many manga: each user category is
// "all" when every manga is in it, "some" when a few are, else "none".
// manga: the chosen manga, as Model.fromResponse() builds them.
function categoryRows(categories, manga) {
  return categories.map(function(c) {
    var n = manga.filter(function(m) { return m.categories.indexOf(c.id) !== -1 }).length
    return { id: c.id, name: c.name, state: n === 0 ? "none" : n === manga.length ? "all" : "some" }
  })
}

// Choosing a row puts every manga in that category, or takes every manga
// out once all are in it.
function categoryPayload(row, mangaIds) {
  var out = row.state === "all"
  return { query: CATEGORIES_MUTATION, variables: { ids: mangaIds, add: out ? [] : [row.id], remove: out ? [row.id] : [] } }
}

// "the manga" for one, "3 manga" for more: what an armed x or X acts on.
function count(n) {
  return n === 1 ? "the manga" : n + " manga"
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
    toggleDisplay: toggleDisplay,
    badges: badges,
    continueChapter: continueChapter,
    chaptersPayload: chaptersPayload,
    removePayload: removePayload,
    categoryRows: categoryRows,
    categoryPayload: categoryPayload,
    count: count,
    tabLabel: tabLabel,
    choose: choose,
    narrowed: narrowed,
    summary: summary
  }
}
