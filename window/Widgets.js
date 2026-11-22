.pragma library

// The widgets an extension defines for one source: its filters (checkbox,
// tri-state, select, sort, text, group, header, separator) and its
// preferences (switch, checkbox, list, multi-select list, text), parsed
// into one tree that the filter panel and the source settings panel both
// edit. Pure, so tests/widgets.test.js pins it; BrowseView.qml sends the
// payloads built here.
//
// A widget: { kind, position, label, summary, type, value, default,
// options, values, children, visible, enabled }.
//   kind: "bool" | "tristate" | "choice" | "sort" | "multi" | "text"
//         | "group" | "header" | "separator"
//   position: the index in the source's list, headers included.
//   value: bool; "IGNORE" | "INCLUDE" | "EXCLUDE"; choice: an index into
//         options (-1 for none); sort: { index, ascending } or null;
//         multi: the chosen entry values; text: a string.
//   options: the labels a choice, sort or multi offers; values: a
//         preference's entry values beside them.
//   type: core's setting type.

var EXPANDS = { group: true, choice: true, sort: true, multi: true }
var TRISTATE_NEXT = { IGNORE: "INCLUDE", INCLUDE: "EXCLUDE", EXCLUDE: "IGNORE" }

function copy(o, changes) {
  var c = {}
  for (var k in o) c[k] = o[k]
  for (var j in changes) c[j] = changes[j]
  return c
}

function widget(kind, position, label, value, more) {
  return copy({ kind: kind, position: position, label: String(label || ""), summary: "", type: "", value: value, default: value, options: [], values: [], children: [], visible: true, enabled: true }, more)
}

// Core (ADR 0010) sends the host's filters: { type, name, state, values?,
// filters? }, each state as the source holds it, so a fresh list's states
// are its defaults.
var TRISTATES = ["IGNORE", "INCLUDE", "EXCLUDE"]

function coreFilter(n, i) {
  var options = { options: (n.values || []).map(String) }
  switch (n.type) {
    case "checkbox": return widget("bool", i, n.name, n.state === true)
    case "tristate": return widget("tristate", i, n.name, TRISTATES[n.state] || "IGNORE")
    case "select": return widget("choice", i, n.name, typeof n.state === "number" ? n.state : -1, options)
    case "sort": return widget("sort", i, n.name, n.state ? { index: n.state.index, ascending: n.state.ascending === true } : null, options)
    case "text": return widget("text", i, n.name, String(n.state || ""))
    case "group": return widget("group", i, n.name, null, { children: (n.filters || []).map(coreFilter) })
    case "header": return widget("header", i, n.name, null)
  }
  return widget("separator", i, n.name, null)
}

// The host's settings: { key, type, title, summary, enabled, value,
// entries?, values?, summaryOn?, summaryOff? }. type "info" is text the
// extension shows with no value. A setting saves by key, so key is kept;
// the host gives no default, so the value stands in.
function coreSetting(n, i) {
  var more = { type: n.type, key: String(n.key), summary: String(n.summary || ""), enabled: n.enabled !== false }
  switch (n.type) {
    case "switch":
      var on = n.value === true
      var summary = on ? n.summaryOn : n.summaryOff
      return widget("bool", i, n.title, on, copy(more, { summary: String(summary === undefined ? n.summary || "" : summary) }))
    case "list":
      var values = (n.values || []).map(String)
      return widget("choice", i, n.title, values.indexOf(String(n.value)), copy(more, { options: (n.entries || []).map(String), values: values }))
    case "multi":
      return widget("multi", i, n.title, (n.value || []).map(String), copy(more, { options: (n.entries || []).map(String), values: (n.values || []).map(String) }))
    case "text":
      return widget("text", i, n.title, String(n.value || ""), more)
  }
  return widget("header", i, n.title, null, more)
}

// The states core's listing takes: one per filter, in the source's order,
// which the host copies over a fresh list by position.
function coreStates(widgets) {
  return widgets.map(function(w) {
    switch (w.kind) {
      case "group": return { filters: coreStates(w.children) }
      case "tristate": return { state: TRISTATES.indexOf(w.value) }
      case "header": case "separator": return {}
    }
    return { state: w.value }
  })
}

