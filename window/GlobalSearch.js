.pragma library
.import "Browse.js" as Browse

// One query across every listed source, grouped by source. Each group is a
// Browse search listing, so it reduces, fails and reads out the same way as
// a single source's search. Pure, so tests/global.test.js pins it;
// BrowseView.qml sends the payloads and feeds replies back by group index.

// Mihon's global search runs 5 sources at once (SearchViewModel's
// limitedParallelism(5)); each search is a live fetch from a site.
var LIMIT = 5

function search(sources, query) {
  return { query: query, groups: sources.map(function(s) { return Browse.listing(s, "search", query) }) }
}

function payload(group) {
  return Browse.listingPayload(group)
}

// The indexes of the groups to start now: queued groups, as many as there
// are free slots. Only the first page loads, so a group starts once.
function due(s) {
  var busy = s.groups.filter(function(g) { return g.state === "loading" }).length
  var out = []
  for (var i = 0; i < s.groups.length && out.length < LIMIT - busy; i++) {
    if (s.groups[i].state === "idle" && s.groups[i].page === 0) out.push(i)
  }
  return out
}

// event: a Browse.reduceListing event for the group at index.
function reduce(s, index, event) {
  return { query: s.query, groups: s.groups.map(function(g, i) { return i === index ? Browse.reduceListing(g, event) : g }) }
}

function retry(s) {
  return { query: s.query, groups: s.groups.map(function(g) { return Browse.reduceListing(g, { type: "retry" }) }) }
}

function markInLibrary(s, mangaId, inLibrary) {
  return { query: s.query, groups: s.groups.map(function(g) { return Browse.markInLibrary(g, mangaId, inLibrary) }) }
}

// One line per group: "waiting", "searching", "N results", or its notice.
function status(group, configPath) {
  if (group.state === "idle") return "waiting"
  if (group.state === "loading") return "searching"
  var n = Browse.notice(group, configPath)
  if (n) return n.detail && group.state !== "ok" ? n.title + ". " + n.detail : n.title
  return group.items.length + (group.items.length === 1 ? " result" : " results")
}

// cursor: { row: group index, col: result index }. The column clamps to
// the row's results, so moving onto a shorter row pulls it in.
function move(s, cursor, dRow, dCol) {
  var row = Math.max(0, Math.min(s.groups.length - 1, cursor.row + dRow))
  var count = s.groups.length ? s.groups[row].items.length : 0
  return { row: row, col: Math.max(0, Math.min(count - 1, cursor.col + dCol)) }
}

function current(s, cursor) {
  var g = s.groups[cursor.row]
  return (g && g.items[cursor.col]) || null
}

if (typeof module !== "undefined") {
  module.exports = {
    LIMIT: LIMIT,
    search: search,
    payload: payload,
    due: due,
    reduce: reduce,
    retry: retry,
    markInLibrary: markInLibrary,
    status: status,
    move: move,
    current: current
  }
}
