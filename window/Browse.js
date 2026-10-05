.pragma library
.import "Model.js" as Model

// Browse past the extensions: the source list, one source's manga
// (popular, latest or search, page by page) and a manga's detail. Pure, so
// tests/browse.test.js pins it; BrowseView.qml sends the payloads built here
// and feeds replies back through the reducers.

var SOURCES_QUERY = "{ sources { nodes { id displayName lang iconUrl contentWarning supportsLatest isConfigurable } } }"

var LISTING_MUTATION = "mutation($source: LongString!, $type: FetchSourceMangaType!, $page: Int!, $query: String, $filters: [FilterChangeInput!]) {"
  + " fetchSourceManga(input: { source: $source, type: $type, page: $page, query: $query, filters: $filters }) {"
  + " hasNextPage mangas { id title thumbnailUrl inLibrary } } }"

var MANGA_FIELDS = "id title realUrl author artist description genre status thumbnailUrl inLibrary initialized sourceId source { displayName } categories { nodes { id } } meta { key value }"
var CHAPTER_FIELDS = "id name realUrl chapterNumber uploadDate isRead isBookmarked lastPageRead isDownloaded scanlator sourceOrder"
var NOTES_META = "miharchy.notes"
var DETAIL_QUERY = "query($id: Int!) { manga(id: $id) { " + MANGA_FIELDS + " chapters { nodes { " + CHAPTER_FIELDS + " } } }"
  + " metas(condition: { key: \"" + Model.SOURCE_NAMES_META + "\" }) { nodes { value } } }"
var EXTENSION_QUERY = "query($name: String!) { extensions(filter: { name: { equalTo: $name } }) { nodes { name isInstalled } } }"
var FETCH_MUTATION = "mutation($id: Int!) { fetchMangaAndChapters(input: { id: $id, fetchManga: true, fetchChapters: true }) {"
  + " manga { " + MANGA_FIELDS + " } chapters { " + CHAPTER_FIELDS + " } } }"
var CATEGORY_MUTATION = "mutation($id: Int!, $add: [Int!]!, $remove: [Int!]!) {"
  + " updateMangaCategories(input: { id: $id, patch: { addToCategories: $add, removeFromCategories: $remove } }) { manga { id categories { nodes { id } } } } }"

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
// warning, supportsLatest, configurable }] }. The local source is v1.1 work; NSFW sources
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
        supportsLatest: n.supportsLatest === true,
        configurable: n.isConfigurable === true
      }
    })
  list.sort(function(a, b) { return a.name.localeCompare(b.name) })
  return { state: "ok", message: "", sources: list }
}

// Mihon's SourcePreferences, in global meta through Prefs: pinned sources
// as a JSON list of ids, the last source opened, the languages shown and
// the sources hidden, JSON lists too. English and multi-language sources
// show until the user picks, as before; Mihon starts with "all", "en" and
// the system language.
var PREFS = [
  { key: "pinnedSources", default: "[]" },
  { key: "lastUsedSource", default: "" },
  { key: "enabledLanguages", default: "[\"all\",\"en\"]" },
  { key: "disabledSources", default: "[]" },
  { key: "globalSearchHasResults", default: "off", options: ["off", "on"] }
]

function idList(json) {
  try {
    var list = JSON.parse(json || "[]")
    return Array.isArray(list) ? list.map(String) : []
  } catch (e) {
    return []
  }
}

function pinned(prefs) {
  return idList(prefs.pinnedSources)
}

// The { key, value } that pins the source, or unpins a pinned one.
function togglePin(prefs, id) {
  return { key: "pinnedSources", value: toggled(pinned(prefs), id) }
}

function languageName(lang) {
  return lang === "all" ? "Multi" : lang
}

// The sources Sources and global search use: an enabled language, and not
// hidden one by one (Mihon's GetEnabledSources).
function enabled(sources, prefs) {
  var langs = idList(prefs.enabledLanguages)
  var off = idList(prefs.disabledSources)
  return sources.filter(function(s) { return langs.indexOf(s.lang) !== -1 && off.indexOf(s.id) === -1 })
}

function toggled(list, item) {
  return JSON.stringify(list.indexOf(item) === -1 ? list.concat([item]) : list.filter(function(i) { return i !== item }))
}

function langOrder(lang) {
  return (lang === "all" ? "0" : "1") + lang
}