function at(widgets, path) {
  return path.length === 1 ? widgets[path[0]] : widgets[path[0]].children[path[1]]
}

// A copy of widgets with the widget at path set to value.
function update(widgets, path, value) {
  return widgets.map(function(w, i) {
    if (i !== path[0]) return w
    if (path.length === 1) return copy(w, { value: value })
    return copy(w, { children: update(w.children, path.slice(1), value) })
  })
}

function changed(w) {
  if (w.kind === "group") return w.children.some(changed)
  if (w.kind === "sort" || w.kind === "multi") return JSON.stringify(w.value) !== JSON.stringify(w.default)
  return w.value !== w.default
}

// How many widgets differ from their defaults, a group's children counted
// one by one.
function changedCount(widgets) {
  return widgets.reduce(function(n, w) {
    return n + (w.kind === "group" ? changedCount(w.children) : changed(w) ? 1 : 0)
  }, 0)
}

function reset(widgets) {
  return widgets.map(function(w) {
    return w.kind === "group" ? copy(w, { children: reset(w.children) }) : copy(w, { value: w.default })
  })
}

function chosen(w) {
  return w.options.filter(function(o, k) { return w.value.indexOf(w.values[k]) !== -1 })
}

function detail(w) {
  switch (w.kind) {
    case "choice": return w.options[w.value] || ""
    case "sort": return w.value ? (w.options[w.value.index] || "") + (w.value.ascending ? " ↑" : " ↓") : ""
    case "multi": var c = chosen(w); return c.length ? c.join(", ") : "none"
    case "text": return w.value
    case "group": var n = changedCount(w.children); return n ? n + " set" : ""
  }
  return ""
}

function mark(w, open) {
  if (w.kind === "bool") return w.value ? "[x]" : "[ ]"
  if (w.kind === "tristate") return { IGNORE: "[ ]", INCLUDE: "[+]", EXCLUDE: "[-]" }[w.value]
  if (EXPANDS[w.kind]) return open ? " ▾ " : " ▸ "
  // As wide as the others, so labels line up; a header has none.
  return w.kind === "text" ? "   " : ""
}

function optionMark(w, k) {
  if (w.kind === "choice") return w.value === k ? "(•)" : "( )"
  if (w.kind === "sort") return w.value && w.value.index === k ? (w.value.ascending ? " ↑ " : " ↓ ") : "   "
  return w.value.indexOf(w.values[k]) !== -1 ? "[x]" : "[ ]"
}

// The rows a panel lists: a row per visible widget, and while a group,
// choice, sort or multi is open, a row per child or option under it.
// Row: { path, option (-1, or the option's index), depth, kind, label,
// mark, detail, summary, enabled, key }. key names the widget in open.
function rows(widgets, open) {
  var out = []
  function walk(list, prefix, depth) {
    list.forEach(function(w, i) {
      if (w.kind === "separator" || !w.visible) return
      var path = prefix.concat([i])
      var key = path.join("/")
      var isOpen = EXPANDS[w.kind] === true && open[key] === true
      var shown = detail(w)
      // Mihon's list summaries name the chosen entry with %s.
      var summary = w.summary.replace("%s", shown)
      out.push({ path: path, option: -1, depth: depth, kind: w.kind, label: w.label, mark: mark(w, isOpen), detail: summary === shown ? "" : shown, summary: summary, enabled: w.enabled, key: key })
      if (!isOpen) return
      if (w.kind === "group") walk(w.children, path, depth + 1)
      else w.options.forEach(function(o, k) {
        out.push({ path: path, option: k, depth: depth + 1, kind: w.kind, label: o, mark: optionMark(w, k), detail: "", summary: "", enabled: w.enabled, key: key })
      })
    })
  }
  walk(widgets, [], 0)
  return out
}

