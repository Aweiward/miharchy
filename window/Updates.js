.pragma library
.import "Model.js" as Model
.import "Browse.js" as Browse
.import "Prefs.js" as Prefs
.import "Chapters.js" as Chapters

// The Updates view: chapters a library update found, through the user's
// filters, and the server's library update run. Pure, so tests/updates.test.js pins it;
// UpdatesView.qml sends the payloads built here and feeds replies back.

// The server's skip filters and the reason each gives. It reports only a
// skipped count, never which filter skipped a manga, so the header names
// the filters that are on.
var SKIP_FILTERS = [
  ["excludeUnreadChapters", "unread chapters"],
  ["excludeNotStarted", "not started"],
  ["excludeCompleted", "completed"]
]
var STATUS_FIELDS = "libraryUpdateStatus { jobsInfo { isRunning finishedJobs totalJobs skippedMangasCount } } lastUpdateTimestamp { timestamp }"
  + " settings { " + SKIP_FILTERS.map(function(f) { return f[0] }).join(" ") + " }"
// ponytail: no page limit; the client-side fetchedAt cut must see every
// unread chapter, so a limit waits for a library big enough to need one.
var UPDATES_QUERY = "{ chapters(filter: { inLibrary: { equalTo: true }, isRead: { equalTo: false } }) {"
  + " nodes { id name uploadDate fetchedAt sourceOrder isRead lastPageRead isBookmarked isDownloaded manga { id title thumbnailUrl inLibraryAt } } } " + STATUS_FIELDS + " }"
// Each result holds the run's counts, the first one too; the last-checked
// time and the skip filters come with the list, which reloads after a run.
var LIVE_QUERY = "subscription { libraryUpdateStatusChanged(input: {}) { jobsInfo { isRunning finishedJobs totalJobs skippedMangasCount } } }"
// The view's list: read updates too, and what the filters test. The
// 3-month cut runs on the server here, since read chapters are most of a
// library.
var VIEW_QUERY = "query($since: LongString!) { chapters(filter: { inLibrary: { equalTo: true }, uploadDate: { greaterThan: $since } }) {"
  + " nodes { id name uploadDate fetchedAt sourceOrder isRead lastPageRead isBookmarked isDownloaded scanlator"
  + " manga { id title thumbnailUrl inLibraryAt categories { nodes { id } } meta { key value } } } } " + STATUS_FIELDS + " }"
// The run's progress comes through LIVE_QUERY. With no categories the server skips the excluded ones (Categories.js);
// with categories it updates every manga in them, as Mihon's per-category
// update does.
var CHECK_MUTATION = "mutation($categories: [Int!]) { updateLibrary(input: { categories: $categories }) { clientMutationId } }"

function copy(o, changes) {
  var c = {}
  for (var k in o) c[k] = o[k]
  for (var j in changes) c[j] = changes[j]
  return c
}

// Mihon's Updates filters (UpdatesFilterDialog, updatesView.sq), each a
// Prefs.TRI_STATE; out is what exclude keeps, when not the opposite of
// test. Started is Mihon's: some progress and not read, so excluding it
// keeps only untouched chapters.
var FILTERS = [
  { id: "unread", label: "Unread", test: function(c) { return !c.isRead } },
  { id: "downloaded", label: "Downloaded", test: function(c) { return c.isDownloaded === true } },
  { id: "started", label: "Started", test: function(c) { return c.lastPageRead > 0 && !c.isRead }, out: function(c) { return !(c.lastPageRead > 0) && !c.isRead } },
  { id: "bookmarked", label: "Bookmarked", test: function(c) { return c.isBookmarked === true } }
]

function filterKey(f) {
  return "updatesFilter" + f.id.charAt(0).toUpperCase() + f.id.slice(1)
}

// Unread starts on, so the list holds what the bar mark counts until the
// user asks for read updates too; Mihon starts with every filter off.
// The categories are JSON lists of ids, 0 for manga in no category.
var PREFS = FILTERS.map(function(f) { return { key: filterKey(f), default: f.id === "unread" ? "include" : "off", options: Prefs.TRI_STATE } }).concat([
  { key: "updatesHideExcludedScanlators", default: "off", options: ["off", "on"] },
  { key: "updatesIncludedCategories", default: "[]" },
  { key: "updatesExcludedCategories", default: "[]" }
])