// The languages panel (Mihon's SourcesFilterScreen and
// GetLanguagesWithSources), in WidgetPanel's shape: every language of the
// installed sources, the enabled ones first, Multi first among each, and
// under each enabled one its sources, the hidden ones last.
function languageRows(sources, prefs) {
  var langs = idList(prefs.enabledLanguages)
  var off = idList(prefs.disabledSources)
  var all = sources.map(function(s) { return s.lang }).filter(function(l, i, a) { return a.indexOf(l) === i })
  var key = function(l) { return (langs.indexOf(l) !== -1 ? "0" : "1") + langOrder(l) }
  all.sort(function(a, b) { return key(a).localeCompare(key(b)) })
  var hidden = function(s) { return off.indexOf(s.id) !== -1 }
  var row = function(kind, id, label, on, depth) {
    return { kind: kind, id: id, label: label, mark: on ? "[x]" : "[ ]", detail: "", summary: "", depth: depth, enabled: true }
  }
  var out = []
  all.forEach(function(lang) {
    var on = langs.indexOf(lang) !== -1
    out.push(row("language", lang, languageName(lang), on, 0))
    if (!on) return
    // Split, not sorted: a sort need not keep the name order.
    var mine = sources.filter(function(s) { return s.lang === lang })
    mine.filter(function(s) { return !hidden(s) }).concat(mine.filter(hidden))
      .forEach(function(s) { out.push(row("source", s.id, s.name, !hidden(s), 1)) })
  })
  return out
}

// What Enter on a languages panel row changes, as { key, value }.
function chooseLanguage(prefs, row) {
  if (row.kind === "language") return { key: "enabledLanguages", value: toggled(idList(prefs.enabledLanguages), row.id) }
  return { key: "disabledSources", value: toggled(idList(prefs.disabledSources), row.id) }
}

// The Sources list as Mihon's SourcesScreen groups it: the last used
// source, the pinned ones, then each language, Multi first. The last used
// source also shows in its own group. Each row is a source with header
// (the group's name on its first row, else ""), pinned and lastUsed.
function sourceRows(sources, prefs) {
  var pins = pinned(prefs)
  var groups = {}
  var order = []
  var add = function(key, label, s, lastUsed) {
    if (!groups[key]) {
      groups[key] = { label: label, rows: [] }
      order.push(key)
    }
    groups[key].rows.push(copy(s, { pinned: pins.indexOf(s.id) !== -1, lastUsed: lastUsed }))
  }
  sources.forEach(function(s) {
    if (s.id === prefs.lastUsedSource) add("1", "Last used", s, true)
    if (pins.indexOf(s.id) !== -1) add("2", "Pinned", s, false)
    else add(s.lang === "all" ? "3" : "4" + s.lang, languageName(s.lang), s, false)
  })
  var out = []
  order.sort().forEach(function(key) {
    groups[key].rows.forEach(function(r, i) { out.push(copy(r, { header: i ? "" : groups[key].label })) })
  })
  return out
}

// Where a source sits in rows, past its last used copy: the cursor follows
// a source that moves on a pin.
function rowIndex(rows, id) {
  for (var i = 0; i < rows.length; i++) if (rows[i].id === id && !rows[i].lastUsed) return i
  return 0
}

