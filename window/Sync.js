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
// a lock, so the window and the popup start it the same way. apply runs a
// sync the helper held.
function command(devHelper, apply) {
  return helperCommand(devHelper, ["sync", "--json"].concat(apply ? ["--apply"] : []))
}

// The desktop baseline before the last sync, under $HOME; restoring it
// undoes that sync.
var PRE_SYNC = ".local/share/miharchy/sync/pre-sync.tachibk"

// The helper run with args, which reach it as arguments, never as shell text.
function helperCommand(devHelper, args) {
  return Setup.command("for h in \"$HOME/" + HELPER_DIR + "/bin/miharchy-sync\" \"$1\"; do test -x \"$h\" && shift && exec \"$h\" \"$@\"; done\nexit " + NOT_BUILT, [devHelper].concat(args))
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
  ["unbindTrack", "unbound %d tracks"],
  ["setNotes", "set notes on %d manga"]
]

var CHANGE_TEXT = {
  addedToLibrary: "added to the library",
  categoriesChanged: "categories changed",
  markedRead: "marked read",
  bookmarked: "bookmarked",
  pageRaised: "last page read raised",
  trackBound: "track added",
  trackRaised: "chapters read raised",
  removedFromLibrary: "removed from the library",
  categoriesCleared: "taken out of every category",
  markedUnread: "marked unread",
  bookmarkRemoved: "bookmark removed",
  pageLowered: "last page read lowered",
  trackRemoved: "track removed",
  trackLowered: "chapters read lowered",
  trackChanged: "status, score, dates or entry changed",
  notesChanged: "notes changed"
}

