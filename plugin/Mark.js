.pragma library
.import "../window/Model.js" as Model
.import "../window/Updates.js" as Updates
.import "../window/UpNext.js" as UpNext
.import "../window/Capped.js" as Capped

// The mark and its popup: the unread update count, a dot when the updates
// cannot be reached, and the newest updates. Pure, so tests/mark.test.js pins
// it; Mark.qml polls core through load() and feeds replies here.

// The popup lists this many; the window shows the rest.
var LIMIT = 10

// The Settings row "Notify about new chapters", in global meta.
var NOTIFY_KEY = "miharchy.notifyNewChapters"
// The Settings rows "Sync when a phone backup arrives" and "Sync folder".
var AUTO_SYNC_KEY = "miharchy.autoSync"
var SYNC_FOLDER_KEY = "miharchy.syncFolder"

// mark.state: "loading" | "ok" | "no-config" | "down" | "unauthorized" | "error"
// count: every unread update; rows: the newest LIMIT of them, as
// Updates.rows. A failure clears both, so a dead server shows no stale count.
// top: the highest update chapter id seen, null before the first answer;
// fresh: the updates above the top before this answer, which the
// notification names; notify, autoSync, syncFolder: the Settings rows.
function initial() {
  return { state: "loading", message: "", count: 0, rows: [], top: null, fresh: [], notify: true, autoSync: false, syncFolder: "" }
}

// One poll's reply: the window's updates and the notification and sync
// settings, from library.list, the library's recent unread chapters
// (chapter.list's unread and since, so no read chapter crosses the wire
// each minute) and one meta.get.
function load(send, core, now, done) {
  send({ route: "library.list" }, function(lib) {
    if (lib.state !== "ok") return done(lib)
    var ids = lib.data.mangas.map(function(m) { return m.id })
    var chapters = function(next) {
      if (!ids.length) return next({ state: "ok", data: { chapters: [] } })
      send({ route: "chapter.list", body: { mangaIds: ids, unread: true, since: Updates.since(now) } }, next)
    }
    chapters(function(ch) {
      if (ch.state !== "ok") return done(ch)
      send({ route: "meta.get", body: { scope: "global", keys: [NOTIFY_KEY, AUTO_SYNC_KEY, SYNC_FOLDER_KEY] } }, function(meta) {
        if (meta.state !== "ok") return done(meta)
        var data = Updates.fromCore(lib.data, ch.data, {}, { metas: [] }, now)
        var value = function(key) { return meta.data.metas.filter(function(m) { return m.key === key }).map(function(m) { return { value: m.value } }) }
        data.notify = { nodes: value(NOTIFY_KEY) }
        data.autoSync = { nodes: value(AUTO_SYNC_KEY) }
        data.syncFolder = { nodes: value(SYNC_FOLDER_KEY) }
        done({ state: "ok", message: "", data: data, kind: "" })
      })
    })
  })
}

function metaValue(data, alias) {
  var node = data[alias] && data[alias].nodes[0]
  return node ? node.value : null
}

// A chapter is new when its id is above every update seen before:
// core numbers chapters as it fetches them, so a chapter marked unread
// again, or one that left Updates when read, never counts twice. The first
// answer only sets the top, so a start never floods.
function reduce(mark, event) {
  switch (event.type) {
    case "config-missing":
      return { state: "no-config", message: "", count: 0, rows: [], top: null, fresh: [], notify: mark.notify, autoSync: mark.autoSync, syncFolder: mark.syncFolder }
    case "reply":
      var r = event.reply
      if (r.state !== "ok") return { state: r.state, message: r.message, count: 0, rows: [], top: mark.top, fresh: [], notify: mark.notify, autoSync: mark.autoSync, syncFolder: mark.syncFolder }
      var rows = Updates.rows(r.data, event.config, event.now)
      var top = rows.reduce(function(t, row) { return Math.max(t, row.id) }, mark.top || 0)
      var fresh = mark.top === null ? [] : rows.filter(function(row) { return row.id > mark.top })
      return {
        state: "ok", message: "", count: rows.length, rows: rows.slice(0, LIMIT), top: top, fresh: fresh,
        notify: metaValue(r.data, "notify") !== "false",
        autoSync: metaValue(r.data, "autoSync") === "true", syncFolder: metaValue(r.data, "syncFolder") || ""
      }
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
    // The notification spec reads the body as markup; titles come from sources.
    body: shown.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  }
}

