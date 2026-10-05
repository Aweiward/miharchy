.pragma library
.import "Model.js" as Model
.import "Browse.js" as Browse
.import "GlobalSearch.js" as GlobalSearch

// Migrate: move a library manga to another source, as Mihon's
// MigrateMangaUseCase does. The old manga is read from the server's
// database only, never from its source, which may be gone. Pure, so
// tests/migrate.test.js pins it; MigrateView.qml sends the payloads.

var OLD_QUERY = "query($id: Int!) { manga(id: $id) { id title categories { nodes { id } } meta { key value }"
  + " chapters { nodes { id chapterNumber isRead isBookmarked isDownloaded } }"
  + " trackRecords { nodes { id trackerId tracker { name } } } } }"
var TARGET_MUTATION = "mutation($id: Int!) { fetchMangaAndChapters(input: { id: $id, fetchManga: true, fetchChapters: true }) {"
  + " manga { id title } chapters { id chapterNumber isRead isBookmarked } } }"
var LIBRARY_QUERY = "{ mangas(condition: { inLibrary: true }, orderBy: TITLE) { nodes { id title sourceId source { displayName } } }"
  + " metas(condition: { key: \"" + Model.SOURCE_NAMES_META + "\" }) { nodes { value } } }"
var MODE_KEY = "miharchy.readingMode"
// Mihon's BaseSmartSearchEngine.MIN_ELIGIBLE_THRESHOLD.
var THRESHOLD = 0.4

function copy(o, changes) {
  var c = {}
  for (var k in o) c[k] = o[k]
  for (var j in changes) c[j] = changes[j]
  return c
}

// Mihon's Chapter.isRecognizedNumber: sources give -1 for a chapter whose
// number they could not parse.
function recognized(c) {
  return c.chapterNumber >= 0
}

// Chapter nodes { id, chapterNumber, isRead, isBookmarked } of both manga ->
// the target chapter ids to mark { read, bookmark }. As in Mihon, every
// target chapter up to the highest number read on the old manga is read,
// and a bookmark moves to the chapters with its number. Mihon copies the
// first same-numbered chapter's bookmark; any bookmarked scanlator variant
// counts here, so the order chapters come in cannot lose one. Neither ever
// clears what the target already has.
function plan(oldChapters, targetChapters) {
  var maxRead = -1
  var marked = {}
  oldChapters.filter(recognized).forEach(function(c) {
    if (c.isRead && c.chapterNumber > maxRead) maxRead = c.chapterNumber
    if (c.isBookmarked) marked[c.chapterNumber] = true
  })
  var target = targetChapters.filter(recognized)
  var id = function(c) { return c.id }
  return {
    read: target.filter(function(c) { return !c.isRead && c.chapterNumber <= maxRead }).map(id),
    bookmark: target.filter(function(c) { return !c.isBookmarked && marked[c.chapterNumber] === true }).map(id)
  }
}

