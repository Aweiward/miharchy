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
//   row turns on; a category row's options are the user's categories, so
//   activate() and display() take them.
// A later setting is one more entry here.

var META_PREFIX = Prefs.PREFIX

var ROWS = [
  { key: "showNsfw", label: "Show NSFW sources", type: "bool", default: false, store: "meta" },
  {
    key: "defaultReadingMode", label: "Default reading mode", type: "choice", default: "paged-rtl", store: "meta",
    options: [
      { value: "paged-rtl", label: "Paged right-to-left" },
      { value: "paged-ltr", label: "Paged left-to-right" },
      { value: "webtoon", label: "Webtoon" }
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
  // Mihon's webtoon side padding, the other way round: the strip's share
  // of the window width. + and - in the reader step it.
  {
    key: "webtoonWidth", label: "Webtoon width", type: "choice", default: "60", store: "meta",
    options: ["30", "40", "50", "60", "70", "80", "90", "100"].map(function(v) { return { value: v, label: v + "% of the window" } })
  },
  // Mihon's reader skips, applied as a chapter opens; the chapter opened
  // always stays.
  { key: "skipRead", label: "Skip read chapters", type: "bool", default: false, store: "meta" },
  { key: "skipFiltered", label: "Skip filtered chapters", type: "bool", default: true, store: "meta" },
  { key: "skipDupe", label: "Skip duplicate chapters", type: "bool", default: false, store: "meta" },
  // Cloudflare sources fail without the response fallback even when
  // FlareSolverr solves the challenge (docs/spikes/extension-spike.md).
  { key: "flareSolverrEnabled", label: "FlareSolverr", type: "bool", default: false, store: "server", whenOn: { flareSolverrAsResponseFallback: true } },
  { key: "flareSolverrUrl", label: "FlareSolverr URL", type: "text", default: "http://127.0.0.1:8191", store: "server", pattern: /^https?:\/\/\S+$/, hint: "Enter a URL that starts with http:// or https://." },
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
  // The library update skips these manga while on, as Mihon does. On
  // means skip, the server's own sense, so a fresh library may skip all.
  { key: "excludeUnreadChapters", label: "Skip manga with unread chapters", type: "bool", default: true, store: "server" },
  { key: "excludeNotStarted", label: "Skip manga not started", type: "bool", default: true, store: "server" },
  { key: "excludeCompleted", label: "Skip completed manga", type: "bool", default: true, store: "server" },
  // Mihon's default category for manga added to the library: "ask", "0"
  // (Default: no category) or a category id. The server's own default flag
  // applies only to its REST add, so the window applies this one.
  { key: "defaultCategory", label: "Default category", type: "category", default: "ask", store: "meta" },
  // The server refuses a folder that does not exist; empty means its own.
  { key: "downloadsPath", label: "Download folder", type: "text", default: "", store: "server", pattern: /^(\/.*)?$/, hint: "Enter an absolute path, or nothing for the server's own folder.", blank: "server default" },
  // Suwayomi has no such setting, so the reader deletes a chapter it
  // finished as it leaves it.
  { key: "deleteAfterRead", label: "Delete after read", type: "bool", default: false, store: "meta" },
  // Setup sets it too; the sync helper reads it from the server.
  { key: "syncFolder", label: "Sync folder", type: "folder", default: "", store: "meta", blank: "not set" }
]

function defaults() {
  var v = {}
  ROWS.forEach(function(r) { v[r.key] = r.default })
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
// user's, for a category row.
function activate(row, value, categories) {
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
  return { folder: t.length > 1 ? t.replace(/\/+$/, "") : t }
}

// An edited text -> { save: value } or { error: message }. A folder row
// gives { folder } instead: the caller checks that it exists, then saves.
function commit(row, text, home) {
  if (row.type === "folder") return commitFolder(text, home)
  var t = String(text).trim()
  if (row.pattern && !row.pattern.test(t)) return { error: row.hint }
  return { save: t }
}

// A deleted category shows as always ask, which is what adding then does.
function display(row, value, categories) {
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
    display: display
  }
}
