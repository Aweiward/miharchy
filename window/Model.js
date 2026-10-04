.pragma library

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

var LIBRARY_QUERY = "{ mangas(condition: {inLibrary: true}, orderBy: TITLE) { nodes { id title thumbnailUrl } } }"

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

// The library request for config; QML base64-encodes `credentials`.
function libraryRequest(config) {
  return {
    url: config.url + "/api/graphql",
    credentials: config.username + ":" + config.password,
    body: JSON.stringify({ query: LIBRARY_QUERY })
  }
}

// QML Image can't send an Authorization header, so covers carry the
// credentials in the URL's userinfo.
function coverUrl(config, thumbnailUrl) {
  if (!thumbnailUrl) return ""
  var abs = /^https?:\/\//.test(thumbnailUrl) ? thumbnailUrl : config.url + (thumbnailUrl.charAt(0) === "/" ? "" : "/") + thumbnailUrl
  if (abs.indexOf(config.url) !== 0) return abs
  var userinfo = encodeURIComponent(config.username) + ":" + encodeURIComponent(config.password) + "@"
  return abs.replace(/^(https?:\/\/)/, "$1" + userinfo)
}

// connection.state: "loading" | "ok" | "no-config" | "down" | "unauthorized" | "error"
// manga is set only in "ok"; message only in "error".
function initial() {
  return { state: "loading", manga: [], message: "" }
}

function conn(state, extra) {
  var c = { state: state, manga: [], message: "" }
  for (var k in extra) c[k] = extra[k]
  return c
}

// event.type:
//   "config-missing"  server.json is absent or unreadable
//   "request"         a library request went out
//   "response"        { status, body, config } with status 0 for no answer
function reduce(connection, event) {
  switch (event.type) {
    case "config-missing":
      return conn("no-config")
    case "request":
      // Keep the shown library while a reload is in flight.
      return conn("loading", { manga: connection.state === "ok" ? connection.manga : [] })
    case "response":
      return fromResponse(event.status, event.body, event.config)
  }
  return connection
}

function fromResponse(status, body, config) {
  if (status === 0) return conn("down")
  if (status === 401) return conn("unauthorized")
  if (status !== 200) return conn("error", { message: "The server answered HTTP " + status + "." })
  var json
  try {
    json = JSON.parse(body)
  } catch (e) {
    return conn("error", { message: "The server sent a reply that is not JSON." })
  }
  if (json.errors && json.errors.length) return conn("error", { message: String(json.errors[0].message || "GraphQL error") })
  var nodes = json.data && json.data.mangas && json.data.mangas.nodes
  if (!Array.isArray(nodes)) return conn("error", { message: "The server's reply has no library." })
  return conn("ok", {
    manga: nodes.map(function(n) {
      return { id: n.id, title: String(n.title || ""), cover: coverUrl(config, n.thumbnailUrl) }
    })
  })
}

// What the library view shows for a connection: null for the cover grid,
// otherwise { title, detail }.
function notice(connection, configPath) {
  switch (connection.state) {
    case "loading":
      return connection.manga.length ? null : { title: "Loading the library", detail: "" }
    case "no-config":
      return { title: "No server config", detail: configPath + " is missing or invalid. Run server/miharchy-server to create it." }
    case "down":
      return { title: "The server is not running", detail: "Start it with: systemctl --user start miharchy-server. Press r to retry." }
    case "unauthorized":
      return { title: "The server rejected the credentials", detail: "Check username and password in " + configPath + ". Press r to retry." }
    case "error":
      return { title: "The server sent an error", detail: connection.message + " Press r to retry." }
  }
  if (!connection.manga.length) return { title: "Your library is empty", detail: "Manga you follow show up here." }
  return null
}

function viewIndex(id) {
  for (var i = 0; i < VIEWS.length; i++) if (VIEWS[i].id === id) return i
  return -1
}

if (typeof module !== "undefined") {
  module.exports = {
    VIEWS: VIEWS,
    LIBRARY_QUERY: LIBRARY_QUERY,
    parseConfig: parseConfig,
    libraryRequest: libraryRequest,
    coverUrl: coverUrl,
    initial: initial,
    reduce: reduce,
    notice: notice,
    viewIndex: viewIndex
  }
}
