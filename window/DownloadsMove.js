.pragma library

// Settings' "Download folder" row while core moves the downloads (#429).
// Core's download.queue status carries `move`: null before any move, else
// { state: "moving" | "done" | "failed", done, total, from, to, error, startedAt }.
// Pure, so tests/downloadsmove.test.js pins it.

var POLL_MS = 1000
var PAYLOAD = { route: "download.queue", body: {} }

// The move a save at `sentAt` (ms) started, from a download.queue reply; null
// when the reply failed, no move has run, or the move is an earlier one: a
// save that only stores the folder starts none.
function moveOf(reply, sentAt) {
  var move = reply && reply.state === "ok" && reply.data ? reply.data.move : null
  return move && typeof move === "object" && move.startedAt >= sentAt ? move : null
}

// Ask again while core copies.
function polling(move) {
  return !!move && move.state === "moving"
}

// The row's note, "" for none.
function note(move) {
  if (!move) return ""
  if (move.state === "moving") return move.total > 0 ? "Moving downloads: " + move.done + " of " + move.total + " files" : "Moving downloads"
  if (move.state === "failed") return "Downloads not moved: " + (move.error || "core gave no reason")
  return "Downloads moved to " + move.to + "."
}

// Core stored the new folder when the move ended, so Settings loads again.
function reload(prev, next) {
  return !!next && next.state === "done" && !(prev && prev.state === "done")
}

if (typeof module !== "undefined") {
  module.exports = { POLL_MS: POLL_MS, PAYLOAD: PAYLOAD, moveOf: moveOf, polling: polling, note: note, reload: reload }
}
