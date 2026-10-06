.pragma library
.import "../window/Model.js" as Model
.import "../window/Session.js" as Session
.import "../window/Updates.js" as Updates

// The mark and its popup: the unread update count, a dot when the updates
// cannot be reached, and the newest updates. Pure, so tests/mark.test.js pins
// it; Mark.qml polls the window's UPDATES_QUERY and feeds replies here.

// The popup lists this many; the window shows the rest.
var LIMIT = 10

// The Settings row "Notify about new chapters", in global meta.
var NOTIFY_KEY = "miharchy.notifyNewChapters"

// mark.state: "loading" | "ok" | "no-config" | "down" | "unauthorized" | "error"
// count: every unread update; rows: the newest LIMIT of them, as
// Updates.rows. A failure clears both, so a dead server shows no stale count.
// top: the highest update chapter id seen, null before the first answer;
// fresh: the updates above the top before this answer, which the
// notification names; notify: the Settings row; version: aboutServer's.
function initial() {
  return { state: "loading", message: "", count: 0, rows: [], top: null, fresh: [], notify: true, version: "" }
}

// One poll: the window's updates, the notification setting and the server's
// version.
function listPayload() {
  return { query: Updates.listPayload().query.replace(/\}\s*$/, "notify: metas(condition: { key: \"" + NOTIFY_KEY + "\" }) { nodes { value } } aboutServer { version } }") }
}

// A chapter is new when its id is above every update seen before:
// Suwayomi numbers chapters as it fetches them, so a chapter marked unread
// again, or one that left Updates when read, never counts twice. The first
// answer only sets the top, so a start never floods.
function reduce(mark, event) {
  switch (event.type) {
    case "config-missing":
      return { state: "no-config", message: "", count: 0, rows: [], top: null, fresh: [], notify: mark.notify, version: "" }
    case "reply":
      var r = event.reply
      if (r.state !== "ok") return { state: r.state, message: r.message, count: 0, rows: [], top: mark.top, fresh: [], notify: mark.notify, version: "" }
      var rows = Updates.rows(r.data, event.config, event.now)
      var top = rows.reduce(function(t, row) { return Math.max(t, row.id) }, mark.top || 0)
      var fresh = mark.top === null ? [] : rows.filter(function(row) { return row.id > mark.top })
      var setting = (r.data.notify && r.data.notify.nodes[0]) || null
      var version = (r.data.aboutServer && r.data.aboutServer.version) || ""
      return { state: "ok", message: "", count: rows.length, rows: rows.slice(0, LIMIT), top: top, fresh: fresh, notify: !setting || setting.value !== "false", version: version }
  }
  return mark
}

// The desktop notification due after this answer, or null: Mihon's
// LibraryUpdateNotifier, one notification naming the manga.
// key: the newest chapter's id, so the bars on several monitors send it once.
function notification(mark) {
  if (!mark.notify || !mark.fresh.length) return null
  var titles = []
  mark.fresh.forEach(function(row) { if (titles.indexOf(row.title) === -1) titles.push(row.title) })
  var shown = titles.slice(0, 5).join("\n") + (titles.length > 5 ? "\nand " + (titles.length - 5) + " more" : "")
  var n = mark.fresh.length
  return {
    key: String(mark.fresh.reduce(function(t, row) { return Math.max(t, row.id) }, 0)),
    title: n === 1 ? "1 new chapter" : n + " new chapters",
    body: shown
  }
}

// The first bar to create the marker sends it; the others find it and stop.
// Clicking it opens Updates in the window. Markers older than a day go.
var NOTIFY_SCRIPT = "dir=\"${XDG_RUNTIME_DIR:-/tmp}/miharchy\"\n"
  + "mkdir -p \"$dir\" && (set -C; : > \"$dir/notified-$1\") 2>/dev/null || exit 0\n"
  + "find \"$dir\" -maxdepth 1 -name 'notified-*' -mmin +1440 -delete 2>/dev/null\n"
  + "[ \"$(notify-send -a Miharchy -i \"$5\" -A default=Open -- \"$2\" \"$3\")\" = default ] && exec sh \"$4\" open-updates\n"
  + "exit 0"

// launcher: window/miharchy; icon: icons/miharchy.svg.
function notifyCommand(n, launcher, icon) {
  return ["sh", "-c", NOTIFY_SCRIPT, "sh", n.key, n.title, n.body, launcher, icon]
}

// The count beside the mark: nothing when zero.
function label(mark) {
  return mark.state === "ok" && mark.count ? String(mark.count) : ""
}

function down(mark) {
  return mark.state !== "ok" && mark.state !== "loading"
}

// The newer-server warning (Session.versionWarning), or "". It sits beside
// the count and the list; it never makes the mark look down.
function warning(mark) {
  return mark.state === "ok" ? Session.versionWarning(mark.version) : ""
}

function tooltip(mark) {
  if (down(mark)) return "Miharchy: " + Model.problem(mark, "").title
  if (mark.state === "loading") return "Miharchy"
  var text = "Miharchy: " + (mark.count ? mark.count + " new chapter" + (mark.count === 1 ? "" : "s") : "no new chapters")
  return warning(mark) ? text + "\n" + warning(mark) : text
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
    notification: notification,
    notifyCommand: notifyCommand,
    label: label,
    down: down,
    warning: warning,
    tooltip: tooltip,
    notice: notice
  }
}