function ids(json) {
  try {
    var list = JSON.parse(json || "[]")
    return Array.isArray(list) ? list.map(Number) : []
  } catch (e) {
    return []
  }
}

function since(now) {
  var d = new Date(now)
  d.setMonth(d.getMonth() - 3)
  return d.getTime()
}

// Reply data -> every update, read or not, newest fetched first. An update
// is a chapter fetched after its manga joined the library and uploaded in
// the last 3 months, as in Mihon (updatesView.sq and UpdatesViewModel);
// older ones are history, not news. fetchedAt and inLibraryAt are seconds,
// uploadDate and now milliseconds.
function recent(data, now) {
  var nodes = (data.chapters && data.chapters.nodes) || []
  return nodes
    .filter(function(c) {
      return c.manga && Number(c.fetchedAt) > Number(c.manga.inLibraryAt) && Number(c.uploadDate) > since(now)
    })
    .sort(function(a, b) { return Number(b.fetchedAt) - Number(a.fetchedAt) || b.sourceOrder - a.sourceOrder })
}

// The unread updates: the bar mark's list, from UPDATES_QUERY.
function updates(data, now) {
  return recent(data, now).filter(function(c) { return !c.isRead })
}

// The unread update count, for the bar mark.
function count(data, now) {
  return updates(data, now).length
}

// list: category ids, 0 for no category, as Mihon's updatesView.sq.
function inCategories(c, list) {
  var cats = ((c.manga.categories && c.manga.categories.nodes) || []).map(function(n) { return n.id })
  return cats.some(function(id) { return list.indexOf(id) !== -1 }) || (list.indexOf(0) !== -1 && !cats.length)
}

function scanlatorExcluded(c) {
  var meta = (c.manga.meta || []).filter(function(m) { return m.key === Prefs.PREFIX + "excludedScanlators" })[0]
  return meta ? Chapters.excluded({ excludedScanlators: meta.value }).indexOf(c.scanlator) !== -1 : false
}

function passes(c, prefs) {
  var included = ids(prefs.updatesIncludedCategories)
  var excluded = ids(prefs.updatesExcludedCategories)
  return FILTERS.every(function(f) {
    var state = prefs[filterKey(f)]
    if (state === "include") return f.test(c)
    if (state === "exclude") return f.out ? f.out(c) : !f.test(c)
    return true
  }) && (prefs.updatesHideExcludedScanlators !== "on" || !scanlatorExcluded(c))
    && (!included.length || inCategories(c, included))
    && (!excluded.length || !inCategories(c, excluded))
}

// The filter panel's rows, in WidgetPanel's shape: the filters, then with
// categories, a Categories header, Default and each category. A row's
// state is a Prefs.TRI_STATE, or "on" / "off".
var MARKS = { off: "[ ]", include: "[+]", exclude: "[-]", on: "[x]" }

function filterRows(prefs, categories) {
  var included = ids(prefs.updatesIncludedCategories)
  var excluded = ids(prefs.updatesExcludedCategories)
  var row = function(kind, id, label, state) {
    return { kind: kind, id: id, label: label, state: state, mark: MARKS[state] || "", detail: "", summary: "", depth: 0, enabled: true }
  }
  var cats = categories.length ? [{ id: 0, name: "Default" }].concat(categories) : []
  return FILTERS.map(function(f) { return row("filter", f.id, f.label, prefs[filterKey(f)]) })
    .concat([row("scanlators", "", "Hide excluded scanlators", prefs.updatesHideExcludedScanlators)])
    .concat(cats.length ? [row("header", "", "Categories", "")] : [])
    .concat(cats.map(function(c) {
      return row("category", c.id, c.name, included.indexOf(c.id) !== -1 ? "include" : excluded.indexOf(c.id) !== -1 ? "exclude" : "off")
    }))
}

function next(state) {
  var s = Prefs.TRI_STATE
  return s[(s.indexOf(state) + 1) % s.length]
}

// What Enter on a panel row changes: [{ key, value }] for PrefStore.set().
// A category moves through off, include and exclude, as in Mihon.
function choose(prefs, row) {
  if (!row) return []
  if (row.kind === "filter") return [{ key: filterKey(row), value: next(row.state) }]
  if (row.kind === "scanlators") return [{ key: "updatesHideExcludedScanlators", value: row.state === "on" ? "off" : "on" }]
  if (row.kind !== "category") return []
  var state = next(row.state)
  var without = function(json) { return ids(json).filter(function(id) { return id !== row.id }) }
  var included = without(prefs.updatesIncludedCategories).concat(state === "include" ? [row.id] : [])
  var excluded = without(prefs.updatesExcludedCategories).concat(state === "exclude" ? [row.id] : [])
  return [{ key: "updatesIncludedCategories", value: JSON.stringify(included) }, { key: "updatesExcludedCategories", value: JSON.stringify(excluded) }]
}

