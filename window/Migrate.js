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
  + " manga { id title inLibrary meta { key value } trackRecords { nodes { tracker { name } } } } chapters { id chapterNumber isRead isBookmarked } } }"
var LIBRARY_QUERY = "{ mangas(condition: { inLibrary: true }, orderBy: TITLE) { nodes { id title sourceId source { displayName } } }"
  + " metas(condition: { key: \"" + Model.SOURCE_NAMES_META + "\" }) { nodes { value } } }"
var HIGHEST_QUERY = "query($ids: [Int!]) { mangas(filter: { id: { in: $ids } }) { nodes { id highestNumberedChapter { chapterNumber } } } }"
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
// merge: mergeInto(the target), its own { meta, trackRecords } when it is
// already a library manga, whatever led there. Its state wins: no
// clear, so it keeps its categories and gains the old ones (it is in the
// library already, so no default category joins); the old reading mode
// only when it has none; the old tracks only on trackers it lacks.
function targetPayload(old, targetId, p, withTracks, merge) {
  var mode = merge && readingMode(merge) ? null : readingMode(old)
  var tracks = withTracks ? movingTracks(old, merge) : []
  var vars = { target: targetId, categories: old.categories.nodes.map(function(c) { return c.id }), read: p.read, bookmark: p.bookmark }
  var params = ["$target: Int!", "$categories: [Int!]!", "$read: [Int!]!", "$bookmark: [Int!]!"]
  var query = " library: updateManga(input: { id: $target, patch: { inLibrary: true } }) { manga { id } }"
    + " categories: updateMangaCategories(input: { id: $target, patch: { " + (merge ? "" : "clearCategories: true, ") + "addToCategories: $categories } }) { manga { id } }"
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

// A TARGET_MUTATION manga -> targetPayload's merge, or null for a target
// not in the library, which takes Mihon's plain Migrate.
function mergeInto(target) {
  return target.inLibrary ? { meta: target.meta, trackRecords: target.trackRecords } : null
}

function readingMode(manga) {
  return (manga.meta || []).filter(function(m) { return m.key === MODE_KEY })[0]
}

// An OLD_QUERY manga node -> its tracks: [{ id, tracker }].
function trackRecords(old) {
  return ((old.trackRecords && old.trackRecords.nodes) || []).map(function(n) { return { id: n.id, tracker: String(n.tracker.name) } })
}

// The old manga's tracks that go along: all of them, or in a merge (merge:
// the kept copy) those on trackers the kept copy has no track on.
function movingTracks(old, merge) {
  var has = merge ? trackRecords(merge).map(function(t) { return t.tracker }) : []
  return trackRecords(old).filter(function(t) { return has.indexOf(t.tracker) === -1 })
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

// Browse.sources() -> the sources a batch searches for a manga, in order: a
// source named like its own first (a new version of a source gets a new
// id; while its own is installed, only in its language), then the pinned
// ones (Browse.pinned ids) in pin order; never its own.
function preferred(sources, oldSourceId, oldName, pinned) {
  var k = key(oldName)
  var own = sources.filter(function(s) { return s.id === String(oldSourceId) })[0]
  var others = sources.filter(function(s) { return s !== own })
  var same = others.filter(function(s) { return k !== "" && key(s.name) === k && (!own || s.lang === own.lang) })
  var pins = (pinned || []).map(function(id) { return others.filter(function(s) { return s.id === id })[0] })
  return same.concat(pins.filter(function(s) { return s && same.indexOf(s) === -1 }))
}

// Where the manga can go: preferred(), then every other source.
function targets(sources, oldSourceId, oldName, pinned) {
  var first = preferred(sources, oldSourceId, oldName, pinned)
  return first.concat(sources.filter(function(s) { return s.id !== String(oldSourceId) && first.indexOf(s) === -1 }))
}

// manga: [{ id, title, sourceId, sourceName, stalled, highest }] -> each
// with its targets, preferred(). null when none has one: the user then
// picks one source for all (withTarget).
function withTargets(manga, sources, pinned) {
  var out = manga.map(function(m) { return copy(m, { targets: preferred(sources, m.sourceId, m.sourceName, pinned) }) })
  return out.some(function(m) { return m.targets.length }) ? out : null
}

// HIGHEST_QUERY data -> the manga with highest, the chapter number a
// stalled one's target must pass; -1 with no chapters.
function withHighest(manga, data) {
  var nodes = (data.mangas && data.mangas.nodes) || []
  return manga.map(function(m) {
    var n = nodes.filter(function(o) { return o.id === m.id })[0]
    return copy(m, { highest: n && n.highestNumberedChapter ? n.highestNumberedChapter.chapterNumber : -1 })
  })
}

function withTarget(manga, to) {
  return manga.map(function(m) { return copy(m, { targets: String(m.sourceId) === to.id ? [] : [to] }) })
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

// A batch: manga as withTargets() gives them. Group i, a Browse listing so
// GlobalSearch drives it, searches manga i's target at[i]; a search with
// no match moves the row on to its next target. picks[i]: the chosen
// result's index in group i, -1 for none (skip, no match or still
// searching). held[i]: a stalled manga's match waiting for its chapter
// check, { pick, state: "idle" | "loading" | "failed" }, or null. A
// failed check moves on, or on the last target waits for r.
function batch(manga) {
  return {
    manga: manga,
    search: { query: "", groups: manga.map(function(m) { return group(m, 0) }) },
    picks: manga.map(function() { return -1 }),
    at: manga.map(function() { return 0 }),
    held: manga.map(function() { return null })
  }
}

// A manga with no target to search is a finished, empty search.
function group(m, at) {
  var t = m.targets[at]
  var g = Browse.listing(t || { id: "", name: "" }, "search", m.title)
  return t ? g : copy(g, { state: "ok", page: 1, hasNext: false })
}

function set(b, field, index, value) {
  var list = b[field].slice()
  list[index] = value
  var c = {}
  c[field] = list
  return copy(b, c)
}

function checking(b) {
  return b.held.some(function(h) { return h && h.state === "loading" })
}

// Mihon searches the library one manga at a time; a chapter check counts.
function due(b) {
  return checking(b) ? [] : GlobalSearch.due(b.search, 1)
}

// The rows whose chapter check can start: the first held one, while
// nothing else is in flight. Sent before due().
function checks(b) {
  if (checking(b) || b.search.groups.some(function(g) { return g.state === "loading" })) return []
  var i = b.held.findIndex(function(h) { return h && h.state === "idle" })
  return i === -1 ? [] : [i]
}

// Fetches the held match with its chapters; the reply goes back as
// { type: "checked", reply }.
// ponytail: prepare() fetches the target again on confirm; keep this reply
// in the job if the second fetch shows.
function checkPayload(b, index) {
  return { query: TARGET_MUTATION, variables: { id: b.search.groups[index].items[b.held[index].pick].id } }
}

function newest(chapters) {
  return chapters.filter(recognized).reduce(function(n, c) { return Math.max(n, c.chapterNumber) }, -1)
}

// The searches and chapter checks waiting past their deadline at now (ms);
// each gets a "timeout".
function expired(b, now) {
  var out = GlobalSearch.expired(b.search, now)
  b.held.forEach(function(h, i) { if (h && h.state === "loading" && h.deadline <= now) out.push(i) })
  return out
}

function advance(b, index) {
  var at = b.at[index] + 1
  if (at >= b.manga[index].targets.length) return b
  var groups = b.search.groups.slice()
  // The attempt count goes on, so a late reply to the last search drops.
  groups[index] = copy(group(b.manga[index], at), { attempt: groups[index].attempt })
  return set(copy(b, { search: { query: b.search.query, groups: groups } }), "at", index, at)
}

// event: a GlobalSearch.reduce event for group index, or "check" (its
// chapter check is sent, with now) and "checked" { reply }; a "timeout"
// fails a waiting check as it does a search. A stalled manga takes a
// match only when it has a higher chapter number than the old manga's
// highest.
function reduceBatch(b, index, event) {
  var h = b.held[index]
  if (event.type === "check") return set(b, "held", index, copy(h, { state: "loading", deadline: event.now + GlobalSearch.TIMEOUT }))
  if (event.type === "timeout" && h && h.state === "loading") event = { type: "checked", reply: { state: "timeout" } }
  if (event.type === "checked") {
    if (!h || h.state !== "loading") return b
    var r = event.reply
    if (r.state !== "ok" && b.at[index] + 1 >= b.manga[index].targets.length) return set(b, "held", index, copy(h, { state: "failed" }))
    var more = r.state === "ok" && newest(r.data.fetchMangaAndChapters.chapters) > b.manga[index].highest
    var cleared = set(b, "held", index, null)
    return more ? set(cleared, "picks", index, h.pick) : advance(cleared, index)
  }
  var search = GlobalSearch.reduce(b.search, index, event)
  if (search === b.search) return b
  var next = copy(b, { search: search })
  if (event.type !== "reply" && event.type !== "timeout") return next
  var g = search.groups[index]
  var p = g.state === "ok" ? propose(b.manga[index].title, g.items) : -1
  if (p === -1) return advance(next, index)
  return b.manga[index].stalled ? set(next, "held", index, { pick: p, state: "idle" }) : set(next, "picks", index, p)
}

// Steps through the row's results and then "skip", wrapping. A choice by
// hand drops the row's chapter check.
function pick(b, index, delta) {
  var n = b.search.groups[index].items.length
  var at = b.picks[index] === -1 ? n : b.picks[index]
  at = ((at + delta) % (n + 1) + n + 1) % (n + 1)
  return set(set(b, "held", index, null), "picks", index, at === n ? -1 : at)
}

function chosen(b, index) {
  return b.picks[index] === -1 ? null : b.search.groups[index].items[b.picks[index]]
}

function retry(b) {
  var held = b.held.map(function(h) { return h && h.state === "failed" ? copy(h, { state: "idle" }) : h })
  return copy(b, { search: GlobalSearch.retry(b.search), held: held })
}

// A batch row's right side: the pick and where it sits among the results,
// "skip", or the search's own status, then the source it searched.
function matchStatus(b, index, configPath) {
  var m = b.manga[index]
  if (!m.targets.length) return "No source to search"
  var g = b.search.groups[index]
  var where = "   " + g.source.name
  var t = chosen(b, index)
  if (t) return t.title + "   " + (b.picks[index] + 1) + " of " + g.items.length + where
  if (b.held[index]) return (b.held[index].state === "failed" ? "chapter check failed. Press r to retry." : "checking chapters") + where
  if (m.stalled && g.state === "ok") return "No source has more chapters."
  if (g.state === "ok" && g.items.length) return "skip   " + g.items.length + (g.items.length === 1 ? " result" : " results") + where
  return GlobalSearch.status(g, configPath) + where
}

// plan: the plan for one migration; total: the target's chapter count.
function planText(p, total) {
  return "Marks " + p.read.length + " of " + total + " chapters read and " + p.bookmark.length + " bookmarked."
}

// What the batch migrates: { old: { id, title }, target: { id, title, source } }.
function jobs(b) {
  var out = []
  b.manga.forEach(function(m, i) {
    var t = chosen(b, i)
    if (t) out.push({ old: m, target: { id: t.id, title: t.title, source: b.search.groups[i].source.name } })
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
    mergeInto: mergeInto,
    trackRecords: trackRecords,
    movingTracks: movingTracks,
    oldPayload: oldPayload,
    downloaded: downloaded,
    similarity: similarity,
    key: key,
    propose: propose,
    targets: targets,
    withTargets: withTargets,
    withTarget: withTarget,
    withHighest: withHighest,
    HIGHEST_QUERY: HIGHEST_QUERY,
    librarySources: librarySources,
    batch: batch,
    due: due,
    checks: checks,
    checkPayload: checkPayload,
    expired: expired,
    reduceBatch: reduceBatch,
    pick: pick,
    chosen: chosen,
    retry: retry,
    matchStatus: matchStatus,
    planText: planText,
    jobs: jobs
  }
}
