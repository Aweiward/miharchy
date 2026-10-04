.pragma library

// Managing categories: the names the window accepts and the mutations it
// sends. Pure, so tests/categories.test.js pins it; CategoriesView.qml
// sends the payloads and reloads the library after each reply.

var CREATE_MUTATION = "mutation($name: String!) { createCategory(input: { name: $name }) { category { id } } }"
var RENAME_MUTATION = "mutation($id: Int!, $name: String!) { updateCategory(input: { id: $id, patch: { name: $name } }) { category { id } } }"
var DELETE_MUTATION = "mutation($id: Int!) { deleteCategory(input: { categoryId: $id }) { category { id } } }"
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

// Moves categories[index] by delta (-1 or 1), or null past either end.
// Positions count from 1, after Default at 0.
function movePayload(categories, index, delta) {
  var to = index + delta
  if (!categories[index] || to < 0 || to >= categories.length) return null
  return { query: MOVE_MUTATION, variables: { id: categories[index].id, position: to + 1 } }
}

// Each category as { id, name, count } with its number of library manga.
function rows(categories, manga) {
  return categories.map(function(c) {
    return { id: c.id, name: c.name, count: manga.filter(function(m) { return m.categories.indexOf(c.id) !== -1 }).length }
  })
}

if (typeof module !== "undefined") {
  module.exports = {
    checkName: checkName,
    createPayload: createPayload,
    renamePayload: renamePayload,
    deletePayload: deletePayload,
    movePayload: movePayload,
    rows: rows
  }
}