// old: an OLD_QUERY manga node. In the library first: Suwayomi adds a
// manga that joins it to the categories flagged default, and the clear
// that follows takes those off too, so the target ends in exactly the old
// manga's categories, as Mihon's SetMangaCategories does.
// withTracks: the old manga's tracks go along, as in Mihon's
// MigrateMangaUseCase. bindTrackRecord copies each record to the target in
// the server's database, replacing the target's own track on that tracker;
// it never calls the tracker, so it needs no login and pushes nothing.
function targetPayload(old, targetId, p, withTracks) {
  var mode = (old.meta || []).filter(function(m) { return m.key === MODE_KEY })[0]
  var tracks = withTracks ? trackRecords(old) : []
  var vars = { target: targetId, categories: old.categories.nodes.map(function(c) { return c.id }), read: p.read, bookmark: p.bookmark }
  var params = ["$target: Int!", "$categories: [Int!]!", "$read: [Int!]!", "$bookmark: [Int!]!"]
  var query = " library: updateManga(input: { id: $target, patch: { inLibrary: true } }) { manga { id } }"
    + " categories: updateMangaCategories(input: { id: $target, patch: { clearCategories: true, addToCategories: $categories } }) { manga { id } }"
    + " read: updateChapters(input: { ids: $read, patch: { isRead: true } }) { chapters { id } }"
    + " bookmark: updateChapters(input: { ids: $bookmark, patch: { isBookmarked: true } }) { chapters { id } }"
  if (mode) {
    vars.mode = { mangaId: targetId, key: MODE_KEY, value: mode.value }
    params.push("$mode: MangaMetaTypeInput!")
    query += " mode: setMangaMeta(input: { meta: $mode }) { meta { key } }"
  }
  tracks.forEach(function(t, i) {
    vars["track" + i] = t.id
    params.push("$track" + i + ": Int!")
    query += " track" + i + ": bindTrackRecord(input: { mangaId: $target, trackRecordId: $track" + i + " }) { trackRecord { id } }"
  })
  return { query: "mutation(" + params.join(", ") + ") {" + query + " }", variables: vars }
}

// An OLD_QUERY manga node -> its tracks: [{ id, tracker }].
function trackRecords(old) {
  return ((old.trackRecords && old.trackRecords.nodes) || []).map(function(n) { return { id: n.id, tracker: String(n.tracker.name) } })
}

function downloaded(old) {
  return old.chapters.nodes.filter(function(c) { return c.isDownloaded }).map(function(c) { return c.id })
}

// Sent only after the target write succeeds, so a failure never leaves the
// manga in neither place. replace: Migrate, not Copy. null when there is
// nothing to do.
function oldPayload(old, replace, deleteDownloads) {
  var ids = deleteDownloads ? downloaded(old) : []
  if (!replace && !ids.length) return null
  var query = "mutation($id: Int!" + (ids.length ? ", $downloads: [Int!]!" : "") + ") {"
  if (replace) query += " library: updateManga(input: { id: $id, patch: { inLibrary: false } }) { manga { id } }"
  if (ids.length) query += " downloads: deleteDownloadedChapters(input: { ids: $downloads }) { chapters { id } }"
  var vars = { id: old.id }
  if (ids.length) vars.downloads = ids
  return { query: query + " }", variables: vars }
}

function levenshtein(a, b) {
  var row = []
  for (var j = 0; j <= b.length; j++) row.push(j)
  for (var i = 1; i <= a.length; i++) {
    var diag = row[0]
    row[0] = i
    for (var k = 1; k <= b.length; k++) {
      var up = row[k]
      row[k] = Math.min(row[k] + 1, row[k - 1] + 1, diag + (a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1))
      diag = up
    }
  }
  return row[b.length]
}

// NormalizedLevenshtein.similarity, which Mihon's smart search uses.
function similarity(a, b) {
  var longest = Math.max(a.length, b.length)
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest
}

// The index of the result Mihon's regularSearch would take, or -1: the most
// similar title at THRESHOLD or above, and a lone result always.
function propose(title, items) {
  if (items.length === 1) return 0
  var best = -1
  var score = THRESHOLD
  items.forEach(function(m, i) {
    var s = similarity(title, m.title)
    if (s >= score && (best === -1 || s > score)) {
      best = i
      score = s
    }
  })
  return best
}

// "Asura Scans (EN)", "AsuraScans" and "asura scans" name the same source.
function key(name) {
  return String(name || "").replace(/\s*\([^)]*\)\s*$/, "").replace(/[^a-z0-9]/gi, "").toLowerCase()
}

// Browse.sources() -> where the manga can go: not its own source, and a
// source named like the old one first (a new version of a source gets a
// new id).
function targets(sources, oldSourceId, oldName) {
  var k = key(oldName)
  var others = sources.filter(function(s) { return s.id !== String(oldSourceId) })
  var same = function(s) { return k !== "" && key(s.name) === k }
  return others.filter(same).concat(others.filter(function(s) { return !same(s) }))
}

