.pragma library
.import "Prefs.js" as Prefs

// The Settings view's rows and state. Pure, so tests/settings.test.js pins
// it; shell.qml sends the payloads built here and feeds replies back.
//
// A row: { key, label, type: "bool" | "choice" | "text" | "folder" | "category", default, store }.
//   store "server": a Suwayomi server setting named key (settings/setSettings).
//   store "meta":   a Miharchy preference in Suwayomi global meta under
//                   META_PREFIX + key, stored as a string.
//   choice rows add options: [{ value, label }]; text rows add pattern and
//   hint for validation, and may add blank, the text an empty value shows;
//   a folder row is a text row that takes an absolute path or ~ (see
//   commitFolder) and saves only once the folder exists;
//   bool rows may add whenOn, extra server settings sent along when the
//   row turns on; any server row may add with, extra server settings sent
//   along with every save; a category row's options are the user's
//   categories, so activate() and display() take them.
//   A text or folder row may add notSameAs, the key of a folder row it
//   must differ from. Any row may add note, a line shown under it while
//   the cursor is on it.
// An action row { key, label, type: "action", command } stores nothing:
// Enter runs the command id, and the view shows its outcome as the value.
// A later setting is one more entry here.

var META_PREFIX = Prefs.PREFIX

var ROWS = [
  // Mihon's More screen toggles, also in the palette. The status bar and
  // the reader show them while on (modes()).
  { key: "downloadedOnly", label: "Downloaded only", type: "bool", default: false, store: "meta" },
  { key: "incognito", label: "Incognito mode", type: "bool", default: false, store: "meta" },
  { key: "showNsfw", label: "Show NSFW sources", type: "bool", default: false, store: "meta" },
  {
    key: "defaultReadingMode", label: "Default reading mode", type: "choice", default: "paged-rtl", store: "meta",
    options: [
      { value: "paged-rtl", label: "Paged right-to-left" },
      { value: "paged-ltr", label: "Paged left-to-right" },
      { value: "paged-vertical", label: "Paged vertical" },
      { value: "webtoon", label: "Webtoon" },
      { value: "continuous-vertical", label: "Continuous vertical" }
    ]
  },
  // Mihon's image scale type, for paged reading; z in the reader cycles it.
  {
    key: "pageFit", label: "Page fit", type: "choice", default: "screen", store: "meta",
    options: [
      { value: "screen", label: "Fit screen" },
      { value: "width", label: "Fit width" },
      { value: "height", label: "Fit height" },
      { value: "original", label: "Original size" }
    ]
  },
  // Mihon's dual page view, for right to left and left to right: two
  // pages side by side, always or while the window is wider than tall.
  {
    key: "dualPageView", label: "Two-page spreads", type: "choice", default: "never", store: "meta",
    options: [
      { value: "never", label: "Never" },
      { value: "always", label: "Always" },
      { value: "wide", label: "When the window is wide" }
    ]
  },
  // Mihon's split double pages: a wide page reads as two, one half at a
  // time, outside spreads.
  { key: "dualPageSplit", label: "Split wide pages", type: "bool", default: false, store: "meta" },
  // Mihon's crop borders (GLOSSARY.md), one row for the paged modes (four
  // sides) and one for the strip (left and right).
  { key: "cropBordersPaged", label: "Crop borders (paged)", type: "bool", default: true, store: "meta" },
  { key: "cropBordersWebtoon", label: "Crop borders (webtoon)", type: "bool", default: false, store: "meta" },
  // GLOSSARY.md: a washed-out page stretched to black and white, every mode.
  { key: "autoLevels", label: "Auto levels", type: "bool", default: true, store: "meta" },
  // Mihon's webtoon side padding, the other way round: the strip's share
  // of the window width. + and - in the reader step it.
  {
    key: "webtoonWidth", label: "Webtoon width", type: "choice", default: "60", store: "meta",
    options: ["30", "40", "50", "60", "70", "80", "90", "100"].map(function(v) { return { value: v, label: v + "% of the window" } })
  },
  // Not in Mihon: a in the reader scrolls the strip or turns the pages at
  // this speed (Reader.AUTO_SPEEDS reads its options); + and - step it.
  {
    key: "autoScrollSpeed", label: "Auto-scroll speed", type: "choice", default: "1", store: "meta",
    options: ["0.5", "0.75", "1", "1.5", "2", "3"].map(function(v) { return { value: v, label: v + "x" } })
  },
  // Mihon's reader theme. Its automatic follows the phone's night mode;
  // here the Omarchy theme's background does that, and stays the default.
  {
    key: "readerTheme", label: "Reader background", type: "choice", default: "theme", store: "meta",
    options: [
      { value: "theme", label: "Theme" },
      { value: "black", label: "Black" },
      { value: "gray", label: "Gray" },
      { value: "white", label: "White" }
    ]
  },
  // Mihon's keep screen on, on by default here: hypridle would lock a page
  // read slowly.
  { key: "keepScreenOn", label: "Keep the screen on", type: "bool", default: true, store: "meta" },
  // Off, the transition page between chapters shows only past either end,
  // on a gap in the chapter numbers, or when the chapter cannot load.
  { key: "alwaysShowChapterTransition", label: "Always show chapter transition", type: "bool", default: true, store: "meta" },
  // Mihon's reader skips, applied as a chapter opens; the chapter opened
  // always stays.
  { key: "skipRead", label: "Skip read chapters", type: "bool", default: false, store: "meta" },
  { key: "skipFiltered", label: "Skip filtered chapters", type: "bool", default: true, store: "meta" },
  { key: "skipDupe", label: "Skip duplicate chapters", type: "bool", default: false, store: "meta" },
  // Not in Mihon: a peek stops at the transition page after this many
  // chapters of one manga in a row (Reader.caughtUp).
  {
    key: "catchUp", label: "Catch-up", type: "choice", default: "3", store: "meta",
    options: [{ value: "0", label: "Off" }].concat(["1", "2", "3", "5", "10"].map(function(v) { return { value: v, label: v === "1" ? "1 chapter" : v + " chapters" } }))
  },
  // Cloudflare sources fail without the response fallback even when
  // FlareSolverr solves the challenge (docs/spikes/extension-spike.md).
  { key: "flareSolverrEnabled", label: "FlareSolverr", type: "bool", default: false, store: "server", whenOn: { flareSolverrAsResponseFallback: true } },
  { key: "flareSolverrUrl", label: "FlareSolverr URL", type: "text", default: "http://127.0.0.1:8191", store: "server", pattern: /^https?:\/\/\S+$/, hint: "Enter a URL that starts with http:// or https://." },
  // Suwayomi's built-in Chromium, which some sources run part of their
  // site in. The server applies it without a restart.
  { key: "kcefEnabled", label: "Server WebView (KCEF)", type: "bool", default: true, store: "server", note: "Some sources need it. The first use downloads Chromium, about 250 MB." },
  // The server runs the library update on this schedule, in hours, so it
  // runs with the window closed. It takes 0 (off) or at least 6.
  {
    key: "globalUpdateInterval", label: "Check for new chapters", type: "choice", default: 12, store: "server",
    options: [
      { value: 0, label: "Off" },
      { value: 12, label: "Every 12 hours" },
      { value: 24, label: "Daily" },
      { value: 48, label: "Every 2 days" },
      { value: 72, label: "Every 3 days" },
      { value: 168, label: "Weekly" }
    ]
  },
  // Read by the bar mark (plugin/Mark.js), which sends the notification
  // when its poll finds chapters above the newest it saw.
  { key: "notifyNewChapters", label: "Notify about new chapters", type: "bool", default: true, store: "meta" },
  // The library update skips these manga while on, as Mihon does. On
  // means skip, the server's own sense, so a fresh library may skip all.
  { key: "excludeUnreadChapters", label: "Skip manga with unread chapters", type: "bool", default: true, store: "server" },
  { key: "excludeNotStarted", label: "Skip manga not started", type: "bool", default: true, store: "server" },
  { key: "excludeCompleted", label: "Skip completed manga", type: "bool", default: true, store: "server" },
  // Mihon's "Automatically refresh metadata": the library update also
  // fetches each manga's title, cover and description.
  { key: "updateMangas", label: "Refresh metadata during library updates", type: "bool", default: false, store: "server" },
  // The library check, with the count of its problems as the value.
  { key: "libraryCheck", label: "Library check", type: "action", command: "view.check" },
  // Mihon's default category for manga added to the library: "ask", "0"
  // (Default: no category) or a category id. The server's own default flag
  // applies only to its REST add, so the window applies this one.
  { key: "defaultCategory", label: "Default category", type: "category", default: "ask", store: "meta" },
  // The server refuses a folder that does not exist; empty means its own.
  { key: "downloadsPath", label: "Download folder", type: "text", default: "", store: "server", pattern: /^(\/.*)?$/, hint: "Enter an absolute path, or nothing for the server's own folder.", blank: "server default" },
  // New downloads only; the server reads chapters on disk in either form.
  { key: "downloadAsCbz", label: "Save downloads as CBZ", type: "bool", default: false, store: "server" },
  // The local source's folder (Mihon's local source): a folder per manga,
  // a folder of images or a .cbz per chapter. The server refuses a folder
  // that does not exist; empty means its root's local.
  { key: "localSourcePath", label: "Local manga folder", type: "text", default: "", store: "server", pattern: /^(\/.*)?$/, hint: "Enter an absolute path, or nothing for the server's own folder.", blank: "server default" },
  // Mihon's auto-download group, all server settings: the library update
  // queues the new chapters. d in Categories includes or excludes a
  // category. Skipping manga with unread chapters is Suwayomi's own; Mihon's
  // "Skip downloading duplicate read chapters" is closest to skipping
  // re-uploads.
  { key: "autoDownloadNewChapters", label: "Auto-download new chapters", type: "bool", default: false, store: "server" },
  { key: "excludeEntryWithUnreadChapters", label: "Auto-download only for manga with no unread chapters", type: "bool", default: true, store: "server" },
  { key: "autoDownloadIgnoreReUploads", label: "Auto-download skips re-uploaded chapters", type: "bool", default: false, store: "server" },
  // Mihon's download ahead while reading: opening a chapter queues the
  // next this many unread chapters (Reader.ahead).
  {
    key: "downloadAhead", label: "Download ahead while reading", type: "choice", default: "0", store: "meta",
    options: [
      { value: "0", label: "Off" },
      { value: "2", label: "Next 2 unread chapters" },
      { value: "3", label: "Next 3 unread chapters" },
      { value: "5", label: "Next 5 unread chapters" },
      { value: "10", label: "Next 10 unread chapters" }
    ]
  },
  // Mihon's delete group. Suwayomi has none, so the window deletes:
  // Downloads.autoDeletePayload holds the rules, and a category keeps its
  // downloads with p in Categories (Mihon's excluded categories).
  { key: "deleteAfterMarkRead", label: "Delete downloads marked read", type: "bool", default: false, store: "meta" },
  // The values "false" and "true" are those of the on/off row this was.
  {
    key: "deleteAfterRead", label: "Delete after reading", type: "choice", default: "false", store: "meta",
    options: [
      { value: "false", label: "Off" },
      { value: "true", label: "Last read chapter" },
      { value: "1", label: "Second to last read chapter" },
      { value: "2", label: "Third to last read chapter" },
      { value: "3", label: "Fourth to last read chapter" },
      { value: "4", label: "Fifth to last read chapter" }
    ]
  },
  { key: "deleteBookmarked", label: "Delete bookmarked chapters", type: "bool", default: false, store: "meta" },
  // Mihon's tracking group. The reader pushes after the save that first
  // marks a chapter read; a mark read from a list (R, P, Updates, Library)
  // pushes, asks first (only when a logged-in tracker is behind) or not.
  { key: "trackAfterReading", label: "Update trackers after reading", type: "bool", default: true, store: "meta" },
  {
    key: "trackOnMarkRead", label: "Update trackers when marking chapters read", type: "choice", default: "always", store: "meta",
    options: [
      { value: "always", label: "Always" },
      { value: "ask", label: "Ask" },
      { value: "never", label: "Never" }
    ]
  },
  // Where S in the reader saves a page, in a folder per manga; empty is
  // ~/Pictures/Miharchy.
  { key: "pageFolder", label: "Save pages to", type: "folder", default: "", store: "meta", blank: "~/Pictures/Miharchy" },
  // Setup sets it too; the sync helper reads it from the server.
  { key: "syncFolder", label: "Sync folder", type: "folder", default: "", store: "meta", blank: "not set", notSameAs: "backupPath" },
  // The bar mark reads it, and syncs when a new phone backup lands there.
  { key: "autoSync", label: "Sync when a phone backup arrives", type: "bool", default: false, store: "meta" },
  // Sync health: the phone's side, from the newest phone backup. Enter lists what to do in Mihon.
  { key: "syncHealth", label: "Phone sync", type: "action", command: "sync.health" },
  // Mihon's backup options. Manual and automatic backups share Suwayomi's
  // automatic backup settings, so one folder holds both. Never the sync
  // folder: the sync would read Suwayomi's backups as phone backups. The
  // server settings hold the server password, so they stay out of a
  // folder the user picks.
  { key: "backupPath", label: "Backup folder", type: "text", default: "", store: "server", pattern: /^(\/.*)?$/, hint: "Enter an absolute path, or nothing for the server's own folder.", blank: "server default", notSameAs: "syncFolder", with: { autoBackupIncludeServerSettings: false } },
  // Mihon's automatic backups. Suwayomi counts the interval in days and runs
  // it at backupTime; it deletes its own backups by age, not by count.
  {
    key: "backupInterval", label: "Automatic backups", type: "choice", default: 1, store: "server",
    options: [
      { value: 0, label: "Off" },
      { value: 1, label: "Daily" },
      { value: 2, label: "Every 2 days" },
      { value: 3, label: "Every 3 days" },
      { value: 7, label: "Weekly" }
    ]
  },
  { key: "backupTime", label: "Automatic backup time", type: "text", default: "00:00", store: "server", pattern: /^([01]\d|2[0-3]):[0-5]\d$/, hint: "Enter a time as HH:MM, such as 21:30." },
  {
    key: "backupTTL", label: "Keep automatic backups", type: "choice", default: 14, store: "server",
    options: [
      { value: 7, label: "1 week" },
      { value: 14, label: "2 weeks" },
      { value: 30, label: "1 month" },
      { value: 90, label: "3 months" },
      { value: 0, label: "Forever" }
    ]
  },
  { key: "autoBackupIncludeCategories", label: "Backups include categories", type: "bool", default: true, store: "server" },
  { key: "autoBackupIncludeChapters", label: "Backups include chapters", type: "bool", default: true, store: "server" },
  { key: "autoBackupIncludeTracking", label: "Backups include tracking", type: "bool", default: true, store: "server" },
  { key: "autoBackupIncludeHistory", label: "Backups include history", type: "bool", default: true, store: "server" },
  { key: "createBackup", label: "Create a backup", type: "action", command: "backup.create" }
]

