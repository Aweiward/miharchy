.pragma library
.import "Model.js" as Model

// The History view: the chapters the user opened, one entry per manga (its
// most recent chapter, as in Mihon), newest first. Pure, so
// tests/history.test.js pins it; HistoryView.qml sends the payloads and
// feeds replies back through reduce().
//
// Suwayomi has no way to delete history: lastReadAt changes only when
// lastPageRead is saved, which is read state. So removing hides instead.
// An entry hides while its lastReadAt is at or below a cutoff in meta: the
// manga's for one entry, the global one for all. Opening a chapter again
// stamps a later lastReadAt, which brings it back.

var HIDDEN_KEY = "miharchy.historyHiddenAt"
var CLEARED_KEY = "miharchy.historyClearedAt"

// ponytail: one page of the newest chapters; a manga whose last open lies
// past it does not show. Page with `after` if that bites.
var QUERY = "{ metas(condition: { key: \"" + CLEARED_KEY + "\" }) { nodes { value } }"
  + " chapters(filter: { lastReadAt: { greaterThan: \"0\" } }, order: [{ by: LAST_READ_AT, byType: DESC }], first: 500) {"
  + " nodes { id name lastReadAt lastPageRead pageCount isRead manga { id title thumbnailUrl meta { key value } } } } }"

var REMOVE_MUTATION = "mutation($meta: MangaMetaTypeInput!) { setMangaMeta(input: { meta: $meta }) { meta { key value } } }"
var CLEAR_MUTATION = "mutation($key: String!, $value: String!) { setGlobalMeta(input: { meta: { key: $key, value: $value } }) { meta { key value } } }"

function copy(o, changes) {
  var c = {}
  for (var k in o) c[k] = o[k]
  for (var j in changes) c[j] = changes[j]
  return c
}

// history.state: "loading" | "ok" | a failed connection state. entries
// stay through a reload or a failure. Each entry: { mangaId, title, cover,
// chapterId, chapter, page, pages, read, at } with at in epoch seconds.
function initial() {
  return { state: "loading", message: "", entries: [] }
}

function metaValue(meta, key) {
  var m = (meta || []).filter(function(m) { return m.key === key })[0]
  return m ? Number(m.value) || 0 : 0
}

function entries(data, config) {
  var cleared = Number(((data.metas && data.metas.nodes) || []).map(function(m) { return m.value })[0]) || 0
  var seen = {}
  var out = []
  ;((data.chapters && data.chapters.nodes) || []).forEach(function(c) {
    var at = Number(c.lastReadAt) || 0
    if (seen[c.manga.id] || at <= Math.max(cleared, metaValue(c.manga.meta, HIDDEN_KEY))) return
    seen[c.manga.id] = true
    out.push({
      mangaId: c.manga.id,
      title: String(c.manga.title || ""),
      cover: Model.coverUrl(config, c.manga.thumbnailUrl),
      chapterId: c.id,
      chapter: String(c.name || ""),
      page: c.lastPageRead || 0,
      pages: c.pageCount,
      read: c.isRead === true,
      at: at
    })
  })
  return out
}

// event.type: "config-missing" | "request" | "reply" { reply, config }
function reduce(h, event) {
  switch (event.type) {
    case "config-missing":
      return { state: "no-config", message: "", entries: [] }
    case "request":
      return copy(h, { state: "loading", message: "" })
    case "reply":
      if (event.reply.state !== "ok") return copy(h, { state: event.reply.state, message: event.reply.message })
      return { state: "ok", message: "", entries: entries(event.reply.data, event.config) }
  }
  return h
}

// The cutoffs are the server's own lastReadAt, so the local clock never
// decides what hides.
function removePayload(entry) {
  return { query: REMOVE_MUTATION, variables: { meta: { mangaId: entry.mangaId, key: HIDDEN_KEY, value: String(entry.at) } } }
}

function clearPayload(list) {
  return list.length ? { query: CLEAR_MUTATION, variables: { key: CLEARED_KEY, value: String(list[0].at) } } : null
}

function progress(entry) {
  if (entry.read) return "read"
  return "page " + (entry.page + 1) + (entry.pages > 0 ? " / " + entry.pages : "")
}

function pad(n) {
  return n < 10 ? "0" + n : String(n)
}

function date(d) {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
}

// The day heading for a time, against now; both in epoch seconds.
function day(at, now) {
  var d = date(new Date(at * 1000))
  var today = new Date(now * 1000)
  if (d === date(today)) return "Today"
  today.setDate(today.getDate() - 1)
  return d === date(today) ? "Yesterday" : d
}

function time(at) {
  var d = new Date(at * 1000)
  return pad(d.getHours()) + ":" + pad(d.getMinutes())
}

// The entries whose manga title holds query, ignoring case, as Mihon's
// history search (a LIKE on the title).
function search(entries, query) {
  var q = String(query || "").trim().toLowerCase()
  return q ? entries.filter(function(e) { return e.title.toLowerCase().indexOf(q) !== -1 }) : entries
}

// { title, detail } in place of the list, or null when entries show.
function notice(h, configPath, query) {
  if (h.entries.length && search(h.entries, query).length) return null
  if (h.entries.length) return { title: "No history matches \"" + String(query).trim() + "\"", detail: "Esc clears the search." }
  if (h.state === "loading") return { title: "Loading the history", detail: "" }
  var p = Model.problem(h, configPath)
  if (p) return p
  return { title: "No history yet", detail: "Chapters you open show up here." }
}

if (typeof module !== "undefined") {
  module.exports = {
    QUERY: QUERY,
    initial: initial,
    reduce: reduce,
    removePayload: removePayload,
    clearPayload: clearPayload,
    progress: progress,
    day: day,
    time: time,
    search: search,
    notice: notice
  }
}
