.pragma library

// View choices (sort, filter, display) kept in Suwayomi global meta under
// PREFIX + key, so they survive a restart and every window reads one
// place. A view lists its choices as a table, each { key, default,
// options: [string] }; a stored value outside options reads as unset.
// Pure, so tests/prefs.test.js pins it; the view sends the payloads.

var PREFIX = "miharchy."

var SAVE_MUTATION = "mutation($key: String!, $value: String!) { setGlobalMeta(input: { meta: { key: $key, value: $value } }) { meta { key value } } }"

function defaults(table) {
  var v = {}
  table.forEach(function(c) { v[c.key] = c.default })
  return v
}

function loadPayload(table) {
  return {
    query: "query($keys: [String!]) { metas(filter: { key: { in: $keys } }) { nodes { key value } } }",
    variables: { keys: table.map(function(c) { return PREFIX + c.key }) }
  }
}

function savePayload(key, value) {
  return { query: SAVE_MUTATION, variables: { key: PREFIX + key, value: String(value) } }
}

// Reply data from loadPayload() or savePayload() -> a copy of values with
// each valid choice the reply carries.
function read(table, data, values) {
  var stored = {}
  var nodes = (data.metas && data.metas.nodes) || (data.setGlobalMeta ? [data.setGlobalMeta.meta] : [])
  nodes.forEach(function(m) { if (m) stored[m.key] = m.value })
  var next = {}
  for (var k in values) next[k] = values[k]
  table.forEach(function(c) {
    var s = stored[PREFIX + c.key]
    if (c.options.indexOf(s) !== -1) next[c.key] = s
  })
  return next
}

if (typeof module !== "undefined") {
  module.exports = {
    PREFIX: PREFIX,
    defaults: defaults,
    loadPayload: loadPayload,
    savePayload: savePayload,
    read: read
  }
}