function defaults() {
  var v = {}
  ROWS.forEach(function(r) { if (r.type !== "action") v[r.key] = r.default })
  return v
}

// settings.state: "loading" | "ok" | "no-config" | "down" | "unauthorized" | "error",
// the same states as the library connection, so Model.problem() words them.
// values always holds every row: the last known value, or the default.
function initial() {
  return { state: "loading", message: "", values: defaults() }
}

function loadPayload() {
  var fields = ROWS.filter(function(r) { return r.store === "server" }).map(function(r) { return r.key })
  return { query: "{ settings { " + fields.join(" ") + " } metas { nodes { key value } } }" }
}

// The mutation that stores value for row. Its reply carries the stored
// value back, so reduce() reads saves and loads alike.
function savePayload(row, value) {
  if (row.store === "meta") return Prefs.savePayload(row.key, value)
  var s = {}
  s[row.key] = value
  if (value === true && row.whenOn) for (var k in row.whenOn) s[k] = row.whenOn[k]
  for (var w in row.with) s[w] = row.with[w]
  return {
    query: "mutation($s: PartialSettingsTypeInput!) { setSettings(input: { settings: $s }) { settings { " + row.key + " } } }",
    variables: { s: s }
  }
}

function fromMeta(row, text) {
  if (row.type === "bool") return text === "true"
  if (row.type === "choice") return option(row, text) ? text : row.default
  return text
}

