.pragma library
.import "Model.js" as Model
.import "Migrate.js" as Migrate

// The library check: the problems in the library, derived from server data
// only each time it loads; no source is contacted. Only dismisses are
// stored, as manga meta DISMISSED_META: { kind: ms when dismissed }. Pure,
// so tests/librarycheck.test.js pins it; LibraryCheckView.qml wires it.

var DISMISSED_META = "miharchy.checkDismissed"
var DAY = 24 * 3600 * 1000
// ponytail: fixed cuts from the issue; a Settings row when users differ.
var FAILED_AFTER = 14 * DAY
var STALLED_AFTER = 183 * DAY
var SIMILAR = 0.9

var QUERY = "{ mangas(condition: { inLibrary: true }) { nodes { id title status updateStrategy sourceId unreadCount chaptersLastFetchedAt"
  + " source { id displayName extension { pkgName name hasUpdate } } chapters { totalCount } lastReadChapter { id }"
  + " latestUploadedChapter { uploadDate } latestFetchedChapter { fetchedAt } meta { key value } } }"
  + " metas(condition: { key: \"" + Model.SOURCE_NAMES_META + "\" }) { nodes { value } }"
  + " lastUpdateTimestamp { timestamp } settings { excludeUnreadChapters excludeNotStarted excludeCompleted }"
  + " libraryUpdateStatus { mangaUpdates { status manga { id } } } }"

// The server's library update skips these by design (Updates.SKIP_FILTERS),
// so an old fetch on them is no failure.
function skipped(m, settings) {
  return m.strategy === "ONLY_FETCH_ONCE"
    || (settings.excludeUnreadChapters === true && m.unread > 0)
    || (settings.excludeNotStarted === true && !m.started)
    || (settings.excludeCompleted === true && m.status === "COMPLETED")
}

// Each kind in screen order: find(m, ctx) gives the reason, or null.
var KINDS = [
  { id: "missing", label: "Source missing", find: function(m) {
    return m.installed ? null : "Its extension is not installed."
  } },
  { id: "failed", label: "Update failed", find: function(m, ctx) {
    if (!m.installed || !ctx.lastUpdate || ctx.lastUpdate <= m.fetched || ctx.now - m.fetched <= FAILED_AFTER || skipped(m, ctx.settings)) return null
    return ctx.failed[m.id] ? "The last library update failed for it." : "No chapters fetched for " + Math.floor((ctx.now - m.fetched) / DAY) + " days, though library updates ran."
  } },
  { id: "empty", label: "No chapters", find: function(m) {
    return m.total === 0 ? "It has no chapters." : null
  } },
  { id: "extension", label: "Extension update", find: function(m) {
    return m.extensionUpdate ? m.extension + " has an update. Enter updates it." : null
  } },
  { id: "duplicate", label: "Duplicate", find: function(m, ctx) {
    var others = ctx.dupes[m.id]
    return others ? "Also in the library: " + others.map(function(o) { return o.title + " (" + o.source + ")" }).join(", ") : null
  } },
  { id: "stalled", label: "Stalled", find: function(m, ctx) {
    if (m.status !== "ONGOING" || !m.newest || ctx.now - m.newest <= STALLED_AFTER) return null
    return "Ongoing, but no new chapter for " + Math.floor((ctx.now - m.newest) / (30 * DAY)) + " months."
  } }
]

function label(kind) {
  return KINDS.filter(function(k) { return k.id === kind })[0].label
}

function dismissals(meta) {
  var node = (meta || []).filter(function(x) { return x.key === DISMISSED_META })[0]
  try {
    var map = JSON.parse(node ? node.value : "{}")
    return map && typeof map === "object" ? map : {}
  } catch (e) {
    return {}
  }
}

