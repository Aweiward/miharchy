.pragma library
.import "Downloads.js" as Downloads

// The window's state model: which view shows, and where the server
// connection stands. Pure, so tests/model.test.js pins it; shell.qml owns
// the I/O and feeds results back through reduce().

var VIEWS = [
  { id: "library", title: "Library", key: "1" },
  { id: "updates", title: "Updates", key: "2" },
  { id: "history", title: "History", key: "3" },
  { id: "browse", title: "Browse", key: "4" },
  { id: "settings", title: "Settings", key: "5" }
]

// The sync helper stores source names from phone backups here, id -> name.
var SOURCE_NAMES_META = "miharchy.sourceNames"

var LIBRARY_QUERY = "{ categories(orderBy: ORDER) { nodes { id name includeInDownload includeInUpdate meta { key value } } }"
  + " metas(condition: { key: \"" + SOURCE_NAMES_META + "\" }) { nodes { value } }"
  + " mangas(condition: {inLibrary: true}) { nodes { id title author artist genre status thumbnailUrl sourceId source { id displayName lang } unreadCount downloadCount bookmarkCount inLibraryAt"
  + " chapters { totalCount } lastReadChapter { lastReadAt } latestUploadedChapter { uploadDate } latestFetchedChapter { fetchedAt }"
  + " trackRecords { totalCount } categories { nodes { id } } } } }"

var LIBRARY_MUTATION = "mutation($id: Int!, $inLibrary: Boolean!) { updateManga(input: { id: $id, patch: { inLibrary: $inLibrary } }) { manga { id inLibrary } } }"

// Suwayomi's built-in "Default" category holds the manga in no category, as
// in Mihon. It is never a user category, the same rule as the sync helper.
var DEFAULT_CATEGORY = 0
var ALL = -1

// server.json text -> { url, username, password } with the url's trailing
// slash dropped, or null when the text is missing, not JSON, or lacks a key.
function parseConfig(text) {
  var c
  try {
    c = JSON.parse(text)
  } catch (e) {
    return null
  }
  if (!c || typeof c.url !== "string" || typeof c.username !== "string" || typeof c.password !== "string") return null
  if (!c.url) return null
  return { url: c.url.replace(/\/+$/, ""), username: c.username, password: c.password }
}

// Puts a manga in the library or takes it out. Its chapters, read state
// and downloads stay, as in Mihon.
function inLibraryPayload(mangaId, inLibrary) {
  return { query: LIBRARY_MUTATION, variables: { id: mangaId, inLibrary: inLibrary } }
}

