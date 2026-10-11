.pragma library
.import "Setup.js" as Setup
.import "Sync.js" as Sync
.import "Capped.js" as Capped

// Create a backup: the job that runs the sync helper's backup and what its
// result says. Pure, so tests/backup.test.js pins it; SettingsView.qml runs
// the command built here and shows note() on the "Create a backup" row.

// The backup folder row, or the server's own backups folder when it is
// blank, where Suwayomi writes its automatic backups. env: as Storage.dirs.
function folder(backupPath, env) {
  return backupPath || (env.MIHARCHY_SERVER_ROOT || env.HOME + "/.local/share/miharchy/suwayomi") + "/backups"
}

// The helper prints one short JSON line, after any JVM warnings.
var CAP = 65536

function command(devHelper, dir) {
  return Capped.command(Sync.helperCommand(devHelper, ["backup", dir]), CAP, 600)
}

// backup.state: "idle" | "running" | "done" (file) | "failed" (message)
function initial() {
  return { state: "idle" }
}

// event.type: "start", or "finish" { text } with the job's collected output.
function reduce(b, event) {
  switch (event.type) {
    case "start":
      return { state: "running" }
    case "finish":
      var job = Setup.parseJob(event.text, CAP)
      if (job.code === Sync.NOT_BUILT) return { state: "failed", message: "The sync helper is not built. Build it in Setup." }
      var lines = job.output.split("\n")
      var result = null
      // JVM warnings may come before the one JSON line.
      if (job.code === 0) try { result = JSON.parse(lines[lines.length - 1]) } catch (e) { result = null }
      if (!result || !result.file) return { state: "failed", message: job.output.trim() || "The sync helper stopped with status " + job.code + "." }
      return { state: "done", file: result.file }
  }
  return b
}

function note(b) {
  switch (b.state) {
    case "running": return "writing"
    case "done": return "Wrote " + b.file
    case "failed": return b.message
  }
  return ""
}

if (typeof module !== "undefined") {
  module.exports = {
    folder: folder,
    command: command,
    initial: initial,
    reduce: reduce,
    note: note
  }
}