// A QUERY node -> the manga as the kinds read it, every time in ms.
function toManga(n, names) {
  var ext = n.source && n.source.extension
  var uploaded = Number(n.latestUploadedChapter && n.latestUploadedChapter.uploadDate) || 0
  var fetched = (Number(n.latestFetchedChapter && n.latestFetchedChapter.fetchedAt) || 0) * 1000
  return {
    id: n.id,
    title: String(n.title || ""),
    sourceId: String(n.sourceId),
    source: n.source ? Model.sourceLabel(n, names) : names[n.sourceId] || "Unknown source " + n.sourceId,
    installed: !!n.source,
    extension: ext ? String(ext.name || ext.pkgName) : "",
    pkgName: ext ? ext.pkgName : "",
    extensionUpdate: !!(ext && ext.hasUpdate),
    status: n.status,
    strategy: n.updateStrategy,
    unread: n.unreadCount || 0,
    started: !!n.lastReadChapter,
    total: (n.chapters && n.chapters.totalCount) || 0,
    fetched: (Number(n.chaptersLastFetchedAt) || 0) * 1000,
    // The upload date, or the fetch time when the source gives none.
    newest: uploaded || fetched,
    dismissals: dismissals(n.meta)
  }
}

// A title as duplicates compare it: Migrate.key's case, punctuation and
// "(…)" rule; a title with no Latin letters or digits stays as written.
function titleKey(title) {
  return Migrate.key(title) || title.trim().toLowerCase()
}

// manga -> { id: [the other manga it duplicates] }.
// ponytail: every pair, O(n²) Levenshtein after a length cut; a title index
// when a library runs to thousands.
function duplicates(manga) {
  var keys = manga.map(function(m) { return titleKey(m.title) })
  var out = {}
  var add = function(a, b) { (out[a.id] = out[a.id] || []).push(b) }
  for (var i = 0; i < manga.length; i++) {
    for (var j = i + 1; j < manga.length; j++) {
      var a = keys[i]
      var b = keys[j]
      if (!a || !b) continue
      var longest = Math.max(a.length, b.length)
      if (a !== b && (Math.abs(a.length - b.length) > (1 - SIMILAR) * longest || Migrate.similarity(a, b) < SIMILAR)) continue
      add(manga[i], manga[j])
      add(manga[j], manga[i])
    }
  }
  return out
}

// QUERY data -> every problem, each manga's in KINDS order:
// { key, kind, mangaId, title, sourceId, source, reason, pkgName, others,
// dismissals, dismissed }. A stalled dismiss lapses once a chapter newer
// than it arrives; the others hold while the problem does.
function problems(data, now) {
  var names = Model.parseNames(data)
  var manga = ((data.mangas && data.mangas.nodes) || []).map(function(n) { return toManga(n, names) })
  var failed = {}
  var updates = (data.libraryUpdateStatus && data.libraryUpdateStatus.mangaUpdates) || []
  updates.forEach(function(u) { if (u.status === "FAILED" && u.manga) failed[u.manga.id] = true })
  var ctx = {
    now: now,
    lastUpdate: Number(data.lastUpdateTimestamp && data.lastUpdateTimestamp.timestamp) || 0,
    settings: data.settings || {},
    failed: failed,
    dupes: duplicates(manga)
  }
  var out = []
  manga.forEach(function(m) {
    KINDS.forEach(function(k) {
      var reason = k.find(m, ctx)
      if (reason === null) return
      var at = m.dismissals[k.id]
      out.push({
        key: k.id + ":" + m.id,
        kind: k.id,
        mangaId: m.id,
        title: m.title,
        sourceId: m.sourceId,
        source: m.source,
        reason: reason,
        pkgName: k.id === "extension" ? m.pkgName : "",
        others: k.id === "duplicate" ? ctx.dupes[m.id].map(function(o) { return o.id }) : [],
        dismissals: m.dismissals,
        dismissed: typeof at === "number" && !(k.id === "stalled" && m.newest > at)
      })
    })
  })
  return out
}

// The problems not dismissed: the Settings row's count.
function count(list) {
  return list.filter(function(p) { return !p.dismissed }).length
}

function countText(n) {
  return n === 0 ? "No problems" : n === 1 ? "1 problem" : n + " problems"
}

