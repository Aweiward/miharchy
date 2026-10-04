.pragma library

// The Settings view's rows and state. Pure, so tests/settings.test.js pins
// it; shell.qml sends the payloads built here and feeds replies back.
//
// A row: { key, label, type: "bool" | "choice" | "text", default, store }.
//   store "server": a Suwayomi server setting named key (settings/setSettings).
//   store "meta":   a Miharchy preference in Suwayomi global meta under
//                   META_PREFIX + key, stored as a string.
//   choice rows add options: [{ value, label }]; text rows add pattern and
//   hint for validation; bool rows may add whenOn, extra server settings
//   sent along when the row turns on.
// A later setting is one more entry here.

var META_PREFIX = "miharchy."

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
  // Cloudflare sources fail without the response fallback even when
  // FlareSolverr solves the challenge (docs/spikes/extension-spike.md).
  { key: "flareSolverrEnabled", label: "FlareSolverr", type: "bool", default: false, store: "server", whenOn: { flareSolverrAsResponseFallback: true } },
  { key: "flareSolverrUrl", label: "FlareSolverr URL", type: "text", default: "http://127.0.0.1:8191", store: "server", pattern: /^https?:\/\/\S+$/, hint: "Enter a URL that starts with http:// or https://." }
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
  if (row.store === "meta") {
    return {
      query: "mutation($key: String!, $value: String!) { setGlobalMeta(input: { meta: { key: $key, value: $value } }) { meta { key value } } }",
      variables: { key: META_PREFIX + row.key, value: String(value) }
    }
  }
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

// What Enter or Space does to a row: { save: newValue } for bool and
// choice rows, { edit: currentText } for text rows.
function activate(row, value) {
  if (row.type === "bool") return { save: !value }
  if (row.type === "choice") {
    var i = row.options.indexOf(option(row, value))
    return { save: row.options[(i + 1) % row.options.length].value }
  }
  return { edit: String(value) }
}

// An edited text -> { save: value } or { error: message }.
function commit(row, text) {
  var t = String(text).trim()
  if (row.pattern && !row.pattern.test(t)) return { error: row.hint }
  return { save: t }
}

function display(row, value) {
  if (row.type === "bool") return value ? "on" : "off"
  if (row.type === "choice") {
    var o = option(row, value)
    return o ? o.label : String(value)
  }
  return String(value)
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
    commit: commit,
    display: display
  }
}
