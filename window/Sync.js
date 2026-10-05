.pragma library
.import "Setup.js" as Setup

// Sync now: the job that runs the sync helper and what its result says.
// Pure, so tests/sync.test.js pins it; SyncView.qml and the mark's popup
// run the command built here and feed the output back.

// A checkout's own build, from window/ and plugin/ alike: both sit beside
// sync/. The helper Setup installs under $HOME comes first.
var DEV_HELPER = "../sync/build/install/miharchy-sync/bin/miharchy-sync"
var HELPER_DIR = Setup.HELPER_DIR
// The helper's exit status when it is not built: the shell's "not found".
var NOT_BUILT = 127

// The helper takes the sync folder from meta miharchy.syncFolder and holds
// a lock, so the window and the popup start it the same way.
function command(devHelper) {
  return Setup.command("for h in \"$HOME/" + HELPER_DIR + "/bin/miharchy-sync\" \"$1\"; do test -x \"$h\" && exec \"$h\" sync --json; done\nexit " + NOT_BUILT, [devHelper])
}

// The helper's "type" for each change, as Main.kt counts them.
var COUNTS = [
  ["importManga", "imported %d manga"],
  ["addToLibrary", "added %d manga to the library"],
  ["removeFromLibrary", "removed %d manga from the library"],
  ["createCategory", "created %d categories"],
  ["setCategories", "set categories on %d manga"],
  ["markRead", "marked %d chapters read"],
  ["markUnread", "marked %d chapters unread"],
  ["addBookmark", "bookmarked %d chapters"],
  ["removeBookmark", "removed %d bookmarks"],
  ["setLastPage", "set the last page read on %d chapters"],
  ["bindTrack", "bound %d tracks"],
  ["updateTrack", "updated %d tracks"],
  ["unbindTrack", "unbound %d tracks"]
]

var CHANGE_TEXT = {
  removedFromLibrary: "removed from the library",
  categoriesCleared: "taken out of every category",
  markedUnread: "marked unread",
  bookmarkRemoved: "bookmark removed",
  pageLowered: "last page read lowered",
  trackRemoved: "track removed",
  trackLowered: "chapters read lowered",
  trackChanged: "status, score, dates or entry changed"
}

function basename(path) {
  return String(path).replace(/^.*\//, "")
}

// sync.state: "idle" | "running" | "done" | "failed"
// done: changes (count lines), backup (the phone backup's file name, or ""),
// export (the file name written for the phone) and unreachable (rows of
// { manga, chapter, change } the user repeats in Mihon; chapter holds the
// tracker's name for a track).
// failed: message.
function initial() {
  return { state: "idle" }
}

// event.type:
//   "start"   the job started
//   "finish"  { text } the job's collected output
function reduce(s, event) {
  switch (event.type) {
    case "start":
      return { state: "running" }
    case "finish":
      return result(Setup.parseJob(event.text))
  }
  return s
}

function result(job) {
  if (job.code === NOT_BUILT) return { state: "failed", message: "The sync helper is not built. Build it in the window: press : and choose Setup." }
  var lines = job.output.split("\n")
  var summary = null
  // JVM warnings may come before the one JSON line.
  if (job.code === 0) try { summary = JSON.parse(lines[lines.length - 1]) } catch (e) { summary = null }
  if (!summary) return { state: "failed", message: job.output || "The sync helper stopped with status " + job.code + "." }
  var changes = COUNTS.map(function(c) {
    var n = summary.changes.filter(function(ch) { return ch.type === c[0] }).length
    return n ? c[1].replace("%d", n) : ""
  }).filter(function(l) { return l })
  return {
    state: "done",
    backup: summary.backup ? basename(summary.backup) : "",
    changes: changes,
    export: basename(summary.export),
    unreachable: summary.unreachable.map(function(u) {
      return { manga: u.manga, chapter: u.chapter || u.tracker || "", change: CHANGE_TEXT[u.change] || u.change }
    })
  }
}

// The lines the window shows for a done sync, above the unreachable list.
// The window's font is monospace, so spaces indent.
function report(s) {
  var lines = [s.backup ? "Merged the phone backup " + s.backup + ":" : "No phone backup in the sync folder yet."]
  if (s.backup) lines = lines.concat((s.changes.length ? s.changes : ["no changes"]).map(function(l) { return "  " + l }))
  lines.push("Wrote " + s.export + ". Restore it in Mihon to bring the desktop's changes to the phone.")
  if (s.unreachable.length) lines.push("A restore in Mihon cannot apply these. Repeat them on the phone:")
  return lines
}

// The popup's one line.
function oneLine(s) {
  switch (s.state) {
    case "running": return "Syncing"
    case "failed": return s.message
    case "done":
      var u = s.unreachable.length
      return "Synced. Restore the newest miharchy backup in Mihon." + (u ? " " + u + " change" + (u === 1 ? "" : "s") + " to repeat on the phone; s in the window lists them." : "")
  }
  return ""
}

if (typeof module !== "undefined") {
  module.exports = {
    DEV_HELPER: DEV_HELPER,
    HELPER_DIR: HELPER_DIR,
    NOT_BUILT: NOT_BUILT,
    command: command,
    initial: initial,
    reduce: reduce,
    report: report,
    oneLine: oneLine
  }
}