// What the screen lists: the problems not dismissed, or with showDismissed
// only the dismissed ones, grouped by kind in KINDS order, then by source,
// each group under a header row. A header: { type: "group", key, kind,
// source, label }; a problem row is the problem with type "problem".
function rows(list, showDismissed) {
  var order = KINDS.map(function(k) { return k.id })
  var shown = list.filter(function(p) { return p.dismissed === showDismissed }).slice()
  shown.sort(function(a, b) {
    return order.indexOf(a.kind) - order.indexOf(b.kind) || a.source.localeCompare(b.source) || a.title.localeCompare(b.title) || a.mangaId - b.mangaId
  })
  var out = []
  var header = null
  shown.forEach(function(p) {
    if (!header || header.kind !== p.kind || header.source !== p.source) {
      header = { type: "group", key: "group:" + p.kind + ":" + p.source, kind: p.kind, source: p.source, size: 0 }
      out.push(header)
    }
    header.size++
    var row = { type: "problem" }
    for (var k in p) row[k] = p[k]
    out.push(row)
  })
  out.forEach(function(r) { if (r.type === "group") r.label = label(r.kind) + " — " + r.source + " (" + r.size + ")" })
  return out
}

// The problem rows of the group whose header is at index.
function groupRows(list, index) {
  var out = []
  for (var i = index + 1; i < list.length && list[i].type === "problem"; i++) out.push(list[i])
  return out
}

function copy(o) {
  var c = {}
  for (var k in o) c[k] = o[k]
  return c
}

// selected: { problem key: true }. Space on a row flips it; on a header it
// selects the group, or deselects it when all of it is selected.
function select(selected, list, index) {
  var row = list[index]
  var next = copy(selected)
  if (!row) return next
  if (row.type === "problem") {
    if (next[row.key]) delete next[row.key]
    else next[row.key] = true
    return next
  }
  var group = groupRows(list, index)
  var all = group.every(function(r) { return next[r.key] })
  group.forEach(function(r) {
    if (all) delete next[r.key]
    else next[r.key] = true
  })
  return next
}

// The manga ids of the selected rows, in row order, each once: what a batch
// action (#273) acts on.
function selectedIds(selected, list) {
  var ids = []
  list.forEach(function(r) { if (r.type === "problem" && selected[r.key] && ids.indexOf(r.mangaId) === -1) ids.push(r.mangaId) })
  return ids
}

// What x acts on: the selected rows, else the group under the cursor, else
// its row.
function targets(list, selected, cursor) {
  var picked = list.filter(function(r) { return r.type === "problem" && selected[r.key] })
  if (picked.length) return picked
  var row = list[cursor]
  if (!row) return []
  return row.type === "group" ? groupRows(list, cursor) : [row]
}

// Dismisses the problems (undo: brings them back) in one write, a
// setMangaMeta per manga that keeps its other kinds. null for none.
function dismissPayload(list, now, undo) {
  var maps = {}
  var ids = []
  list.forEach(function(p) {
    if (!maps[p.mangaId]) {
      maps[p.mangaId] = copy(p.dismissals)
      ids.push(p.mangaId)
    }
    if (undo) delete maps[p.mangaId][p.kind]
    else maps[p.mangaId][p.kind] = now
  })
  if (!ids.length) return null
  var vars = {}
  var params = []
  var fields = []
  ids.forEach(function(id, i) {
    vars["m" + i] = { mangaId: id, key: DISMISSED_META, value: JSON.stringify(maps[id]) }
    params.push("$m" + i + ": MangaMetaTypeInput!")
    fields.push("m" + i + ": setMangaMeta(input: { meta: $m" + i + " }) { meta { key value } }")
  })
  return { query: "mutation(" + params.join(", ") + ") { " + fields.join(" ") + " }", variables: vars }
}

if (typeof module !== "undefined") {
  module.exports = {
    DISMISSED_META: DISMISSED_META,
    QUERY: QUERY,
    KINDS: KINDS,
    problems: problems,
    count: count,
    countText: countText,
    rows: rows,
    select: select,
    selectedIds: selectedIds,
    targets: targets,
    dismissPayload: dismissPayload
  }
}
