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
      return { title: "The server sent an error", detail: connection.message + " Press r to retry." }
  }
  return null
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
    chapterTarget: chapterTarget,
    viewIndex: viewIndex
  }
}
