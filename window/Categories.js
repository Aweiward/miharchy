.pragma library
.import "Downloads.js" as Downloads

// Managing categories: the names the window accepts and the mutations it
// sends. Pure, so tests/categories.test.js pins it; CategoriesView.qml
// sends the payloads and reloads the library after each reply.

var CREATE_MUTATION = "mutation($name: String!) { createCategory(input: { name: $name }) { category { id } } }"
var RENAME_MUTATION = "mutation($id: Int!, $name: String!) { updateCategory(input: { id: $id, patch: { name: $name } }) { category { id } } }"
var DELETE_MUTATION = "mutation($id: Int!) { deleteCategory(input: { categoryId: $id }) { category { id } } }"
// Mihon's library update and auto-download categories: once one is
// included, only the included ones count; an excluded one always stays out,
// even for a manga that is also in an included one. Suwayomi's
// updateLibrary and its new chapter download apply the same rule; the
// Settings row "Auto-download new chapters" turns the download on.
var INCLUDE_STATES = ["UNSET", "INCLUDE", "EXCLUDE"]
var INCLUDE_FIELDS = { update: "includeInUpdate", download: "includeInDownload" }
// Mihon's excluded categories for deleting chapters: a manga in one keeps
// its read downloads (Downloads.autoDeletePayload).
var KEEP_MUTATION = "mutation($meta: CategoryMetaTypeInput!) { setCategoryMeta(input: { meta: $meta }) { meta { key value } } }"
var MOVE_MUTATION = "mutation($id: Int!, $position: Int!) { updateCategoryOrder(input: { id: $id, position: $position }) { categories { id } } }"

// -> { name } or { error }. The sync helper matches categories by name, and
// Suwayomi lets a rename take a name that exists, so the window refuses it.
// Suwayomi compares names case-sensitively and refuses Default in any case.
function checkName(text, categories, exceptId) {
  var name = String(text || "").trim()
  if (!name) return { error: "A category needs a name." }
  if (name.toLowerCase() === "default") return { error: "Default is the place for manga in no category." }
  for (var i = 0; i < categories.length; i++) {
    if (categories[i].name === name && categories[i].id !== exceptId) return { error: "A category named " + name + " already exists." }
  }
  return { name: name }
}

function createPayload(name) {
  return { query: CREATE_MUTATION, variables: { name: name } }
}

function renamePayload(id, name) {
  return { query: RENAME_MUTATION, variables: { id: id, name: name } }
}

function deletePayload(id) {
  return { query: DELETE_MUTATION, variables: { id: id } }
}

// Cycles the category's flag (kind "update" or "download") through unset,
// included and excluded.
function includePayload(categories, id, kind) {
  var state = categories.filter(function(c) { return c.id === id })[0][kind]
  return {
    query: "mutation($id: Int!, $include: IncludeOrExclude!) { updateCategory(input: { id: $id, patch: { " + INCLUDE_FIELDS[kind] + ": $include } }) { category { id } } }",
    variables: { id: id, include: INCLUDE_STATES[(INCLUDE_STATES.indexOf(state) + 1) % INCLUDE_STATES.length] }
  }
}

function keepPayload(categories, id) {
  var keep = !categories.filter(function(c) { return c.id === id })[0].keep
  return { query: KEEP_MUTATION, variables: { meta: { categoryId: id, key: Downloads.KEEP_KEY, value: String(keep) } } }
}

// Moves categories[index] by delta (-1 or 1), or null past either end.
// Positions count from 1, after Default at 0.
function movePayload(categories, index, delta) {
  var to = index + delta
  if (!categories[index] || to < 0 || to >= categories.length) return null
  return { query: MOVE_MUTATION, variables: { id: categories[index].id, position: to + 1 } }
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
    createPayload: createPayload,
    renamePayload: renamePayload,
    deletePayload: deletePayload,
    includePayload: includePayload,
    keepPayload: keepPayload,
    movePayload: movePayload,
    rows: rows
  }
}