// updates.state: "loading" | "ok" | a failed connection state.
// rows: { id, mangaId, title, cover, chapter, date, header, read, lastPage,
// bookmarked, downloaded }, header the fetch day on the first row of each
// day, else "". The last four are the chapter fields Chapters.js and
// Downloads.js build their payloads from.
// data: the last list reply's data, which the filters run over again;
// found: its updates before the filters.
// running: the server runs a library update; checking: u asked for one and
// the server has not shown the run yet. checkedAt: when the last run
// started, in ms. stopped: null, or the user stopped the last run, at
// "finished / total" ("" before the run showed).
function initial() {
  return { state: "loading", message: "", rows: [], data: null, found: 0, running: false, checking: false, finished: 0, total: 0, skipped: 0, skipReasons: [], checkedAt: 0, stopped: null }
}

// The bar mark's list: unread updates only.
function listPayload() {
  return { query: UPDATES_QUERY }
}

function viewPayload(now) {
  return { query: VIEW_QUERY, variables: { since: String(since(now)) } }
}

// categories: ids to update, or none for the whole library.
function checkPayload(categories) {
  return { query: CHECK_MUTATION, variables: { categories: categories || null } }
}

// Mihon's cancel on the update notification.
function stopPayload() {
  return { query: "mutation { updateStop(input: {}) { clientMutationId } }" }
}

function pad(n) {
  return n < 10 ? "0" + n : String(n)
}

function dayLabel(ms, now) {
  var day = Browse.day(ms)
  if (day === Browse.day(now)) return "Today"
  var y = new Date(now)
  y.setDate(y.getDate() - 1)
  return day === Browse.day(y.getTime()) ? "Yesterday" : day
}

// prefs: the view's PREFS values, with Downloaded forced on while
// Downloaded only is (Prefs.force); without them, the bar mark's unread
// updates.
function rows(data, config, now, prefs) {
  var last = ""
  var list = prefs ? recent(data, now).filter(function(c) { return passes(c, prefs) }) : updates(data, now)
  return list.map(function(c) {
    var day = dayLabel(Number(c.fetchedAt) * 1000, now)
    var row = {
      id: c.id,
      mangaId: c.manga.id,
      title: String(c.manga.title || ""),
      cover: Model.coverUrl(config, c.manga.thumbnailUrl),
      chapter: String(c.name || ""),
      date: Browse.day(c.uploadDate),
      header: day === last ? "" : day,
      read: c.isRead === true,
      lastPage: c.lastPageRead || 0,
      bookmarked: c.isBookmarked === true,
      downloaded: c.isDownloaded === true
    }
    last = day
    return row
  })
}

function jobs(j) {
  return {
    running: j.isRunning === true,
    finished: j.finishedJobs || 0,
    total: j.totalJobs || 0,
    skipped: j.skippedMangasCount || 0
  }
}

function status(data) {
  var s = jobs((data.libraryUpdateStatus && data.libraryUpdateStatus.jobsInfo) || {})
  s.skipReasons = SKIP_FILTERS.filter(function(f) { return data.settings && data.settings[f[0]] === true }).map(function(f) { return f[1] })
  s.checkedAt = Number(data.lastUpdateTimestamp && data.lastUpdateTimestamp.timestamp) || 0
  return s
}

