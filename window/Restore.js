.pragma library
.import "Setup.js" as Setup
.import "Sync.js" as Sync

// Restore a backup: the steps of Mihon's RestoreBackupScreen, run through
// the sync helper's check and restore. Pure, so tests/restore.test.js pins
// it; RestoreView.qml runs the commands built here and feeds output back.
//
// restore.step:
//   "path"      the user types the backup file's path
//   "checking"  the helper asks the server what the backup needs
//   "confirm"   missingSources and missingTrackers (names) wait for Enter
//   "running"   progress: { state, mangaProgress, totalManga } or null
//   "done"      progress holds the last step the server reported
//   "failed"    message
// path is the file being restored, kept so a second restore starts there.

// Suwayomi's BackupRestoreState values, in Mihon's words.
var STATES = {
  IDLE: "Starting",
  RESTORING_CATEGORIES: "Restoring categories",
  RESTORING_MANGA: "Restoring manga",
  RESTORING_META: "Restoring manga settings",
  RESTORING_SETTINGS: "Restoring settings"
}

function initial() {
  return { step: "path", path: "" }
}

function copy(s, changes) {
  var c = {}
  for (var k in s) c[k] = s[k]
  for (var j in changes) c[j] = changes[j]
  return c
}

// "~/x" -> home + "/x"; null for a path that is not absolute.
function resolvePath(text, home) {
  var t = String(text).trim().replace(/^~(?=\/|$)/, home)
  return t.charAt(0) === "/" ? t : null
}

// The helper's last JSON line, or null. JVM warnings may come first.
function lastJson(output) {
  var lines = output.split("\n")
  try { return JSON.parse(lines[lines.length - 1]) } catch (e) { return null }
}

function failed(job) {
  if (job.code === Sync.NOT_BUILT) return "The sync helper is not built. Build it in the window: press : and choose Setup."
  // Progress lines came before the failure; the message is what is left.
  var message = job.output.split("\n").filter(function(l) { return l.charAt(0) !== "{" }).join("\n").trim()
  return message || "The sync helper stopped with status " + job.code + "."
}

// event.type:
//   "open"     { folder, path } the panel opens on path, else on the last
//              path, else in the sync folder
//   "check"    { text, home } the user entered a path; one that is not
//              absolute stays in "path" with error
//   "checked"  { text } the check job's collected output
//   "start"    the user confirmed
//   "line"     { text } one line the restore printed
//   "finish"   { text } the restore job's collected output
function reduce(s, event) {
  switch (event.type) {
    case "open":
      if (s.step === "checking" || s.step === "running") return s
      return { step: "path", path: event.path || s.path || (event.folder ? event.folder + "/" : "") }
    case "check":
      var path = resolvePath(event.text, event.home)
      if (!path) return { step: "path", path: event.text, error: "Enter an absolute path, such as ~/Sync/Mihon/backup.tachibk." }
      return { step: "checking", path: path }
    case "checked":
      var job = Setup.parseJob(event.text)
      var check = job.code === 0 ? lastJson(job.output) : null
      if (!check) return copy(s, { step: "failed", message: failed(job) })
      return copy(s, { step: "confirm", missingSources: check.missingSources, missingTrackers: check.missingTrackers })
    case "start":
      return copy(s, { step: "running", progress: null })
    case "line":
      var p = null
      try { p = JSON.parse(event.text) } catch (e) { p = null }
      return p && p.state ? copy(s, { progress: p }) : s
    case "finish":
      var end = Setup.parseJob(event.text)
      var last = end.code === 0 ? lastJson(end.output) : null
      if (!last || last.state !== "SUCCESS") return copy(s, { step: "failed", message: failed(end) })
      return copy(s, { step: "done", progress: last })
  }
  return s
}

function command(devHelper, sub, path) {
  return Sync.helperCommand(devHelper, [sub, path])
}

// The lines the panel shows for the current step.
function lines(s) {
  switch (s.step) {
    case "path":
      return [s.error || "Enter the path of a Mihon or Miharchy backup (.tachibk)."]
    case "checking":
      return ["Reading " + s.path + "."]
    case "confirm":
      var l = ["Data from " + s.path + " will be restored: manga, chapters, categories, history and tracks."]
      if (s.missingSources.length) l = l.concat(["", "Missing sources:"], s.missingSources.map(function(n) { return "- " + n }))
      if (s.missingTrackers.length) l = l.concat(["", "Trackers not logged in:"], s.missingTrackers.map(function(n) { return "- " + n }))
      if (s.missingSources.length || s.missingTrackers.length) l = l.concat(["", "Install the missing extensions and log in to the trackers afterwards to use them."])
      return l
    case "running":
      var p = s.progress
      if (!p) return ["Restoring " + s.path + "."]
      return [(STATES[p.state] || p.state) + (p.totalManga ? ": " + p.mangaProgress + " of " + p.totalManga + " manga" : "") + "."]
    case "done":
      // No count: Suwayomi's final status resets it to 0, and its running
      // count includes steps that are not manga.
      return ["Restored " + s.path + "."]
    case "failed":
      return [s.message]
  }
  return []
}

function hint(s) {
  switch (s.step) {
    case "path": return "enter check   esc close"
    case "confirm": return "enter restore   esc cancel"
    case "checking":
    case "running": return "esc hide (the restore goes on)"
  }
  return "esc close"
}

if (typeof module !== "undefined") {
  module.exports = {
    initial: initial,
    reduce: reduce,
    command: command,
    lines: lines,
    hint: hint
  }
}
