.pragma library
.import "Downloads.js" as Downloads

// Managing categories: the names the window accepts and the requests it
// sends (miharchy-core's routes, ADR 0010). Pure, so tests/categories.test.js
// pins it; CategoriesView.qml sends the payloads and reloads the library
// after each reply.

// Mihon's library update and auto-download categories: once one is
// included, only the included ones count; an excluded one always stays out,
// even for a manga that is also in an included one. The Settings row
// "Auto-download new chapters" turns the download on.
var INCLUDE_STATES = ["UNSET", "INCLUDE", "EXCLUDE"]
var INCLUDE_FIELDS = { update: "includeInUpdate", download: "includeInDownload" }

// -> { name } or { error }. The sync helper matches categories by name, so
// the window refuses a rename to a name that exists. Names compare
// case-sensitively; Default is refused in any case.
function checkName(text, categories, exceptId) {
  var name = String(text || "").trim()
  if (!name) return { error: "A category needs a name." }
  if (name.toLowerCase() === "default") return { error: "Default is the place for manga in no category." }
  for (var i = 0; i < categories.length; i++) {
    if (categories[i].name === name && categories[i].id !== exceptId) return { error: "A category named " + name + " already exists." }
  }
  return { name: name }
}

// core (the last argument of each payload here) is unused: the routes are
// miharchy-core's.
function createPayload(name) {
  return { route: "category.create", body: { name: name } }
}

function renamePayload(id, name) {
  return { route: "category.update", body: { id: id, name: name } }
}

function deletePayload(id) {
  return { route: "category.delete", body: { id: id } }
}

// Cycles the category's flag (kind "update" or "download") through unset,
// included and excluded.
function includePayload(categories, id, kind) {
  var state = categories.filter(function(c) { return c.id === id })[0][kind]
  var next = INCLUDE_STATES[(INCLUDE_STATES.indexOf(state) + 1) % INCLUDE_STATES.length]
  var body = { id: id }
  body[INCLUDE_FIELDS[kind]] = next
  return { route: "category.update", body: body }
}

// Mihon's excluded categories for deleting chapters: a manga in one keeps
// its read downloads (Downloads.autoDeletePayload).
function keepPayload(categories, id) {
  var keep = !categories.filter(function(c) { return c.id === id })[0].keep
  return { route: "meta.set", body: { metas: [{ scope: "category", owner: id, key: Downloads.KEEP_KEY, value: String(keep) }] } }
}

// Moves categories[index] by delta (-1 or 1), or null past either end.
// Positions count from 1, after Default at 0.
function movePayload(categories, index, delta) {
  var to = index + delta
  if (!categories[index] || to < 0 || to >= categories.length) return null
  return { route: "category.reorder", body: { id: categories[index].id, position: to + 1 } }
}

// createPayload's reply -> the new category's id.
function createdId(data) {
  return data.category.id
}

// Each category as { id, name, download, update, keep, count } with its
// number of library manga.
function rows(categories, manga) {
  return categories.map(function(c) {
    return { id: c.id, name: c.name, download: c.download || "UNSET", update: c.update || "UNSET", keep: c.keep === true, count: manga.filter(function(m) { return m.categories.indexOf(c.id) !== -1 }).length }
  })
}

if (typeof module !== "undefined") {
  module.exports = {
    checkName: checkName,
    createdId: createdId,
    createPayload: createPayload,
    renamePayload: renamePayload,
    deletePayload: deletePayload,
    includePayload: includePayload,
    keepPayload: keepPayload,
    movePayload: movePayload,
    rows: rows
  }
}