// event.type:
//   "request"   a list load went out
//   "list"      { reply, config, now, prefs } for viewPayload()
//   "filter"    { config, now, prefs }: the filters changed
//   "checking"  checkPayload() went out
//   "failed"    checkPayload() failed
//   "stopped"   stopPayload() succeeded
//   "live"      { data } for a LIVE_QUERY result
function reduce(u, event) {
  switch (event.type) {
    case "request":
      return copy(u, { state: "loading", message: "" })
    case "list":
      var r = event.reply
      if (r.state !== "ok") return copy(u, { state: r.state, message: r.message })
      return reduce(copy(withStatus(u, status(r.data)), { state: "ok", message: "", data: r.data }), { type: "filter", config: event.config, now: event.now, prefs: event.prefs })
    case "filter":
      if (!u.data) return u
      return copy(u, { rows: rows(u.data, event.config, event.now, event.prefs), found: recent(u.data, event.now).length })
    case "checking":
      return copy(u, { checking: true, stopped: null })
    case "stopped":
      if (!u.running && !u.checking) return u
      return copy(u, { running: false, checking: false, stopped: u.total ? u.finished + " / " + u.total : "" })
    case "failed":
      return copy(u, { running: false, checking: false })
    case "live":
      var l = event.data.libraryUpdateStatusChanged
      if (!l) return u
      var s = jobs(l.jobsInfo || {})
      // A run opens with a result of all zeros, before it counts the
      // library; u's check waits past it. ponytail: a library with no
      // manga sends nothing more, so its check shows until C stops it.
      return copy(withStatus(u, s), { checking: u.checking && !(s.running || s.total || s.skipped) })
  }
  return u
}

// The server forgets a stopped run's counts, so the stop stays in u until
// a run starts.
function withStatus(u, s) {
  return copy(copy(u, s), { stopped: s.running ? null : u.stopped })
}

// Whether a run ended between two states, so the list is due a reload.
function finished(before, after) {
  return (before.running || before.checking) && !after.running && !after.checking
}

// With every filter off, an excluded category or a source that updates a
// manga only once skipped them.
function skippedText(u) {
  if (!u.skipped) return ""
  if (!u.skipReasons.length) return ", " + u.skipped + " manga skipped"
  return ", " + u.skipped + " skipped: " + u.skipReasons.join(", ") + " (change in Settings)"
}

function progress(u, now) {
  if (u.running) return "Checking for new chapters " + u.finished + " / " + u.total
  if (u.checking) return "Checking for new chapters"
  if (u.stopped !== null) return "Stopped checking for new chapters" + (u.stopped ? " at " + u.stopped : "")
  if (!u.checkedAt) return "Never checked"
  var d = new Date(u.checkedAt)
  return "Last checked " + dayLabel(u.checkedAt, now) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes())
    + skippedText(u)
}

// The selection is a list of chapter ids, not a range as on a manga:
// Mihon inverts it, and the inverse of a range is not one.
function toggle(selected, id) {
  return selected.indexOf(id) === -1 ? selected.concat([id]) : selected.filter(function(s) { return s !== id })
}

function invert(selected, rows) {
  return rows.filter(function(r) { return selected.indexOf(r.id) === -1 }).map(function(r) { return r.id })
}

// What stays selected after a reload: an update that left the list goes.
function keep(selected, rows) {
  return selected.filter(function(id) { return rows.some(function(r) { return r.id === id }) })
}

// The rows an action applies to: the selection, or the row under the
// cursor when nothing is selected.
function chosen(rows, selected, cursor) {
  if (!selected.length) return rows[cursor] ? [rows[cursor]] : []
  return rows.filter(function(r) { return selected.indexOf(r.id) !== -1 })
}

function mangaIds(rows) {
  return rows.map(function(r) { return r.mangaId }).filter(function(id, i, all) { return all.indexOf(id) === i })
}

// { title, detail } in place of the list, or null.
function notice(u, configPath) {
  if (u.state === "loading") return u.rows.length ? null : { title: "Loading updates", detail: "" }
  var p = Model.problem(u, configPath)
  if (p) return p
  if (!u.rows.length && u.found) return { title: "No updates match the filters", detail: "Press F to change the filters." }
  if (!u.rows.length) return { title: "No new chapters", detail: "Press u to check the library for new chapters." }
  return null
}

if (typeof module !== "undefined") {
  module.exports = {
    UPDATES_QUERY: UPDATES_QUERY,
    VIEW_QUERY: VIEW_QUERY,
    PREFS: PREFS,
    updates: updates,
    viewPayload: viewPayload,
    filterRows: filterRows,
    choose: choose,
    count: count,
    initial: initial,
    rows: rows,
    listPayload: listPayload,
    LIVE_QUERY: LIVE_QUERY,
    checkPayload: checkPayload,
    stopPayload: stopPayload,
    reduce: reduce,
    finished: finished,
    progress: progress,
    notice: notice,
    toggle: toggle,
    invert: invert,
    keep: keep,
    chosen: chosen,
    mangaIds: mangaIds
  }
}