// The first bar to create the marker sends it; the others find it and stop.
// Clicking it opens Updates in the window. Markers older than a day go.
// No XDG_RUNTIME_DIR, or a folder that is not the user's own real directory
// (a symlink planted there), sends nothing: never a shared /tmp path.
var NOTIFY_SCRIPT = "[ -n \"$XDG_RUNTIME_DIR\" ] || exit 0\n"
  + "dir=\"$XDG_RUNTIME_DIR/miharchy\"\n"
  + "(umask 077; mkdir -p \"$dir\") 2>/dev/null\n"
  + "[ -d \"$dir\" ] && [ ! -L \"$dir\" ] && [ -O \"$dir\" ] || exit 0\n"
  + "(set -C; : > \"$dir/notified-$1\") 2>/dev/null || exit 0\n"
  + "find \"$dir\" -maxdepth 1 -name 'notified-*' -mmin +1440 -delete 2>/dev/null\n"
  + "[ \"$(notify-send -a Miharchy -i \"$5\" -A default=Open -- \"$2\" \"$3\")\" = default ] && exec sh \"$4\" open-updates\n"
  + "exit 0"

// launcher: window/miharchy; icon: icons/miharchy.svg.
function notifyCommand(n, launcher, icon) {
  return ["sh", "-c", NOTIFY_SCRIPT, "sh", n.key, n.title, n.body, launcher, icon]
}

// The newest phone backup in the sync folder newer than core's phone
// baseline, as "<mtime> <path>", or nothing. The miharchy-* files are the
// desktop's exports; a file younger than 30 s may still be arriving. With
// no baseline yet, any phone backup counts: the first sync.
var PHONE_CHECK_SCRIPT = "base=${2:-$HOME/.local/share/miharchy/sync/phone-baseline.tachibk}\n"
  + "dir=$1\n"
  + "set --\n"
  + "[ -e \"$base\" ] && set -- -newer \"$base\"\n"
  + "find \"$dir\" -maxdepth 1 -type f -name '*.tachibk' ! -name 'miharchy-*' -mmin +0.5 \"$@\" -printf '%T@ %p\\n' 2>/dev/null | sort -n | tail -n 1\n"
  + "exit 0"

// baseline: phoneBaseline()'s path.
function phoneCheckCommand(folder, baseline) {
  return Capped.command(["sh", "-c", PHONE_CHECK_SCRIPT, "sh", folder].concat(baseline ? [baseline] : []), FOUND_CAP, 30)
}

// Core's phone baseline, in its data folder. env: { HOME, MIHARCHY_CORE_DATA }.
function phoneBaseline(env, core) {
  return (env.MIHARCHY_CORE_DATA || env.HOME + "/.local/share/miharchy/core") + "/sync/phone-baseline.tachibk"
}

// The newest phone backup in the folder ("<mtime> <path>"), merged or not:
// when the answer changes, the mark asks core for sync health again.
function newestPhoneCommand(folder) {
  return Capped.command(["sh", "-c", "find \"$1\" -maxdepth 1 -type f -name '*.tachibk' ! -name 'miharchy-*' -printf '%T@ %p\\n' 2>/dev/null | sort -n | tail -n 1", "sh", folder], FOUND_CAP, 30)
}

// Either command's one line: an mtime and a path of at most PATH_MAX.
var FOUND_CAP = 8192

// That line, or "" when there is none or the output passed the cap.
function found(text) {
  return Capped.over(text, FOUND_CAP) ? "" : String(text).trim()
}

// The desktop notification for a sync the mark started on a new phone
// backup (Sync.reduce's state once the job ended), or null. key names the
// marker, as notification's does.
function syncNotification(sync, key) {
  switch (sync.state) {
    case "done":
      return sync.changes.length ? { key: key, title: "Synced from the phone", body: sync.changes.join("\n") } : null
    case "held":
      return { key: key, title: "Sync held", body: "The phone backup would remove much. Press s in the window to review it." }
    case "failed":
      // Another bar, or the window, got there first.
      if (sync.message === "A sync is already running.") return null
      return { key: key, title: "Sync failed", body: sync.message }
  }
  return null
}

// The count beside the mark: nothing when zero.
function label(mark) {
  return mark.state === "ok" && mark.count ? String(mark.count) : ""
}

function down(mark) {
  return mark.state !== "ok" && mark.state !== "loading"
}

// backend: "core", so a failure names miharchy-core.
function tooltip(mark, backend) {
  if (down(mark)) return "Miharchy: " + Model.problem(mark, "", backend).title
  if (mark.state === "loading") return "Miharchy"
  return "Miharchy: " + (mark.count ? mark.count + " new chapter" + (mark.count === 1 ? "" : "s") : "no new chapters")
}