function option(row, value) {
  for (var i = 0; i < row.options.length; i++) if (row.options[i].value === value) return row.options[i]
  return null
}

// Reply data from loadPayload() or savePayload() -> the row values it holds.
function valuesIn(data) {
  var found = {}
  var server = data.settings || (data.setSettings && data.setSettings.settings) || {}
  var metas = (data.metas && data.metas.nodes) || (data.setGlobalMeta ? [data.setGlobalMeta.meta] : [])
  var meta = {}
  metas.forEach(function(m) { if (m) meta[m.key] = m.value })
  ROWS.forEach(function(r) {
    if (r.store === "server" && server[r.key] !== undefined && server[r.key] !== null) found[r.key] = server[r.key]
    if (r.store === "meta" && typeof meta[META_PREFIX + r.key] === "string") found[r.key] = fromMeta(r, meta[META_PREFIX + r.key])
  })
  return found
}

// event.type:
//   "config-missing"  server.json is absent or unreadable
//   "request"         a load or a save went out
//   "response"        { reply } with reply from Model.reply()
// A failed request keeps the values shown and only changes state.
function reduce(settings, event) {
  switch (event.type) {
    case "config-missing":
      return { state: "no-config", message: "", values: settings.values }
    case "request":
      return { state: "loading", message: "", values: settings.values }
    case "response":
      var r = event.reply
      if (r.state !== "ok") return { state: r.state, message: r.message, values: settings.values }
      var values = {}
      for (var k in settings.values) values[k] = settings.values[k]
      var found = valuesIn(r.data)
      for (var f in found) values[f] = found[f]
      return { state: "ok", message: "", values: values }
  }
  return settings
}

