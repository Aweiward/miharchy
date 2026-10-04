.pragma library
.import "../window/Model.js" as Model
.import "../window/Updates.js" as Updates

// The mark and its popup: the unread update count, a dot when the updates
// cannot be reached, and the newest updates. Pure, so tests/mark.test.js pins
// it; Mark.qml polls the window's UPDATES_QUERY and feeds replies here.

// The popup lists this many; the window shows the rest.
var LIMIT = 10

// mark.state: "loading" | "ok" | "no-config" | "down" | "unauthorized" | "error"
// count: every unread update; rows: the newest LIMIT of them, as
// Updates.rows. A failure clears both, so a dead server shows no stale count.
function initial() {
  return { state: "loading", message: "", count: 0, rows: [] }
}

function listPayload() {
  return Updates.listPayload()
}

// event.type:
//   "config-missing"  server.json is absent or unreadable
//   "reply"           { reply, config, now } for listPayload()
function reduce(mark, event) {
  switch (event.type) {
    case "config-missing":
      return { state: "no-config", message: "", count: 0, rows: [] }
    case "reply":
      var r = event.reply
      if (r.state !== "ok") return { state: r.state, message: r.message, count: 0, rows: [] }
      var rows = Updates.rows(r.data, event.config, event.now)
      return { state: "ok", message: "", count: rows.length, rows: rows.slice(0, LIMIT) }
  }
  return mark
}

// The count beside the mark: nothing when zero.
function label(mark) {
  return mark.state === "ok" && mark.count ? String(mark.count) : ""
}

function down(mark) {
  return mark.state !== "ok" && mark.state !== "loading"
}

function tooltip(mark) {
  if (down(mark)) return "Miharchy: " + Model.problem(mark, "").title
  if (mark.state === "loading") return "Miharchy"
  return "Miharchy: " + (mark.count ? mark.count + " new chapter" + (mark.count === 1 ? "" : "s") : "no new chapters")
}

// { title, detail } in place of the popup's list, or null.
function notice(mark, configPath) {
  if (mark.state === "ok" && !mark.rows.length) return { title: "No new chapters", detail: "" }
  return Updates.notice(mark, configPath)
}

if (typeof module !== "undefined") {
  module.exports = {
    LIMIT: LIMIT,
    initial: initial,
    listPayload: listPayload,
    reduce: reduce,
    label: label,
    down: down,
    tooltip: tooltip,
    notice: notice
  }
}