// LIBRARY_QUERY data -> each source with library manga, by name:
// { id, name, sourceName, missing, manga: [{ id, title }] }.
function librarySources(data) {
  var names = Model.parseNames(data)
  var byId = {}
  var list = []
  ;((data.mangas && data.mangas.nodes) || []).forEach(function(n) {
    var id = String(n.sourceId)
    if (!byId[id]) {
      var label = Model.sourceLabel(n, names)
      byId[id] = { id: id, name: label, sourceName: n.source ? label : String(names[id] || ""), missing: !n.source, manga: [] }
      list.push(byId[id])
    }
    byId[id].manga.push({ id: n.id, title: String(n.title || "") })
  })
  return list.sort(function(a, b) { return a.name.localeCompare(b.name) })
}

// A batch: one search of the target source per old manga, each a Browse
// listing so GlobalSearch drives it. picks[i]: the chosen result's index
// in group i, -1 for none (skip, no match or still searching).
function batch(target, manga) {
  return {
    manga: manga,
    search: { query: "", groups: manga.map(function(m) { return Browse.listing(target, "search", m.title) }) },
    picks: manga.map(function() { return -1 })
  }
}

// Mihon searches the library one manga at a time.
function due(b) {
  return GlobalSearch.due(b.search, 1)
}

function reduceBatch(b, index, event) {
  var search = GlobalSearch.reduce(b.search, index, event)
  if (search === b.search) return b
  var picks = b.picks
  if (event.type === "reply") {
    picks = b.picks.slice()
    picks[index] = propose(b.manga[index].title, search.groups[index].items)
  }
  return copy(b, { search: search, picks: picks })
}

// Steps through the row's results and then "skip", wrapping.
function pick(b, index, delta) {
  var n = b.search.groups[index].items.length
  var at = b.picks[index] === -1 ? n : b.picks[index]
  at = ((at + delta) % (n + 1) + n + 1) % (n + 1)
  var picks = b.picks.slice()
  picks[index] = at === n ? -1 : at
  return copy(b, { picks: picks })
}

function chosen(b, index) {
  return b.picks[index] === -1 ? null : b.search.groups[index].items[b.picks[index]]
}

function retry(b) {
  return copy(b, { search: GlobalSearch.retry(b.search) })
}

// A batch row's right side: the pick and where it sits among the results,
// "skip", or the search's own status.
function matchStatus(b, index, configPath) {
  var g = b.search.groups[index]
  var t = chosen(b, index)
  if (t) return t.title + "   " + (b.picks[index] + 1) + " of " + g.items.length
  if (g.state === "ok" && g.items.length) return "skip   " + g.items.length + (g.items.length === 1 ? " result" : " results")
  return GlobalSearch.status(g, configPath)
}

// plan: the plan for one migration; total: the target's chapter count.
function planText(p, total) {
  return "Marks " + p.read.length + " of " + total + " chapters read and " + p.bookmark.length + " bookmarked."
}

// What the batch migrates: { old: { id, title }, target: { id, title } }.
function jobs(b) {
  var out = []
  b.manga.forEach(function(m, i) {
    var t = chosen(b, i)
    if (t) out.push({ old: m, target: t })
  })
  return out
}

if (typeof module !== "undefined") {
  module.exports = {
    OLD_QUERY: OLD_QUERY,
    TARGET_MUTATION: TARGET_MUTATION,
    LIBRARY_QUERY: LIBRARY_QUERY,
    plan: plan,
    targetPayload: targetPayload,
    trackRecords: trackRecords,
    oldPayload: oldPayload,
    downloaded: downloaded,
    similarity: similarity,
    propose: propose,
    targets: targets,
    librarySources: librarySources,
    batch: batch,
    due: due,
    reduceBatch: reduceBatch,
    pick: pick,
    chosen: chosen,
    retry: retry,
    matchStatus: matchStatus,
    planText: planText,
    jobs: jobs
  }
}