// listing.state: "idle" | "loading" | "ok" | a failed connection state.
// page: the last page loaded. flare: the failure is Cloudflare without
// FlareSolverr. filters: Widgets.filterChanges of the applied filters;
// Suwayomi hands them to the source only in a search, so only a search
// keeps them.
function listing(source, mode, query, filters) {
  mode = mode === "latest" && !source.supportsLatest ? "popular" : mode
  return {
    source: source,
    mode: mode,
    query: query || "",
    filters: mode === "search" ? filters || [] : [],
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
    variables: { source: l.source.id, type: TYPES[l.mode], page: l.page + 1, query: l.mode === "search" ? l.query : null, filters: l.mode === "search" ? l.filters : null }
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
// from the source, look up the "extension" named like a missing source, or
// null. extension: that extension as { installed }, or null. fetched: the
// source fetch already ran, so a manga the source leaves empty is not
// fetched in a loop. fromSource: opened
// while browsing a source, where cached details can be stale, so it always
// refreshes once after showing the cache.
function detail(mangaId, fromSource) {
  return { mangaId: mangaId, fromSource: fromSource === true, step: "read", state: "loading", message: "", flare: false, manga: null, chapters: [], fetched: false, busy: false, libraryError: "", sourceNames: {}, extension: null }
}

function detailPayload(d) {
  if (d.step === "read") return { query: DETAIL_QUERY, variables: { id: d.mangaId } }
  if (d.step === "fetch") return { query: FETCH_MUTATION, variables: { id: d.mangaId } }
  if (d.step === "extension") return { query: EXTENSION_QUERY, variables: { name: d.manga.sourceName } }
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

// Mihon has no layout field, so the layout comes from what sources say.
// Language tags (MangaDex's "Korean") and "Web Comic" also cover paged
// books, and Webtoons.com tags genres only, so its name counts.
var LONG_STRIP_GENRES = ["long strip", "webtoon", "webtoons", "manhwa", "manhua"]

function longStrip(genres, sourceName) {
  return /webtoon/i.test(sourceName) || genres.some(function(g) { return LONG_STRIP_GENRES.indexOf(String(g).toLowerCase()) !== -1 })
}

// What to do about a manga whose source is not installed. extension: the
// extension with the source's name, as { installed }, or null for none.
// An installed one means the extension's source has a new id now.
function sourceHelp(manga, extension) {
  if (!manga || !manga.missing) return ""
  var name = manga.sourceName
  if (!name) return "Migrate this manga to another source: M."
  if (extension && extension.installed) return "The installed " + name + " extension serves a different source now. Migrate this manga to it: M."
  if (extension) return "Install the " + name + " extension in Browse. If the manga still shows not installed, the source changed: migrate it with M."
  return "No extension in your repos is named " + name + ". Migrate this manga to another source: M."
}

function toManga(config, n, names) {
  var source = Model.sourceLabel(n, names)
  var meta = {}
  var nodes = n.meta || []
  nodes.forEach(function(m) { meta[m.key] = String(m.value) })
  return {
    id: n.id,
    title: String(n.title || ""),
    // The page on the source's site; "" when the server cannot build it.
    url: String(n.realUrl || ""),
    author: String(n.author || ""),
    artist: String(n.artist || ""),
    description: String(n.description || ""),
    genres: (n.genre || []).join(", "),
    status: titleCase(n.status),
    // The server fetches a cover through its source, so without one it only fails.
    cover: n.source ? Model.coverUrl(config, n.thumbnailUrl) : "",
    source: source,
    sourceId: String(n.sourceId),
    missing: !n.source,
    sourceName: n.source ? source : String(names[n.sourceId] || ""),
    inLibrary: n.inLibrary === true,
    initialized: n.initialized === true,
    categories: ((n.categories && n.categories.nodes) || []).map(function(c) { return c.id }),
    longStrip: longStrip(n.genre || [], source),
    // "" until m picks one in the reader.
    readingMode: meta["miharchy.readingMode"] || "",
    // Mihon's notes, Markdown; the sync helper carries them to and from backups.
    notes: meta[NOTES_META] || ""
  }
}

function toChapters(nodes) {
  return (nodes || []).slice().sort(function(a, b) { return b.sourceOrder - a.sourceOrder }).map(function(c) {
    return { id: c.id, name: String(c.name || ""), url: String(c.realUrl || ""), number: c.chapterNumber, date: day(c.uploadDate), uploadDate: Number(c.uploadDate) || 0, sourceOrder: c.sourceOrder, read: c.isRead === true, bookmarked: c.isBookmarked === true, lastPage: c.lastPageRead || 0, downloaded: c.isDownloaded === true, scanlator: String(c.scanlator || "") }
  })
}

// event.type: "reply" { reply, config } for the step in flight | "refresh"
// | "reread" the cache, as after reading | "library-request"
// | "library-reply" { reply } | "categories-reply" { reply }
// | "downloads-reply" { reply } from any Downloads.js mutation
// | "mark-reply" { reply } from Chapters.markPayload
function reduceDetail(d, event) {
  switch (event.type) {
    case "refresh":
      return copy(d, { step: "fetch", state: "loading", message: "", flare: false })
    case "reread":
      return copy(d, { step: "read", fetched: true })
    case "reply":
      if (d.step === "extension") {
        var ext = event.reply.state === "ok" ? event.reply.data.extensions.nodes[0] : null
        return copy(d, { step: null, extension: ext ? { installed: ext.isInstalled === true } : null })
      }
      if (event.reply.state !== "ok") return copy(copy(d, failed(event.reply)), { step: null })
      if (d.step === "read") {
        var n = event.reply.data.manga
        var names = Model.parseNames(event.reply.data)
        var manga = toManga(event.config, n, names)
        var chapters = toChapters(n.chapters && n.chapters.nodes)
        // A fetch goes through the source, so a missing one only fails.
        if (manga.missing) return copy(d, { manga: manga, chapters: chapters, sourceNames: names, step: manga.sourceName ? "extension" : null, state: "ok" })
        var stale = d.fromSource || !n.initialized || chapters.length === 0
        return copy(d, {
          manga: manga,
          chapters: chapters,
          sourceNames: names,
          step: stale && !d.fetched ? "fetch" : null,
          state: stale && !d.fetched ? "loading" : "ok"
        })
      }
      var f = event.reply.data.fetchMangaAndChapters
      return copy(d, { manga: toManga(event.config, f.manga, d.sourceNames), chapters: toChapters(f.chapters), step: null, state: "ok", fetched: true })
    case "library-request":
      return copy(d, { busy: true, libraryError: "" })
    case "library-reply":
      if (event.reply.state !== "ok") return copy(d, { busy: false, libraryError: event.reply.message || event.reply.state })
      var m = event.reply.data.updateManga.manga
      return copy(d, { busy: false, manga: copy(d.manga, { inLibrary: m.inLibrary === true }) })
    case "categories-reply":
      if (event.reply.state !== "ok") return copy(d, { busy: false, libraryError: event.reply.message || event.reply.state })
      var nodes = event.reply.data.updateMangaCategories.manga.categories.nodes
      return copy(d, { busy: false, manga: copy(d.manga, { categories: nodes.map(function(c) { return c.id }) }) })
    case "mark-reply":
    case "downloads-reply":
      if (event.reply.state !== "ok") return copy(d, { libraryError: event.reply.message || event.reply.state })
      var deleted = event.reply.data.deleteDownloadedChapters
      var onDisk = {}
      if (deleted) deleted.chapters.forEach(function(c) { onDisk[c.id] = c.isDownloaded === true })
      return copy(d, { libraryError: "", chapters: d.chapters.map(function(c) { return c.id in onDisk ? copy(c, { downloaded: onDisk[c.id] }) : c }) })
  }
  return d
}

// Puts the manga in the category or takes it out, or null unless it is in
// the library and no toggle is in flight. It shares "library-request".
function categoryPayload(d, categoryId) {
  if (!d.manga || !d.manga.inLibrary || d.busy) return null
  var member = d.manga.categories.indexOf(categoryId) !== -1
  return { query: CATEGORY_MUTATION, variables: { id: d.mangaId, add: member ? [] : [categoryId], remove: member ? [categoryId] : [] } }
}

// The add/remove toggle, or null before the manga loads or while a toggle
// is in flight.
function libraryPayload(d) {
  if (!d.manga || d.busy) return null
  return Model.inLibraryPayload(d.mangaId, !d.manga.inLibrary)
}

function markInLibrary(l, mangaId, inLibrary) {
  return copy(l, { items: l.items.map(function(m) { return m.id === mangaId ? copy(m, { inLibrary: inLibrary }) : m }) })
}

// Whether the grid's new items continue the ones it showed: a page more or
// a library mark, not a new listing. The grid then keeps its scroll place;
// a new model would put it back at the top under a wheel that just
// reached the end.
function continues(before, after) {
  return before.length > 0 && after.length >= before.length && after[0].id === before[0].id
}

// { title, detail } for a listing or detail that failed or came back empty,
// else null.
function notice(s, configPath) {
  if (s.flare) return { title: "This source needs FlareSolverr", detail: "It sits behind Cloudflare. Turn FlareSolverr on in Setup or Settings, then press r." }
  var p = Model.problem(s, configPath)
  if (p) return p
  if (s.state === "ok" && s.items && s.items.length === 0) return { title: "No manga found", detail: s.mode !== "search" ? "" : s.filters.length ? "Try other filters: F." : "Try another search." }
  return null
}

if (typeof module !== "undefined") {
  module.exports = {
    continues: continues,
    SOURCES_QUERY: SOURCES_QUERY,
    sources: sources,
    PREFS: PREFS,
    pinned: pinned,
    togglePin: togglePin,
    sourceRows: sourceRows,
    rowIndex: rowIndex,
    enabled: enabled,
    languageRows: languageRows,
    chooseLanguage: chooseLanguage,
    listing: listing,
    listingPayload: listingPayload,
    reduceListing: reduceListing,
    day: day,
    detail: detail,
    detailPayload: detailPayload,
    reduceDetail: reduceDetail,
    sourceHelp: sourceHelp,
    libraryPayload: libraryPayload,
    categoryPayload: categoryPayload,
    markInLibrary: markInLibrary,
    notice: notice
  }
}
