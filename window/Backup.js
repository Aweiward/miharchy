.pragma library
.import "Sync.js" as Sync

// Create a backup: the job on miharchy-core and what its result says. Pure,
// so tests/backup.test.js pins it; SettingsView.qml sends PAYLOAD and shows
// note() on the "Create a backup" row.

// Core takes its own backup folder and parts rows, so the payload names
// neither.
var PAYLOAD = { route: "backup.export", body: {} }

// backup.state: "idle" | "running" | "done" (file) | "failed" (message)
function initial() {
  return { state: "idle" }
}

// event.type: "start", or "reply" { reply }: core's answer to PAYLOAD, as
// Session.send gives it.
function reduce(b, event) {
  switch (event.type) {
    case "start":
      return { state: "running" }
    case "reply":
      return event.reply.state === "ok" ? { state: "done", file: event.reply.data.file } : { state: "failed", message: Sync.coreMessage(event.reply) }
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
    PAYLOAD: PAYLOAD,
    initial: initial,
    reduce: reduce,
    note: note
  }
}
