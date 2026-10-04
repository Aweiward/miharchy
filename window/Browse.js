.pragma library
.import "Model.js" as Model

// Browse past the extensions: the source list, one source's manga
// (popular, latest or search, page by page) and a manga's detail. Pure, so
// tests/browse.test.js pins it; BrowseView.qml sends the payloads built here
// and feeds replies back through the reducers.

var SOURCES_QUERY = "{ sources { nodes { id displayName lang iconUrl contentWarning supportsLatest } } }"

var LISTING_MUTATION = "mutation($source: LongString!, $type: FetchSourceMangaType!, $page: Int!, $query: String) {"
  + " fetchSourceManga(input: { source: $source, type: $type, page: $page, query: $query }) {"
  + " hasNextPage mangas { id title thumbnailUrl inLibrary } } }"

var MANGA_FIELDS = "id title author artist description genre status thumbnailUrl inLibrary initialized source { displayName }"
var CHAPTER_FIELDS = "id name chapterNumber uploadDate isRead scanlator sourceOrder"
var DETAIL_QUERY = "query($id: Int!) { manga(id: $id) { " + MANGA_FIELDS + " chapters { nodes { " + CHAPTER_FIELDS + " } } } }"
var FETCH_MUTATION = "mutation($id: Int!) { fetchMangaAndChapters(input: { id: $id, fetchManga: true, fetchChapters: true }) {"
  + " manga { " + MANGA_FIELDS + " } chapters { " + CHAPTER_FIELDS + " } } }"
var LIBRARY_MUTATION = "mutation($id: Int!, $inLibrary: Boolean!) { updateManga(input: { id: $id, patch: { inLibrary: $inLibrary } }) { manga { id inLibrary } } }"

var TYPES = { popular: "POPULAR", latest: "LATEST", search: "SEARCH" }
var LOCAL_SOURCE = "0"

function copy(o, changes) {
  var c = {}
  for (var k in o) c[k] = o[k]
  for (var j in changes) c[j] = changes[j]
  return c
}

// Suwayomi's Cloudflare interceptor throws this when FlareSolverr is off.
function needsFlareSolverr(message) {
  return /Cloudflare bypass currently disabled/i.test(message || "")
}

function failed(reply) {
  return { state: reply.state, message: reply.message, flare: needsFlareSolverr(reply.message) }
}

// A sources reply -> { state, message, sources: [{ id, name, lang, icon,
// warning, supportsLatest }] }. The local source is v1.1 work; NSFW sources
// hide unless showNsfw, and only English and multi-language sources show
// unless allLanguages, the same rules as their extensions.
function sources(reply, config, showNsfw, allLanguages) {
  if (reply.state !== "ok") return { state: reply.state, message: reply.message, sources: [] }
  var nodes = (reply.data.sources && reply.data.sources.nodes) || []
  var list = nodes
    .filter(function(n) {
      return String(n.id) !== LOCAL_SOURCE && (showNsfw || n.contentWarning !== "NSFW") && (allLanguages || n.lang === "en" || n.lang === "all")
    })
    .map(function(n) {
      return {
        id: String(n.id),
        name: String(n.displayName || n.id),
        lang: String(n.lang || ""),
        icon: Model.coverUrl(config, n.iconUrl),
        warning: String(n.contentWarning || "SAFE"),
        supportsLatest: n.supportsLatest === true
      }
    })
  list.sort(function(a, b) { return a.name.localeCompare(b.name) })
  return { state: "ok", message: "", sources: list }
}

// listing.state: "idle" | "loading" | "ok" | a failed connection state.
// page: the last page loaded. flare: the failure is Cloudflare without
// FlareSolverr.
function listing(source, mode, query) {
  return {
    source: source,
    mode: mode === "latest" && !source.supportsLatest ? "popular" : mode,
    query: query || "",
    page: 0,
    items: [],
    hasNext: true,
    state: "idle",
    message: "",
    flare: false
  }
}

// The payload for the next page, or null while a page is in flight, after
// the last page, or after a failure (r retries).
function listingPayload(l) {
  if (l.state === "loading" || !l.hasNext || (l.state !== "idle" && l.state !== "ok")) return null
  return {
    query: LISTING_MUTATION,
    variables: { source: l.source.id, type: TYPES[l.mode], page: l.page + 1, query: l.mode === "search" ? l.query : null }
  }
}

// event.type: "request" | "reply" { reply, config } | "retry"
function reduceListing(l, event) {
  switch (event.type) {
    case "request":
      return copy(l, { state: "loading", message: "", flare: false })
    case "retry":
      if (l.state === "idle" || l.state === "loading" || l.state === "ok") return l
      return copy(l, { state: "idle", message: "", flare: false })
    case "reply":
      if (event.reply.state !== "ok") return copy(l, failed(event.reply))
      var r = event.reply.data.fetchSourceManga || {}
      var seen = {}
      l.items.forEach(function(m) { seen[m.id] = true })
      var fresh = (r.mangas || []).filter(function(m) { return !seen[m.id] }).map(function(m) {
        return { id: m.id, title: String(m.title || ""), cover: Model.coverUrl(event.config, m.thumbnailUrl), inLibrary: m.inLibrary === true }
      })
      return copy(l, { state: "ok", page: l.page + 1, items: l.items.concat(fresh), hasNext: r.hasNextPage === true })
  }
  return l
}