// "http://host:port/path" -> { origin: "http://host:port", rest: "/path" },
// null for anything else. origin is lowercased for comparison.
function splitUrl(url) {
  var m = /^(https?):\/\/([^\/?#]*)(.*)$/i.exec(url)
  return m ? { origin: (m[1] + "://" + m[2]).toLowerCase(), authority: m[2], rest: m[3] } : null
}

// An image URL's path on the server, or null when it is not the server's.
// Thumbnail URLs come from sources, so only a server-relative path or an
// exact match of the server's scheme, host and port counts.
function serverPath(config, url) {
  if (url.charAt(0) === "/" && url.charAt(1) !== "/") return url
  var server = splitUrl(config.url)
  var u = splitUrl(url)
  if (!server || !u || u.authority.indexOf("@") !== -1 || u.origin !== server.origin) return null
  return u.rest
}

// The URL an image loads from: a server path made absolute, anything else
// untouched. It never carries credentials; see serverImageUrl.
function coverUrl(config, thumbnailUrl) {
  if (!thumbnailUrl) return ""
  var url = String(thumbnailUrl)
  var path = serverPath(config, url)
  return path === null ? url : config.url + path
}

// QML Image can't send an Authorization header, so ServerImage.qml fetches
// a server image itself, with the access token: the absolute URL of the
// server's own images, null for any other host, which gets no token and
// loads as a plain Image.
function serverImageUrl(config, url) {
  if (!config || !url) return null
  var path = serverPath(config, String(url))
  return path === null ? null : config.url + path
}

// Whether a cover shows the title tile instead of the image.
function placeholder(cover, failed) {
  return !cover || failed
}

// connection.state: "loading" | "ok" | "no-config" | "down" | "unauthorized" | "error"
// manga and categories are set only in "ok"; message only in "error".
function initial() {
  return { state: "loading", manga: [], categories: [], message: "" }
}

function conn(state, extra) {
  var c = { state: state, manga: [], categories: [], message: "" }
  for (var k in extra) c[k] = extra[k]
  return c
}

// event.type:
//   "config-missing"  server.json is absent or unreadable
//   "request"         a library request went out
//   "response"        { reply, config }, reply as reply() gives
function reduce(connection, event) {
  switch (event.type) {
    case "config-missing":
      return conn("no-config")
    case "request":
      // Keep the shown library while a reload is in flight.
      return conn("loading", connection.state === "ok" ? { manga: connection.manga, categories: connection.categories } : {})
    case "response":
      return fromResponse(event.reply, event.config)
  }
  return connection
}

// Any GraphQL answer -> { state, message, data } with state "ok" (and the
// reply's data), "down", "unauthorized" or "error" (and a message).
function reply(status, body) {
  var fail = function(state, message) { return { state: state, message: message || "", data: null } }
  if (status === 0) return fail("down")
  if (status === 401) return fail("unauthorized")
  if (status !== 200) return fail("error", "The server answered HTTP " + status + ".")
  var json
  try {
    json = JSON.parse(body)
  } catch (e) {
    return fail("error", "The server sent a reply that is not JSON.")
  }
  if (json.errors && json.errors.length) {
    var message = errorText(json.errors[0].message)
    // ui_login answers a missing or expired access token this way, with 200.
    return message === "Unauthorized" ? fail("unauthorized") : fail("error", message)
  }
  return { state: "ok", message: "", data: json.data || {} }
}

// Suwayomi wraps an exception as "Exception while fetching data (/path) :
// message" followed by its stack trace; only the message is for people.
function errorText(message) {
  var first = String(message || "GraphQL error").split(/\r?\n/)[0]
  return first.replace(/^Exception while fetching data \([^)]*\) : /, "").trim() || "GraphQL error"
}

// Reply data with the SOURCE_NAMES_META node -> { sourceId: name }.
function parseNames(data) {
  var node = ((data.metas && data.metas.nodes) || [])[0]
  try {
    var names = JSON.parse(node ? node.value : "{}")
    return names && typeof names === "object" ? names : {}
  } catch (e) {
    return {}
  }
}

// n: a manga node with sourceId and source { displayName }, null when the
// source is not installed. names: parseNames().
function sourceLabel(n, names) {
  if (n.source) return String(n.source.displayName || n.sourceId)
  var name = names[n.sourceId]
  return name ? name + " (not installed)" : "Unknown source " + n.sourceId
}

function fromResponse(r, config) {
  if (r.state !== "ok") return conn(r.state, { message: r.message })
  var nodes = r.data.mangas && r.data.mangas.nodes
  if (!Array.isArray(nodes)) return conn("error", { message: "The server's reply has no library." })
  var ids = function(list) { return ((list && list.nodes) || []).map(function(c) { return c.id }) }
  // Timestamps come as LongString; 0 means never.
  var time = function(chapter, field) { return Number(chapter && chapter[field]) || 0 }
  var names = parseNames(r.data)
  return conn("ok", {
    manga: nodes.map(function(n) {
      var total = (n.chapters && n.chapters.totalCount) || 0
      var unread = n.unreadCount || 0
      return {
        id: n.id,
        title: String(n.title || ""),
        // The server fetches a cover through its source, so without one it only fails.
        cover: n.source ? coverUrl(config, n.thumbnailUrl) : "",
        categories: ids(n.categories),
        source: sourceLabel(n, names),
        lang: n.source ? String(n.source.lang || "") : "",
        unread: unread,
        author: String(n.author || ""),
        artist: String(n.artist || ""),
        genre: n.genre || [],
        status: String(n.status || ""),
        total: total,
        // Suwayomi has no read count; Mihon's "started" means one is read.
        read: Math.max(0, total - unread),
        downloads: n.downloadCount || 0,
        bookmarks: n.bookmarkCount || 0,
        tracks: (n.trackRecords && n.trackRecords.totalCount) || 0,
        lastRead: time(n.lastReadChapter, "lastReadAt"),
        latestUpload: time(n.latestUploadedChapter, "uploadDate"),
        // Mihon's last update is when the chapter list last changed.
        lastUpdate: time(n.latestFetchedChapter, "fetchedAt"),
        added: time(n, "inLibraryAt")
      }
    }),
    categories: ((r.data.categories && r.data.categories.nodes) || [])
      .filter(function(c) { return c.id !== DEFAULT_CATEGORY })
      .map(function(c) { return { id: c.id, name: String(c.name), download: c.includeInDownload || "UNSET", update: c.includeInUpdate || "UNSET", keep: Downloads.keepsDownloads(c.meta || []) } })
  })
}

// The Library's category switcher, each entry { id, name, manga }: All, and
// once the user has categories, Default (manga in none) and one per
// category. A manga in several categories shows under each of them.
function switcher(connection) {
  var all = { id: ALL, name: "All", manga: connection.manga }
  if (!connection.categories.length) return [all]
  var on = function(id) {
    return connection.manga.filter(function(m) {
      return id === DEFAULT_CATEGORY ? m.categories.length === 0 : m.categories.indexOf(id) !== -1
    })
  }
  return [all, { id: DEFAULT_CATEGORY, name: "Default", manga: on(DEFAULT_CATEGORY) }].concat(connection.categories.map(function(c) {
    return { id: c.id, name: c.name, manga: on(c.id) }
  }))
}

// The index of the entry with this id, or 0 (All) once it is gone.
function switcherIndex(list, id) {
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return i
  return 0
}

// What the library view shows for a connection and its shown category: null
// for the cover grid, otherwise { title, detail }. narrowed: a search or a
// filter may be what empties the category (Library.narrowed()).
function notice(connection, configPath, shown, narrowed) {
  if (connection.state === "loading") return connection.manga.length ? null : { title: "Loading the library", detail: "" }
  var p = problem(connection, configPath)
  if (p) return p
  if (!connection.manga.length) return { title: "Your library is empty", detail: "Manga you follow show up here." }
  if (shown && !shown.manga.length && narrowed) return { title: "No manga match", detail: "Esc clears the search. F changes the filters." }
  if (shown && !shown.manga.length) return { title: shown.name + " is empty", detail: "Press c on a manga's detail to put it in a category." }
  return null
}

// { title, detail } for a failed connection, null for "loading" and "ok".
// Any { state, message } works, so other views reuse it.
function problem(connection, configPath) {
  switch (connection.state) {
    case "no-config":
      return { title: "No server config", detail: configPath + " is missing or invalid. Run Setup from the : palette to create it." }
    case "down":
      return { title: "The server is not running", detail: "Start it with: systemctl --user start miharchy-server. Press r to retry." }
    case "unauthorized":
      return { title: "The server rejected the credentials", detail: "Check username and password in " + configPath + ". Press r to retry." }
    case "error":
      // Suwayomi's answer to a source that runs part of its site in KCEF
      // while the server setting kcefEnabled is off.
      if (/^CEF is disabled/.test(connection.message)) return { title: "This source needs the server's WebView (KCEF), which is off", detail: "Turn it on in Settings." }
      return { title: "The server sent an error", detail: connection.message + " Press r to retry." }
  }
  return null
}

// A retry that ends in the failure it retried, so r never looks like it
// did nothing. A view keeps retried: failure() of its state as r goes out,
// or "", and failedAt: failedAt() of the reply, else 0.
function failure(s) {
  return s.state === "loading" || s.state === "ok" ? "" : s.state + " " + s.message
}

function failedAt(retried, reply, now) {
  return retried !== "" && retried === failure(reply) ? now : 0
}

function pad(n) {
  return n < 10 ? "0" + n : String(n)
}

// problem p, saying when s failed again.
function again(p, s) {
  if (!p || !s.failedAt) return p
  var t = new Date(s.failedAt)
  return { title: p.title, detail: p.detail + " Failed again at " + pad(t.getHours()) + ":" + pad(t.getMinutes()) + ":" + pad(t.getSeconds()) + "." }
}

// "<mangaId> <chapterId>", as the launcher's open-chapter passes it in
// MIHARCHY_OPEN_CHAPTER -> { mangaId, chapterId }, or null.
function chapterTarget(text) {
  var m = /^\s*(\d+)\s+(\d+)\s*$/.exec(text || "")
  return m ? { mangaId: Number(m[1]), chapterId: Number(m[2]) } : null
}

function viewIndex(id) {
  for (var i = 0; i < VIEWS.length; i++) if (VIEWS[i].id === id) return i
  return -1
}

// How a ListModel that shows `shown` becomes `items`, rows matched by
// key(item), the id by default. A view applies the ops in place
// (RowModel.qml), so the cells of the rows that stay keep their decoded
// covers: a new array as a view's model rebuilds every cell (#219).
// { reset: true } when most rows change, else { reset: false, ops }, ops in
// the order to apply them:
//   ["remove", index, count]   ["insert", index, [item, ...]]
//   ["move", from, to]         ["set", index, item]
// Past one insert or move per two new rows a reset is cheaper: each op is
// a model signal and a layout, and the cells on screen then show other
// manga anyway, as after a sort flips. A remove or a set never counts: it
// brings no other manga in, so a search that narrows stays in place.
function listChanges(shown, items, key) {
  key = key || function(x) { return x.id }
  var at = new Map()
  items.forEach(function(x, i) { at.set(key(x), i) })
  var keys = shown.map(key)
  // A key twice (a source can send a manga on two pages) has no one place.
  if (!shown.length || at.size !== items.length || new Set(keys).size !== keys.length) return { reset: true }
  var ops = []
  // From the end, so each index still holds.
  for (var i = keys.length - 1; i >= 0; i--) {
    if (at.has(keys[i])) continue
    var end = i
    while (i > 0 && !at.has(keys[i - 1])) i--
    ops.push(["remove", i, end - i + 1])
  }
  keys = keys.filter(function(k) { return at.has(k) })
  var stay = rising(keys.map(function(k) { return at.get(k) }))
  // From the end too: each row goes just before the row after it, already
  // in place. Rows in `stay` keep their order, so they never move.
  for (var j = items.length - 1; j >= 0; j--) {
    var k = key(items[j])
    var to = j + 1 < items.length ? keys.indexOf(key(items[j + 1])) : keys.length
    var from = keys.indexOf(k)
    var last = ops[ops.length - 1]
    if (from === -1) {
      if (last && last[0] === "insert" && last[1] === to) last[2].unshift(items[j])
      else ops.push(["insert", to, [items[j]]])
      keys.splice(to, 0, k)
    } else if (!stay.has(j)) {
      keys.splice(from, 1)
      if (from < to) to--
      keys.splice(to, 0, k)
      if (from !== to) ops.push(["move", from, to])
    }
  }
  var changed = ops.filter(function(op) { return op[0] !== "remove" }).length
  var old = new Map()
  shown.forEach(function(x) { old.set(key(x), x) })
  items.forEach(function(x, n) {
    if (old.has(key(x)) && JSON.stringify(old.get(key(x))) !== JSON.stringify(x)) ops.push(["set", n, x])
  })
  return changed * 2 > items.length ? { reset: true } : { reset: false, ops: ops }
}

// The values of seq in its longest rising run (an LIS), as a Set.
// ponytail: O(n²), fine for a library of hundreds; patience sorting if it
// ever holds thousands.
function rising(seq) {
  var len = []
  var prev = []
  var best = -1
  for (var i = 0; i < seq.length; i++) {
    len[i] = 1
    prev[i] = -1
    for (var j = 0; j < i; j++) if (seq[j] < seq[i] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j }
    if (best === -1 || len[i] > len[best]) best = i
  }
  var out = new Set()
  for (i = best; i !== -1; i = prev[i]) out.add(seq[i])
  return out
}

// Where a cursor on row `index` of `before` goes in `after`, rows matched
// by key(item), the id by default: onto the same row, else onto the
// nearest row after it that stayed, else the nearest before it, else 0.
function follow(before, after, index, key) {
  key = key || function(x) { return x.id }
  var keys = after.map(key)
  for (var i = index; i < before.length; i++) if (keys.indexOf(key(before[i])) !== -1) return keys.indexOf(key(before[i]))
  for (i = Math.min(index, before.length) - 1; i >= 0; i--) if (keys.indexOf(key(before[i])) !== -1) return keys.indexOf(key(before[i]))
  return 0
}

if (typeof module !== "undefined") {
  module.exports = {
    VIEWS: VIEWS,
    SOURCE_NAMES_META: SOURCE_NAMES_META,
    LIBRARY_QUERY: LIBRARY_QUERY,
    parseNames: parseNames,
    sourceLabel: sourceLabel,
    parseConfig: parseConfig,
    inLibraryPayload: inLibraryPayload,
    placeholder: placeholder,
    reply: reply,
    errorText: errorText,
    coverUrl: coverUrl,
    serverImageUrl: serverImageUrl,
    initial: initial,
    reduce: reduce,
    switcher: switcher,
    switcherIndex: switcherIndex,
    notice: notice,
    problem: problem,
    failure: failure,
    failedAt: failedAt,
    again: again,
    chapterTarget: chapterTarget,
    viewIndex: viewIndex,
    listChanges: listChanges,
    follow: follow
  }
}