// What Enter does on row: { widgets } with the new value, { toggle: key }
// to open or close it, { edit: text } to type a text widget, or {} for a
// row that takes no edit.
function activate(widgets, row) {
  if (!row || !row.enabled) return {}
  var w = at(widgets, row.path)
  if (row.option === -1) {
    if (EXPANDS[w.kind]) return { toggle: row.key }
    if (w.kind === "bool") return { widgets: update(widgets, row.path, !w.value) }
    if (w.kind === "tristate") return { widgets: update(widgets, row.path, TRISTATE_NEXT[w.value]) }
    if (w.kind === "text") return { edit: w.value }
    return {}
  }
  var k = row.option
  if (w.kind === "choice") return { widgets: update(widgets, row.path, k) }
  // Mihon's sort: the chosen field flips direction, another keeps it.
  if (w.kind === "sort") return { widgets: update(widgets, row.path, { index: k, ascending: w.value && w.value.index === k ? !w.value.ascending : w.value ? w.value.ascending : true }) }
  var target = w.values[k]
  var on = w.value.indexOf(target) === -1
  return { widgets: update(widgets, row.path, w.values.filter(function(v) { return v === target ? on : w.value.indexOf(v) !== -1 })) }
}

function setText(widgets, path, text) {
  return update(widgets, path, String(text))
}

// The filters a search sends: every state, as coreStates gives them, or []
// when none changed. The host copies them over the source's fresh list by
// position.
function filterChanges(widgets, core) {
  return changedCount(widgets) ? coreStates(widgets) : []
}

// panel.kind: "filters" | "preferences". state: "loading" | "ok" | a
// failed connection state. error: why the last save failed. open: the
// keys of open groups and lists. saved: a preference saved since the panel
// opened, so the source's listing is stale. A filter panel lives as long
// as the window, so its edits survive leaving the source.
function panel(kind, source) {
  return { kind: kind, source: source, state: "loading", message: "", error: "", widgets: [], open: {}, cursor: 0, saved: false }
}

function loadPayload(p) {
  return { route: p.kind === "filters" ? "source.filters" : "source.settings", body: { source: p.source.id } }
}

function savePayload(p, path) {
  var w = at(p.widgets, path)
  return { route: "source.setSetting", body: { source: p.source.id, key: w.key, value: w.kind === "choice" ? w.values[w.value] : w.value } }
}

function clamp(p) {
  return copy(p, { cursor: Math.max(0, Math.min(p.cursor, rows(p.widgets, p.open).length - 1)) })
}

// event.type: "reply" { reply, before } to a load, or to a save that left
// before on screen | "move" { delta } | "toggle" { key } | "edit" { widgets }
function reducePanel(p, event) {
  switch (event.type) {
    case "reply":
      var r = event.reply
      if (r.state !== "ok") {
        if (event.before) return copy(p, { widgets: event.before, error: r.message || r.state })
        return copy(p, { state: r.state, message: r.message })
      }
      var d = r.data
      var saved = d.accepted !== undefined
      var next = copy(p, { state: "ok", message: "", error: "", widgets: (p.kind === "filters" ? d.filters : d.settings).map(p.kind === "filters" ? coreFilter : coreSetting), saved: p.saved || d.accepted === true })
      // The extension's change listener may refuse a value, as on Android.
      return clamp(saved && d.accepted === false ? copy(next, { error: "The extension did not take that value." }) : next)
    case "move":
      return clamp(copy(p, { cursor: p.cursor + event.delta }))
    case "toggle":
      var open = copy(p.open, {})
      if (open[event.key]) delete open[event.key]
      else open[event.key] = true
      return clamp(copy(p, { open: open }))
    case "edit":
      return clamp(copy(p, { widgets: event.widgets, error: "" }))
  }
  return p
}

if (typeof module !== "undefined") {
  module.exports = {
    rows: rows,
    activate: activate,
    setText: setText,
    reset: reset,
    changedCount: changedCount,
    filterChanges: filterChanges,
    panel: panel,
    loadPayload: loadPayload,
    savePayload: savePayload,
    reducePanel: reducePanel
  }
}