// The popup's Up next section: this many manga, loaded only when it opens
// (the reply is large on a big library, and every bar polls).
var UP_NEXT_LIMIT = 3
// The Settings row "Downloaded only", which Up next follows.
var DOWNLOADED_ONLY_KEY = "miharchy.downloadedOnly"

// Up next's reply: UpNext.load's plus the Downloaded only meta.
function loadUpNext(send, core, done) {
  UpNext.load(send, true, function(r) {
    if (r.state !== "ok") return done(r)
    send({ route: "meta.get", body: { scope: "global", keys: [DOWNLOADED_ONLY_KEY] } }, function(meta) {
      if (meta.state !== "ok") return done(meta)
      r.data.metas.nodes = r.data.metas.nodes.concat(meta.data.metas)
      done(r)
    })
  })
}

// The reason beside an Up next row, by tier: the page reached, the unread
// left, or the age of the newest update.
function reason(e, now) {
  if (e.tier === 1) return "p. " + (e.page + 1) + (e.pages ? " / " + e.pages : "")
  if (e.tier === 2) return e.unread + " left"
  var hours = Math.max(1, Math.floor((now / 1000 - e.update) / 3600))
  return "new " + (hours < 24 ? hours + "h" : Math.floor(hours / 24) + "d")
}

// reply: loadUpNext()'s, null while it loads. -> the section's rows;
// none while loading or after a failure, so the section hides. core: the
// rows name core's ids, so the window opens them there (target()).
function upNext(reply, now, core) {
  if (!reply || reply.state !== "ok") return []
  var metas = (reply.data.metas && reply.data.metas.nodes) || []
  var downloadedOnly = metas.some(function(m) { return m.key === DOWNLOADED_ONLY_KEY && m.value === "true" })
  return UpNext.list(reply.data, downloadedOnly, now).slice(0, UP_NEXT_LIMIT).map(function(e) {
    return { title: e.title, chapter: e.chapter, side: reason(e, now), open: target("peek-open", e.mangaId, e.chapterId, core) }
  })
}

// The popup's rows under one cursor: Up next, then the updates. section
// heads the first row of each when Up next shows; without it the popup
// looks as it did before Up next. open: the launcher's arguments.
function entries(upNext, rows, core) {
  var updates = rows.map(function(row) {
    return { section: "", title: row.title, chapter: row.chapter, side: row.date, open: target("open-chapter", row.mangaId, row.id, core) }
  })
  if (!upNext.length) return updates
  var up = upNext.map(function(e, i) { return Object.assign({ section: i === 0 ? "Up next" : "" }, e) })
  if (updates.length) updates[0].section = "Updates"
  return up.concat(updates)
}

// The launcher's arguments for a row, with a trailing "core": a window
// started before #373 still reads it.
function target(command, mangaId, chapterId) {
  return [command, String(mangaId), String(chapterId), "core"]
}

function move(list, cursor, dy) {
  return Math.max(0, Math.min(list.length - 1, cursor + dy))
}

// The cursor after the popup's rows change (Up next landing, a poll): on
// the same row in after, so Enter opens what the user chose. The top row
// stays the top row, the head of Up next once it shows. A row that left
// gives the nearest one.
function follow(before, after, cursor) {
  var was = cursor > 0 && before[cursor] ? before[cursor].open.join(" ") : null
  for (var i = 0; was !== null && i < after.length; i++) if (after[i].open.join(" ") === was) return i
  return move(after, cursor, 0)
}

// { title, detail } in place of the popup's list, or null.
function notice(mark, configPath, backend) {
  if (mark.state === "ok" && !mark.rows.length) return { title: "No new chapters", detail: "" }
  return Updates.notice(mark, configPath, backend)
}

if (typeof module !== "undefined") {
  module.exports = {
    LIMIT: LIMIT,
    AUTO_SYNC_KEY: AUTO_SYNC_KEY,
    SYNC_FOLDER_KEY: SYNC_FOLDER_KEY,
    initial: initial,
    load: load,
    loadUpNext: loadUpNext,
    phoneBaseline: phoneBaseline,
    reduce: reduce,
    notification: notification,
    notifyCommand: notifyCommand,
    phoneCheckCommand: phoneCheckCommand,
    newestPhoneCommand: newestPhoneCommand,
    found: found,
    syncNotification: syncNotification,
    label: label,
    down: down,
    tooltip: tooltip,
    upNext: upNext,
    entries: entries,
    move: move,
    follow: follow,
    notice: notice
  }
}
