.pragma library

// Chapter actions any view can run on a set of chapters: mark read or
// unread, and push the trackers after. Pure, so tests/chapters.test.js pins
// it; shell.qml's markChapters() sends the payloads, for every view.

// Setting lastPageRead also stamps lastReadAt, which puts the chapter in the
// history, so only chapters with a page read get the reset; Suwayomi skips an
// empty id list.
var MARK_MUTATION = "mutation($ids: [Int!]!, $started: [Int!]!, $read: Boolean!) {"
  + " marked: updateChapters(input: { ids: $ids, patch: { isRead: $read } }) { chapters { id } }"
  + " reset: updateChapters(input: { ids: $started, patch: { isRead: false, lastPageRead: 0 } }) { chapters { id } } }"

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

// Mihon's "mark previous as read": the chapters below the cursor in a
// newest-first list, without the one under it.
function previous(chapters, cursor) {
  return chapters.slice(cursor + 1)
}

// The GraphQL updateChapters leaves the trackers alone (only Suwayomi's REST
// call pushes), so a mark read asks for the push. The server sends each
// tracker the highest read chapter number, when it is above the tracker's.
function trackPayload(mangaIds) {
  var fields = mangaIds.filter(function(id, i) { return mangaIds.indexOf(id) === i }).map(function(id) {
    return "m" + id + ": trackProgress(input: { mangaId: " + Number(id) + " }) { trackRecords { id lastChapterRead } }"
  })
  return { query: "mutation { " + fields.join(" ") + " }" }
}

if (typeof module !== "undefined") {
  module.exports = {
    markPayload: markPayload,
    previous: previous,
    trackPayload: trackPayload
  }
}