function basename(path) {
  return String(path).replace(/^.*\//, "")
}

// sync.state: "idle" | "running" | "held" | "done" | "failed"
// held: backup and changes, as for done. The helper stopped before it
// changed anything, because the changes look like a lost phone backup.
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
//   "apply"   the user applies a held sync
function reduce(s, event) {
  switch (event.type) {
    case "start":
      return { state: "running" }
    case "apply":
      return s.state === "held" ? { state: "running", apply: true } : s
    case "finish":
      return result(Setup.parseJob(event.text))
  }
  return s
}

// The helper's one JSON line, or the failure to show instead.
function reply(job) {
  if (job.code === NOT_BUILT) return { message: "The sync helper is not built. Build it in the window: press : and choose Setup." }
  var lines = job.output.split("\n")
  var value = null
  // JVM warnings may come before the one JSON line.
  if (job.code === 0) try { value = JSON.parse(lines[lines.length - 1]) } catch (e) { value = null }
  return value ? { value: value } : { message: job.output || "The sync helper stopped with status " + job.code + "." }
}

function result(job) {
  var r = reply(job)
  if (!r.value) return { state: "failed", message: r.message }
  var summary = r.value
  var changes = COUNTS.map(function(c) {
    var n = summary.changes.filter(function(ch) { return ch.type === c[0] }).length
    return n ? c[1].replace("%d", n) : ""
  }).filter(function(l) { return l })
  if (summary.held) return { state: "held", backup: basename(summary.backup), changes: changes }
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

// The lines the window shows for a held or done sync, above the
// unreachable list. The window's font is monospace, so spaces indent.
function report(s) {
  if (s.state === "held") return ["The phone backup " + s.backup + " would change much, so the sync stopped before it changed anything:"]
    .concat(s.changes.map(function(l) { return "  " + l }), ["y applies it. Esc keeps the library as it is."])
  var lines = [s.backup ? "Merged the phone backup " + s.backup + ":" : "No phone backup in the sync folder yet."]
  if (s.backup) lines = lines.concat((s.changes.length ? s.changes : ["no changes"]).map(function(l) { return "  " + l }))
  lines.push("Wrote " + s.export + ". Restore it in Mihon to bring the desktop's changes to the phone.")
  if (s.unreachable.length) lines.push("A restore in Mihon cannot apply these. Repeat them on the phone:")
  return lines
}

// Sync health (`miharchy-sync health`): { state: "idle" | "ready" | "failed" },
// with health, the helper's object, when ready, and message when failed.
function healthCommand(devHelper) {
  return helperCommand(devHelper, ["health"])
}

function parseHealth(text) {
  var r = reply(Setup.parseJob(text))
  return r.value ? { state: "ready", health: r.value } : { state: "failed", message: r.message }
}

var MINUTE = 60000
var HOUR = 60 * MINUTE
var DAY = 24 * HOUR

function ago(ms) {
  if (ms < HOUR) return Math.max(0, Math.round(ms / MINUTE)) + " min ago"
  if (ms < 2 * DAY) return Math.round(ms / HOUR) + " h ago"
  return Math.floor(ms / DAY) + " days ago"
}

// The Settings row's value: the phone's side of the sync in one line, short
// enough for the row (healthLines explains more).
function healthSummary(h, now) {
  if (!h.phoneBackup) return "No phone backup in the sync folder yet."
  var parts = ["Phone backup " + ago(now - Date.parse(h.phoneBackupAt))]
  if (h.restored) parts.push("restored " + (h.desktopBackup && h.restored === basename(h.desktopBackup) ? "the newest" : "an older") + " backup")
  else parts.push(h.markerMissing ? "app settings off" : "no restore yet")
  var counts = []
  if (h.restorable.length) counts.push(h.restorable.length + " to restore")
  if (h.byHand.length) counts.push(h.byHand.length + " by hand")
  if (counts.length) parts.push((h.behind ? "behind: " : "") + counts.join(", "))
  return parts.join(" · ")
}

// A phone that wrote no backup for this long has stopped backing up, or the share stopped.
var QUIET_DAYS = 3

// The popup's sync health line: empty while all is well.
function healthPopupLine(h, now) {
  if (!h.phoneBackup) return ""
  var quiet = now - Date.parse(h.phoneBackupAt)
  if (quiet > QUIET_DAYS * DAY) return "No phone backup for " + Math.floor(quiet / DAY) + " days. Check Mihon's automatic backups and the folder share."
  return h.behind ? "Phone is behind: restore the newest miharchy backup in Mihon." : ""
}

// What Enter on the sync health row shows: each list under what to do about it.
function healthLines(h) {
  function rows(list, urgent) {
    return list.map(function(u) {
      var detail = u.chapter || u.tracker
      return { text: "  " + u.manga + (detail ? ", " + detail : "") + ": " + (CHANGE_TEXT[u.change] || u.change), urgent: urgent }
    })
  }
  var lines = h.markerMissing ? [{ text: "Mihon's backups leave out app settings, so Miharchy cannot see restores. Turn on App settings in Mihon's backup options.", urgent: false }] : []
  var intro = lines.length
  if (h.restorable.length) lines = lines.concat([{ text: "In Mihon, restore " + basename(h.desktopBackup) + ". It brings:", urgent: false }], rows(h.restorable, false))
  if (h.byHand.length) lines = lines.concat([{ text: "A restore cannot apply these. Repeat them in Mihon:", urgent: false }], rows(h.byHand, true))
  return lines.length > intro ? lines : lines.concat([{ text: "Nothing to do on the phone.", urgent: false }])
}

// The popup's one line.
function oneLine(s) {
  switch (s.state) {
    case "running": return "Syncing"
    case "held": return "Sync held: it would remove much. Press s in the window to review it."
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
    PRE_SYNC: PRE_SYNC,
    command: command,
    healthCommand: healthCommand,
    parseHealth: parseHealth,
    healthSummary: healthSummary,
    healthPopupLine: healthPopupLine,
    healthLines: healthLines,
    helperCommand: helperCommand,
    initial: initial,
    reduce: reduce,
    report: report,
    oneLine: oneLine
  }
}