// detail.step: the request due next: "read" the cached manga, "fetch" it
// from the source, or null. fetched: the source fetch already ran, so a
// manga the source leaves empty is not fetched in a loop. fromSource: opened
// while browsing a source, where cached details can be stale, so it always
// refreshes once after showing the cache.
function detail(mangaId, fromSource) {
  return { mangaId: mangaId, fromSource: fromSource === true, step: "read", state: "loading", message: "", flare: false, manga: null, chapters: [], fetched: false, busy: false, libraryError: "" }
}

function detailPayload(d) {
  if (d.step === "read") return { query: DETAIL_QUERY, variables: { id: d.mangaId } }
  if (d.step === "fetch") return { query: FETCH_MUTATION, variables: { id: d.mangaId } }
  return null
}

function titleCase(s) {
  s = String(s || "").toLowerCase().replace(/_/g, " ")
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function pad(n) {
  return n < 10 ? "0" + n : String(n)
}

function day(ms) {
  var t = Number(ms)
  if (!t) return ""
  var d = new Date(t)
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
}

function toManga(config, n) {
  return {
    id: n.id,
    title: String(n.title || ""),
    author: String(n.author || ""),
    artist: String(n.artist || ""),
    description: String(n.description || ""),
    genres: (n.genre || []).join(", "),
    status: titleCase(n.status),
    cover: Model.coverUrl(config, n.thumbnailUrl),
    source: n.source ? String(n.source.displayName || "") : "",
    inLibrary: n.inLibrary === true,
    initialized: n.initialized === true
  }
}

function toChapters(nodes) {
  return (nodes || []).slice().sort(function(a, b) { return b.sourceOrder - a.sourceOrder }).map(function(c) {
    return { id: c.id, name: String(c.name || ""), number: c.chapterNumber, date: day(c.uploadDate), read: c.isRead === true, scanlator: String(c.scanlator || "") }
  })
}

// event.type: "reply" { reply, config } for the step in flight | "refresh"
// | "library-request" | "library-reply" { reply }
function reduceDetail(d, event) {
  switch (event.type) {
    case "refresh":
      return copy(d, { step: "fetch", state: "loading", message: "", flare: false })
    case "reply":
      if (event.reply.state !== "ok") return copy(copy(d, failed(event.reply)), { step: null })
      if (d.step === "read") {
        var n = event.reply.data.manga
        var chapters = toChapters(n.chapters && n.chapters.nodes)
        var stale = d.fromSource || !n.initialized || chapters.length === 0
        return copy(d, {
          manga: toManga(event.config, n),
          chapters: chapters,
          step: stale && !d.fetched ? "fetch" : null,
          state: stale && !d.fetched ? "loading" : "ok"
        })
      }
      var f = event.reply.data.fetchMangaAndChapters
      return copy(d, { manga: toManga(event.config, f.manga), chapters: toChapters(f.chapters), step: null, state: "ok", fetched: true })
    case "library-request":
      return copy(d, { busy: true, libraryError: "" })
    case "library-reply":
      if (event.reply.state !== "ok") return copy(d, { busy: false, libraryError: event.reply.message || event.reply.state })
      var m = event.reply.data.updateManga.manga
      return copy(d, { busy: false, manga: copy(d.manga, { inLibrary: m.inLibrary === true }) })
  }
  return d
}

// The add/remove toggle, or null before the manga loads or while a toggle
// is in flight.
function libraryPayload(d) {
  if (!d.manga || d.busy) return null
  return { query: LIBRARY_MUTATION, variables: { id: d.mangaId, inLibrary: !d.manga.inLibrary } }
}

function markInLibrary(l, mangaId, inLibrary) {
  return copy(l, { items: l.items.map(function(m) { return m.id === mangaId ? copy(m, { inLibrary: inLibrary }) : m }) })
}

// { title, detail } for a listing or detail that failed or came back empty,
// else null.
function notice(s, configPath) {
  if (s.flare) return { title: "This source needs FlareSolverr", detail: "It sits behind Cloudflare. Turn FlareSolverr on in Setup or Settings, then press r." }
  var p = Model.problem(s, configPath)
  if (p) return p
  if (s.state === "ok" && s.items && s.items.length === 0) return { title: "No manga found", detail: s.mode === "search" ? "Try another search." : "" }
  return null
}

if (typeof module !== "undefined") {
  module.exports = {
    SOURCES_QUERY: SOURCES_QUERY,
    sources: sources,
    listing: listing,
    listingPayload: listingPayload,
    reduceListing: reduceListing,
    detail: detail,
    detailPayload: detailPayload,
    reduceDetail: reduceDetail,
    libraryPayload: libraryPayload,
    markInLibrary: markInLibrary,
    notice: notice
  }
}
