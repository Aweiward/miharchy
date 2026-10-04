.pragma library
.import "Model.js" as Model
.import "Browse.js" as Browse

// The Updates view: unread chapters a library update found, and the
// server's library update run. Pure, so tests/updates.test.js pins it;
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
  + " nodes { id name uploadDate fetchedAt sourceOrder isRead manga { id title thumbnailUrl inLibraryAt } } } " + STATUS_FIELDS + " }"
var STATUS_QUERY = "{ " + STATUS_FIELDS + " }"
// Its own reply holds the status from before the run, so the view polls.
var CHECK_MUTATION = "mutation { updateLibrary(input: {}) { clientMutationId } }"

function copy(o, changes) {
  var c = {}
  for (var k in o) c[k] = o[k]
  for (var j in changes) c[j] = changes[j]
  return c
}

// Reply data from UPDATES_QUERY -> its updates, newest fetched first. An
// update is an unread chapter fetched after its manga joined the library,
// as in Mihon; the chapters fetched when it joined are its backlog.
// fetchedAt and inLibraryAt are seconds.
function updates(data) {
  var nodes = (data.chapters && data.chapters.nodes) || []
  return nodes
    .filter(function(c) { return !c.isRead && c.manga && Number(c.fetchedAt) > Number(c.manga.inLibraryAt) })
    .sort(function(a, b) { return Number(b.fetchedAt) - Number(a.fetchedAt) || b.sourceOrder - a.sourceOrder })
}

// The unread update count, for the bar mark: it runs UPDATES_QUERY too.
function count(data) {
  return updates(data).length
}

// updates.state: "loading" | "ok" | a failed connection state.
// rows: { id, mangaId, title, cover, chapter, date, header }, header the
// fetch day on the first row of each day, else "".
// running: the server runs a library update; checking: u asked for one and
// no poll has answered yet. checkedAt: when the last run started, in ms.
function initial() {
  return { state: "loading", message: "", rows: [], running: false, checking: false, finished: 0, total: 0, skipped: 0, skipReasons: [], checkedAt: 0 }
}

function listPayload() {
  return { query: UPDATES_QUERY }
}

function statusPayload() {
  return { query: STATUS_QUERY }
}

function checkPayload() {
  return { query: CHECK_MUTATION }
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

function rows(data, config, now) {
  var last = ""
  return updates(data).map(function(c) {
    var day = dayLabel(Number(c.fetchedAt) * 1000, now)
    var row = {
      id: c.id,
      mangaId: c.manga.id,
      title: String(c.manga.title || ""),
      cover: Model.coverUrl(config, c.manga.thumbnailUrl),
      chapter: String(c.name || ""),
      date: Browse.day(c.uploadDate),
      header: day === last ? "" : day
    }
    last = day
    return row
  })
}

function status(data) {
  var j = (data.libraryUpdateStatus && data.libraryUpdateStatus.jobsInfo) || {}
  return {
    running: j.isRunning === true,
    finished: j.finishedJobs || 0,
    total: j.totalJobs || 0,
    skipped: j.skippedMangasCount || 0,
    skipReasons: SKIP_FILTERS.filter(function(f) { return data.settings && data.settings[f[0]] === true }).map(function(f) { return f[1] }),
    checkedAt: Number(data.lastUpdateTimestamp && data.lastUpdateTimestamp.timestamp) || 0
  }
}

// event.type:
//   "request"   a list load went out
//   "list"      { reply, config, now } for listPayload()
//   "checking"  checkPayload() went out
//   "status"    { reply } for statusPayload()
function reduce(u, event) {
  switch (event.type) {
    case "request":
      return copy(u, { state: "loading", message: "" })
    case "list":
      var r = event.reply
      if (r.state !== "ok") return copy(u, { state: r.state, message: r.message })
      return copy(copy(u, status(r.data)), { state: "ok", message: "", rows: rows(r.data, event.config, event.now) })
    case "checking":
      return copy(u, { checking: true })
    case "status":
      if (event.reply.state !== "ok") return copy(u, { running: false, checking: false })
      return copy(copy(u, status(event.reply.data)), { checking: false })
  }
  return u
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
  if (!u.checkedAt) return "Never checked"
  var d = new Date(u.checkedAt)
  return "Last checked " + dayLabel(u.checkedAt, now) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes())
    + skippedText(u)
}

// { title, detail } in place of the list, or null.
function notice(u, configPath) {
  if (u.state === "loading") return u.rows.length ? null : { title: "Loading updates", detail: "" }
  var p = Model.problem(u, configPath)
  if (p) return p
  if (!u.rows.length) return { title: "No new chapters", detail: "Press u to check the library for new chapters." }
  return null
}

if (typeof module !== "undefined") {
  module.exports = {
    UPDATES_QUERY: UPDATES_QUERY,
    updates: updates,
    count: count,
    initial: initial,
    rows: rows,
    listPayload: listPayload,
    statusPayload: statusPayload,
    checkPayload: checkPayload,
    reduce: reduce,
    finished: finished,
    progress: progress,
    notice: notice
  }
}
