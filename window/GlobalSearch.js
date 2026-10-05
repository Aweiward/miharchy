.pragma library
.import "Browse.js" as Browse

// One query across every listed source, grouped by source. Each group is a
// Browse search listing, so it reduces, fails and reads out the same way as
// a single source's search. Pure, so tests/global.test.js pins it;
// BrowseView.qml sends the payloads and feeds replies back by group index.

// Mihon's global search runs 5 sources at once (SearchViewModel's
// limitedParallelism(5)); each search is a live fetch from a site.
var LIMIT = 5

// The sources a search runs on, pinned first (Mihon's SearchViewModel),
// or only the pinned ones (its PinnedOnly filter). pinned: source ids.
function sources(list, pinned, pinnedOnly) {
  var isPinned = function(s) { return pinned.indexOf(s.id) !== -1 }
  var mine = list.filter(function(s) { return !pinnedOnly || isPinned(s) })
  return mine.filter(isPinned).concat(mine.filter(function(s) { return !isPinned(s) }))
}

// What the list shows: with onlyResults, Mihon's has-results filter, only
// the groups that finished with something; the rest wait out of sight.
// Cursor moves and picks index this, not the search.
function shown(s, onlyResults) {
  if (!onlyResults) return s
  return { query: s.query, groups: s.groups.filter(function(g) { return g.state === "ok" && g.items.length > 0 }) }
}

// The line in place of an empty list, or "".
function empty(s, view, pinnedOnly) {
  if (view.groups.length) return ""
  if (!s.groups.length) return pinnedOnly ? "No pinned source. Press p to search every source." : "No source to search. Press esc, then tab to install an extension."
  if (s.groups.some(function(g) { return g.state === "idle" || g.state === "loading" })) return "Searching"
  return "No source found anything. Press F to show every source."
}

function filterLabel(pinnedOnly, onlyResults) {
  return [pinnedOnly ? "pinned sources only" : "", onlyResults ? "only sources with results" : ""].filter(function(t) { return t }).join(", ")
}

function search(sources, query) {
  return { query: query, groups: sources.map(function(s) { return Browse.listing(s, "search", query) }) }
}

function payload(group) {
  return Browse.listingPayload(group)
}

// The indexes of the groups to start now: queued groups, as many as there
// are free slots (limit, LIMIT by default). Only the first page loads, so
// a group starts once.
function due(s, limit) {
  var busy = s.groups.filter(function(g) { return g.state === "loading" }).length
  var out = []
  for (var i = 0; i < s.groups.length && out.length < (limit || LIMIT) - busy; i++) {
    if (s.groups[i].state === "idle" && s.groups[i].page === 0) out.push(i)
  }
  return out
}

// QML's XHR ignores its timeout, so the view gives up on a source itself.
// 30 s is the connect and read timeout of Suwayomi's and Mihon's HTTP
// clients; only their 2-minute call timeout would free the slot otherwise.
var TIMEOUT = 30000

// event: a Browse.reduceListing event for the group at index.
// "request" also carries now (ms); it numbers the attempt and sets its
// deadline. "reply" carries the attempt it answers and is dropped unless
// that request is still waiting. "timeout" gives up on a waiting group.
function reduce(s, index, event) {
  var g = s.groups[index]
  var next
  switch (event.type) {
    case "request":
      next = Object.assign(Browse.reduceListing(g, event), { attempt: (g.attempt || 0) + 1, deadline: event.now + TIMEOUT })
      break
    case "reply":
      if (g.state !== "loading" || event.attempt !== g.attempt) return s
      next = Browse.reduceListing(g, event)
      break
    case "timeout":
      if (g.state !== "loading") return s
      next = Object.assign({}, g, { state: "timeout", message: "" })
      break
    default:
      next = Browse.reduceListing(g, event)
  }
  return { query: s.query, groups: s.groups.map(function(o, i) { return i === index ? next : o }) }
}

// The indexes of the waiting groups past their deadline at now (ms).
function expired(s, now) {
  var out = []
  s.groups.forEach(function(g, i) { if (g.state === "loading" && g.deadline <= now) out.push(i) })
  return out
}

function retry(s) {
  return { query: s.query, groups: s.groups.map(function(g) { return Browse.reduceListing(g, { type: "retry" }) }) }
}

function markInLibrary(s, mangaId, inLibrary) {
  return { query: s.query, groups: s.groups.map(function(g) { return Browse.markInLibrary(g, mangaId, inLibrary) }) }
}

// One line per group: "waiting", "searching", "timed out", "N results",
// or its notice.
function status(group, configPath) {
  if (group.state === "idle") return "waiting"
  if (group.state === "loading") return "searching"
  if (group.state === "timeout") return "timed out. Press r to retry."
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
    TIMEOUT: TIMEOUT,
    sources: sources,
    shown: shown,
    empty: empty,
    filterLabel: filterLabel,
    search: search,
    payload: payload,
    due: due,
    reduce: reduce,
    expired: expired,
    retry: retry,
    markInLibrary: markInLibrary,
    status: status,
    move: move,
    current: current
  }
}