// A category row's values, in Mihon's order: always ask, Default, then
// each user category. categories: [{ id, name }], as the library has them.
function categoryOptions(categories) {
  return [{ value: "ask", label: "Always ask" }, { value: "0", label: "Default" }].concat((categories || []).map(function(c) {
    return { value: String(c.id), label: c.name }
  }))
}

// What Enter or Space does to a row: { save: newValue } for bool, choice
// and category rows, { edit: currentText } for text rows. categories: the
// user's, for a category row. An action row gives { run: commandId }.
function activate(row, value, categories) {
  if (row.type === "action") return { run: row.command }
  if (row.type === "bool") return { save: !value }
  if (row.type === "category") {
    var options = categoryOptions(categories)
    var at = options.map(function(o) { return o.value }).indexOf(value)
    return { save: options[(at + 1) % options.length].value }
  }
  if (row.type === "choice") {
    var i = row.options.indexOf(option(row, value))
    return { save: row.options[(i + 1) % row.options.length].value }
  }
  return { edit: String(value) }
}

// A typed folder -> { folder } or { error }. "~" means home.
function commitFolder(text, home) {
  var t = String(text).trim().replace(/^~(?=\/|$)/, home)
  if (t.charAt(0) !== "/") return { error: "Enter an absolute path, such as ~/Sync/Mihon." }
  return { folder: normalizePath(t) }
}

