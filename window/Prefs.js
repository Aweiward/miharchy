.pragma library

// View choices (sort, filter, display) kept in global meta under
// PREFIX + key, so they survive a restart and every window reads one
// place. A view lists its choices as a table, each { key, default,
// options: [string] }; a stored value outside options reads as unset. A
// choice without options takes any stored string.
// A choice for one manga (pass its mangaId) lives in that manga's meta
// under the same key, over the global value, which is then the default for
// every manga. Pure, so tests/prefs.test.js pins it; PrefStore.qml sends
// the payloads.

var PREFIX = "miharchy."

// Mihon's tri-state filter: off, keep only matching items (include) or
// drop them (exclude). Choosing one again moves to the next state.
var TRI_STATE = ["off", "include", "exclude"]

function defaults(table) {
  var v = {}
  table.forEach(function(c) { v[c.key] = c.default })
  return v
}

function keys(table) {
  return table.map(function(c) { return PREFIX + c.key })
}

// The payloads are miharchy-core's meta routes (ADR 0010); core is kept
// for the callers' sake.
function loadPayload(table, mangaId, core) {
  var global = { scope: "global", keys: keys(table) }
  if (mangaId === undefined) return { route: "meta.get", body: global }
  return { route: "meta.get", body: { queries: [global, { scope: "manga", owners: [mangaId], keys: keys(table) }] } }
}

function savePayload(key, value, mangaId, core) {
  var meta = mangaId === undefined ? { scope: "global" } : { scope: "manga", owner: mangaId }
  meta.key = PREFIX + key
  meta.value = String(value)
  return { route: "meta.set", body: { metas: [meta] } }
}

// Drops the table's choices from each manga, or null for no manga.
function resetPayload(table, mangaIds, core) {
  return mangaIds.length ? { route: "meta.delete", body: { scope: "manga", owners: mangaIds, keys: keys(table) } } : null
}

// Reply data from loadPayload() -> a copy of values with each valid choice
// the reply carries; a manga's own meta wins. Core answers with the metas
// themselves; the loads in UpNext.js and NextChapters.js wrap them as
// { metas: { nodes }, manga: { meta } }. A manga's own value wins by its
// scope, whatever the order.
function read(table, data, values) {
  var stored = {}
  var nodes = Array.isArray(data.metas) ? data.metas.filter(function(m) { return m.scope !== "manga" }).concat(data.metas.filter(function(m) { return m.scope === "manga" })) : (data.metas && data.metas.nodes) || []
  nodes.concat((data.manga && data.manga.meta) || []).forEach(function(m) { if (m) stored[m.key] = m.value })
  var next = {}
  for (var k in values) next[k] = values[k]
  table.forEach(function(c) {
    var s = stored[PREFIX + c.key]
    if (s !== undefined && (!c.options || c.options.indexOf(s) !== -1)) next[c.key] = s
  })
  return next
}

// values with key shown as value while on, whatever is stored: how a mode
// such as Downloaded only forces a filter without saving over the choice.
function force(values, key, value, on) {
  if (!on) return values
  var next = {}
  for (var k in values) next[k] = values[k]
  next[key] = value
  return next
}

// Where a save lands: "global", or one manga's meta.
function scope(mangaId) {
  return mangaId === undefined ? "global" : "manga:" + mangaId
}

// The server applies saves sent together in any order, so they go one at a
// time. queue: [{ scope, key, payload }]; a newer save of the same scope
// and key replaces the waiting one in place.
function enqueue(queue, entry) {
  var replaced = false
  var next = queue.map(function(e) {
    if (e.scope !== entry.scope || e.key !== entry.key) return e
    replaced = true
    return entry
  })
  return replaced ? next : next.concat([entry])
}

if (typeof module !== "undefined") {
  module.exports = {
    PREFIX: PREFIX,
    TRI_STATE: TRI_STATE,
    force: force,
    defaults: defaults,
    keys: keys,
    loadPayload: loadPayload,
    savePayload: savePayload,
    resetPayload: resetPayload,
    read: read,
    scope: scope,
    enqueue: enqueue
  }
}
