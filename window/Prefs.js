.pragma library

// View choices (sort, filter, display) kept in Suwayomi global meta under
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

var SAVE_MUTATION = "mutation($key: String!, $value: String!) { setGlobalMeta(input: { meta: { key: $key, value: $value } }) { meta { key value } } }"
var MANGA_SAVE_MUTATION = "mutation($id: Int!, $key: String!, $value: String!) { setMangaMeta(input: { meta: { mangaId: $id, key: $key, value: $value } }) { meta { key value } } }"
var RESET_MUTATION = "mutation($ids: [Int!]!, $keys: [String!]!) { deleteMangaMetas(input: { items: [{ mangaIds: $ids, keys: $keys }] }) { metas { key } } }"

function defaults(table) {
  var v = {}
  table.forEach(function(c) { v[c.key] = c.default })
  return v
}

function keys(table) {
  return table.map(function(c) { return PREFIX + c.key })
}

function loadPayload(table, mangaId) {
  if (mangaId === undefined) {
    return {
      query: "query($keys: [String!]) { metas(filter: { key: { in: $keys } }) { nodes { key value } } }",
      variables: { keys: keys(table) }
    }
  }
  return {
    query: "query($keys: [String!], $id: Int!) { metas(filter: { key: { in: $keys } }) { nodes { key value } } manga(id: $id) { meta { key value } } }",
    variables: { keys: keys(table), id: mangaId }
  }
}

function savePayload(key, value, mangaId) {
  if (mangaId === undefined) return { query: SAVE_MUTATION, variables: { key: PREFIX + key, value: String(value) } }
  return { query: MANGA_SAVE_MUTATION, variables: { id: mangaId, key: PREFIX + key, value: String(value) } }
}

// Drops the table's choices from each manga, or null for no manga.
function resetPayload(table, mangaIds) {
  return mangaIds.length ? { query: RESET_MUTATION, variables: { ids: mangaIds, keys: keys(table) } } : null
}

// Reply data from loadPayload() or savePayload() -> a copy of values with
// each valid choice the reply carries; a manga's own meta wins.
function read(table, data, values) {
  var stored = {}
  var nodes = (data.metas && data.metas.nodes) || (data.setGlobalMeta ? [data.setGlobalMeta.meta] : [])
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
