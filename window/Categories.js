.pragma library
.import "Downloads.js" as Downloads

// Managing categories: the names the window accepts and the mutations it
// sends. Pure, so tests/categories.test.js pins it; CategoriesView.qml
// sends the payloads and reloads the library after each reply.

var CREATE_MUTATION = "mutation($name: String!) { createCategory(input: { name: $name }) { category { id } } }"
var RENAME_MUTATION = "mutation($id: Int!, $name: String!) { updateCategory(input: { id: $id, patch: { name: $name } }) { category { id } } }"
// Suwayomi downloads new chapters of every unflagged category once none is
// flagged, so its autoDownloadNewChapters follows "some category is
// flagged" after every change. It skips a manga with unread chapters by
// default, which would make the flag look broken.
var AUTO_SETTING = "setSettings(input: { settings: { autoDownloadNewChapters: $on, excludeEntryWithUnreadChapters: false } }) { settings { autoDownloadNewChapters } }"
var DELETE_MUTATION = "mutation($id: Int!, $on: Boolean!) { deleteCategory(input: { categoryId: $id }) { category { id } } " + AUTO_SETTING + " }"
var AUTO_DOWNLOAD_MUTATION = "mutation($id: Int!, $include: IncludeOrExclude!, $on: Boolean!) {"
  + " updateCategory(input: { id: $id, patch: { includeInDownload: $include } }) { category { id } } " + AUTO_SETTING + " }"
var UPDATE_MUTATION = "mutation($id: Int!, $include: IncludeOrExclude!) { updateCategory(input: { id: $id, patch: { includeInUpdate: $include } }) { category { id } } }"
// Mihon's library update categories: once one is included, the update
// takes only the included ones; an excluded one always stays out, even for
// a manga that is also in an included one. Suwayomi's updateLibrary
// applies the same rule.
var UPDATE_STATES = ["UNSET", "INCLUDE", "EXCLUDE"]
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

// categories: the library's, each with download: flagged for auto-download.
function deletePayload(categories, id) {
  return { query: DELETE_MUTATION, variables: { id: id, on: anyFlagged(categories, id, false) } }
}

function anyFlagged(categories, id, flag) {
  return categories.some(function(c) { return c.id === id ? flag : c.download })
}

function autoDownloadPayload(categories, id) {
  var flag = !categories.filter(function(c) { return c.id === id })[0].download
  return { query: AUTO_DOWNLOAD_MUTATION, variables: { id: id, include: flag ? "INCLUDE" : "UNSET", on: anyFlagged(categories, id, flag) } }
}

function updatePayload(categories, id) {
  var state = categories.filter(function(c) { return c.id === id })[0].update
  return { query: UPDATE_MUTATION, variables: { id: id, include: UPDATE_STATES[(UPDATE_STATES.indexOf(state) + 1) % UPDATE_STATES.length] } }
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
    return { id: c.id, name: c.name, download: c.download === true, update: c.update || "UNSET", keep: c.keep === true, count: manga.filter(function(m) { return m.categories.indexOf(c.id) !== -1 }).length }
  })
}

if (typeof module !== "undefined") {
  module.exports = {
    checkName: checkName,
    createPayload: createPayload,
    renamePayload: renamePayload,
    deletePayload: deletePayload,
    autoDownloadPayload: autoDownloadPayload,
    updatePayload: updatePayload,
    keepPayload: keepPayload,
    movePayload: movePayload,
    rows: rows
  }
}
