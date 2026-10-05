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
//   position: the index in the server's list, headers and hidden
//         preferences included, which is what Suwayomi's changes address.
//   value: bool; "IGNORE" | "INCLUDE" | "EXCLUDE"; choice: an index into
//         options (-1 for none); sort: { index, ascending } or null;
//         multi: the chosen entry values; text: a string.
//   options: the labels a choice, sort or multi offers; values: a
//         preference's entry values beside them.
//   type: the server's type name, for a preference's change field.

// Aliased: the same field has a different type in each fragment.
var FILTER_FIELDS = "__typename ... on CheckBoxFilter { name checkBox: default } ... on TriStateFilter { name triState: default }"
  + " ... on SelectFilter { name values select: default } ... on SortFilter { name values sort: default { index ascending } }"
  + " ... on TextFilter { name text: default } ... on HeaderFilter { name } ... on SeparatorFilter { name }"
var FILTERS_QUERY = "query($id: LongString!) { source(id: $id) { filters { " + FILTER_FIELDS
  + " ... on GroupFilter { name filters { " + FILTER_FIELDS + " } } } } }"

var PREFERENCE_FIELDS = "__typename"
  + " ... on SwitchPreference { key title summary visible enabled switchValue: currentValue switchDefault: default }"
  + " ... on CheckBoxPreference { key title summary visible enabled checkValue: currentValue checkDefault: default }"
  + " ... on ListPreference { key title summary visible enabled listValue: currentValue listDefault: default entries entryValues }"
  + " ... on MultiSelectListPreference { key title summary visible enabled multiValue: currentValue multiDefault: default entries entryValues }"
  + " ... on EditTextPreference { key title summary visible enabled textValue: currentValue textDefault: default }"
var PREFERENCES_QUERY = "query($id: LongString!) { source(id: $id) { preferences { " + PREFERENCE_FIELDS + " } } }"
var PREFERENCE_MUTATION = "mutation($source: LongString!, $change: SourcePreferenceChangeInput!) {"
  + " updateSourcePreference(input: { source: $source, change: $change }) { preferences { " + PREFERENCE_FIELDS + " } } }"

// The FilterChangeInput field for each filter kind.
var FILTER_STATE = { bool: "checkBoxState", tristate: "triState", choice: "selectState", text: "textState", sort: "sortState" }
// The SourcePreferenceChangeInput field for each preference type.
var PREFERENCE_STATE = {
  SwitchPreference: "switchState",
  CheckBoxPreference: "checkBoxState",
  ListPreference: "listState",
  MultiSelectListPreference: "multiSelectState",
  EditTextPreference: "editTextState"
}
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

function filter(n, i) {
  switch (n.__typename) {
    case "CheckBoxFilter": return widget("bool", i, n.name, n.checkBox === true)
    case "TriStateFilter": return widget("tristate", i, n.name, n.triState || "IGNORE")
    case "SelectFilter": return widget("choice", i, n.name, n.select, { options: (n.values || []).map(String) })
    case "SortFilter": return widget("sort", i, n.name, n.sort ? { index: n.sort.index, ascending: n.sort.ascending === true } : null, { options: (n.values || []).map(String) })
    case "TextFilter": return widget("text", i, n.name, String(n.text || ""))
    case "GroupFilter": return widget("group", i, n.name, null, { children: (n.filters || []).map(filter) })
    case "HeaderFilter": return widget("header", i, n.name, null)
  }
  return widget("separator", i, n.name, null)
}

function fromFilters(nodes) {
  return (nodes || []).map(filter)
}

function preference(n, i) {
  var more = { type: n.__typename, summary: String(n.summary || ""), visible: n.visible !== false, enabled: n.enabled !== false }
  var w
  switch (n.__typename) {
    case "SwitchPreference":
      w = widget("bool", i, n.title, n.switchValue === null || n.switchValue === undefined ? n.switchDefault === true : n.switchValue === true, more)
      return copy(w, { default: n.switchDefault === true })
    case "CheckBoxPreference":
      w = widget("bool", i, n.title, n.checkValue === null || n.checkValue === undefined ? n.checkDefault === true : n.checkValue === true, more)
      return copy(w, { default: n.checkDefault === true })
    case "ListPreference":
      var values = (n.entryValues || []).map(String)
      var current = n.listValue === null || n.listValue === undefined ? n.listDefault : n.listValue
      w = widget("choice", i, n.title, values.indexOf(String(current)), copy(more, { options: (n.entries || []).map(String), values: values }))
      return copy(w, { default: values.indexOf(String(n.listDefault)) })
    case "MultiSelectListPreference":
      w = widget("multi", i, n.title, (n.multiValue || n.multiDefault || []).map(String), copy(more, { options: (n.entries || []).map(String), values: (n.entryValues || []).map(String) }))
      return copy(w, { default: (n.multiDefault || []).map(String) })
  }
  w = widget("text", i, n.title, String(n.textValue === null || n.textValue === undefined ? n.textDefault || "" : n.textValue), more)
  return copy(w, { default: String(n.textDefault || "") })
}

function fromPreferences(nodes) {
  return (nodes || []).map(preference)
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

function filterChange(w) {
  var c = { position: w.position }
  c[FILTER_STATE[w.kind]] = w.kind === "sort" ? { index: w.value.index, ascending: w.value.ascending } : w.value
  return c
}

// fetchSourceManga's filters: one FilterChange per widget off its default.
// The server starts from the source's default list, so the rest need not
// go. A group's child goes as its own change under the group's position.
function filterChanges(widgets) {
  var out = []
  widgets.forEach(function(w) {
    if (w.kind === "group") {
      w.children.forEach(function(c) {
        if (FILTER_STATE[c.kind] && changed(c)) out.push({ position: w.position, groupChange: filterChange(c) })
      })
    } else if (FILTER_STATE[w.kind] && changed(w) && w.value !== null) {
      out.push(filterChange(w))
    }
  })
  return out
}

// updateSourcePreference's change for the preference at path.
function preferenceChange(widgets, path) {
  var w = at(widgets, path)
  var c = { position: w.position }
  c[PREFERENCE_STATE[w.type]] = w.kind === "choice" ? w.values[w.value] : w.value
  return c
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
  return { query: p.kind === "filters" ? FILTERS_QUERY : PREFERENCES_QUERY, variables: { id: p.source.id } }
}

function savePayload(p, path) {
  return { query: PREFERENCE_MUTATION, variables: { source: p.source.id, change: preferenceChange(p.widgets, path) } }
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
      var widgets = d.updateSourcePreference ? fromPreferences(d.updateSourcePreference.preferences)
        : p.kind === "filters" ? fromFilters(d.source.filters) : fromPreferences(d.source.preferences)
      return clamp(copy(p, { state: "ok", message: "", error: "", widgets: widgets, saved: p.saved || !!d.updateSourcePreference }))
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
    FILTERS_QUERY: FILTERS_QUERY,
    PREFERENCES_QUERY: PREFERENCES_QUERY,
    PREFERENCE_MUTATION: PREFERENCE_MUTATION,
    fromFilters: fromFilters,
    fromPreferences: fromPreferences,
    rows: rows,
    activate: activate,
    setText: setText,
    reset: reset,
    changedCount: changedCount,
    filterChanges: filterChanges,
    preferenceChange: preferenceChange,
    panel: panel,
    loadPayload: loadPayload,
    savePayload: savePayload,
    reducePanel: reducePanel
  }
}
