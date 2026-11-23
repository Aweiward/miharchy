.pragma library
.import "Sync.js" as Sync

// Restore a backup: the steps of Mihon's RestoreBackupScreen, run through
// miharchy-core's backup.check and backup.import. Pure, so
// tests/restore.test.js pins it; RestoreView.qml sends the payloads built
// here and feeds the replies back.
//
// restore.step:
//   "path"      the user types the backup file's path
//   "checking"  core reads what the backup needs
//   "confirm"   missingSources and missingTrackers (names) wait for Enter
//   "running"   core restores in one transaction, so there is no progress
//   "done"
//   "failed"    message
// path is the file being restored, kept so a second restore starts there.

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

// event.type:
//   "open"     { folder, path } the panel opens on path, else on the last
//              path, else in the sync folder
//   "check"    { text, home } the user entered a path; one that is not
//              absolute stays in "path" with error
//   "check-presync"   core's undo: core names the file in its check reply
//   "checked-reply"   { reply } core's backup.check, as Session.send gives it
//   "start"           the user confirmed
//   "finish-reply"    { reply } core's backup.import
function reduce(s, event) {
  switch (event.type) {
    case "open":
      if (s.step === "checking" || s.step === "running") return s
      return { step: "path", path: event.path || s.path || (event.folder ? event.folder + "/" : "") }
    case "check-presync":
      // Core's undo: core names the file before the last sync in its check reply.
      return { step: "checking", path: "", preSync: true }
    case "check":
      var path = resolvePath(event.text, event.home)
      if (!path) return { step: "path", path: event.text, error: "Enter an absolute path, such as ~/Sync/Mihon/backup.tachibk." }
      return { step: "checking", path: path }
    case "checked-reply":
      if (event.reply.state !== "ok") return copy(s, { step: "failed", message: Sync.coreMessage(event.reply) })
      var d = event.reply.data
      return copy(s, { step: "confirm", path: d.file, preSync: false, missingSources: d.missingSources, missingTrackers: d.missingTrackers })
    case "finish-reply":
      return event.reply.state === "ok" ? copy(s, { step: "done" }) : copy(s, { step: "failed", message: Sync.coreMessage(event.reply) })
    case "start":
      return copy(s, { step: "running" })
  }
  return s
}

// Core's check of s (the path, or the file before the last sync), then its restore.
function checkPayload(s) {
  return { route: "backup.check", body: s.preSync ? { preSync: true } : { file: s.path } }
}

function importPayload(s) {
  return { route: "backup.import", body: { file: s.path } }
}

// The lines the panel shows for the current step.
function lines(s) {
  switch (s.step) {
    case "path":
      return [s.error || "Enter the path of a Mihon or Miharchy backup (.tachibk)."]
    case "checking":
      return [s.preSync ? "Reading the library from before the last sync." : "Reading " + s.path + "."]
    case "confirm":
      var l = ["Data from " + s.path + " will be restored: manga, chapters, categories, history and tracks."]
      if (s.missingSources.length) l = l.concat(["", "Missing sources:"], s.missingSources.map(function(n) { return "- " + n }))
      if (s.missingTrackers.length) l = l.concat(["", "Trackers not logged in:"], s.missingTrackers.map(function(n) { return "- " + n }))
      if (s.missingSources.length || s.missingTrackers.length) l = l.concat(["", "Install the missing extensions and log in to the trackers afterwards to use them."])
      return l
    case "running":
      return ["Restoring " + s.path + "."]
    case "done":
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
    checkPayload: checkPayload,
    importPayload: importPayload,
    lines: lines,
    hint: hint
  }
}