// An absolute path as Java's Path.normalize() gives it, the form the sync
// helper compares: no ".", "..", doubled or trailing slashes.
function normalizePath(path) {
  var parts = []
  String(path).split("/").forEach(function(s) {
    if (s === "..") parts.pop()
    else if (s && s !== ".") parts.push(s)
  })
  return "/" + parts.join("/")
}

// An edited text -> { save: value } or { error: message }. A folder row
// gives { folder } instead: the caller checks that it exists, then saves.
// values: the rows' current values, for notSameAs. A text row with
// notSameAs is a path: when not blank it is a { folder } too, normalized.
function commit(row, text, home, values) {
  var t = String(text).trim()
  var done = row.type === "folder" ? commitFolder(text, home) : row.pattern && !row.pattern.test(t) ? { error: row.hint } : row.notSameAs && t ? { folder: normalizePath(t) } : { save: t }
  var path = "folder" in done ? done.folder : done.save
  var other = row.notSameAs && values ? values[row.notSameAs] : ""
  if (path && other && path === normalizePath(other)) {
    // The helper's own refusal, word for word (backupRefusal in sync/).
    if (row.key === "backupPath") return { error: t + " is the sync folder. Choose another backup folder in Settings." }
    return { error: "The sync folder and the backup folder must differ: the sync would read the server's backups as phone backups." }
  }
  return done
}

// The modes on, as the status bar names them beside the connection.
var MODES = [["downloadedOnly", "downloaded only"], ["incognito", "incognito"]]

function modes(values) {
  return MODES.filter(function(m) { return values[m[0]] === true }).map(function(m) { return m[1] })
}

// The palette's toggle for a mode row: the save that flips it.
function toggle(key, values) {
  var row = ROWS.filter(function(r) { return r.key === key })[0]
  return { row: row, value: !values[key] }
}

// A deleted category shows as always ask, which is what adding then does.
function display(row, value, categories) {
  if (row.type === "action") return value || ""
  if (row.type === "bool") return value ? "on" : "off"
  if (row.type === "category") {
    var found = categoryOptions(categories).filter(function(o) { return o.value === value })[0]
    return found ? found.label : "Always ask"
  }
  if (row.type === "choice") {
    var o = option(row, value)
    return o ? o.label : String(value)
  }
  return value === "" && row.blank ? row.blank : String(value)
}

if (typeof module !== "undefined") {
  module.exports = {
    META_PREFIX: META_PREFIX,
    ROWS: ROWS,
    initial: initial,
    loadPayload: loadPayload,
    savePayload: savePayload,
    reduce: reduce,
    activate: activate,
    commitFolder: commitFolder,
    commit: commit,
    display: display,
    modes: modes,
    toggle: toggle
  }
}
