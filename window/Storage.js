.pragma library

// Settings' storage rows: the disk space downloads and the image cache use,
// and the cache clear, all miharchy-core's routes. Pure, so
// tests/storage.test.js pins it.

// The server's data folder: MIHARCHY_SERVER_ROOT, or under HOME.
// env: { HOME, MIHARCHY_SERVER_ROOT }.
function root(env) {
  return env.MIHARCHY_SERVER_ROOT || env.HOME + "/.local/share/miharchy/suwayomi"
}

// Where the local source reads its manga: localSourcePath, or the root's
// local when that is blank.
function localFolder(env, localSourcePath) {
  return localSourcePath || root(env) + "/local"
}

// Core measures its own folders, which the window cannot know:
// { downloads, cache } in bytes, cache being the covers of manga outside
// the library that cache.clear deletes, answering { freed }.
var SIZES_PAYLOAD = { route: "storage.get", body: {} }
var CORE_CLEAR_PAYLOAD = { route: "cache.clear", body: {} }

// Decimal units, as Android's file sizes in Mihon.
function format(bytes) {
  var units = ["B", "kB", "MB", "GB", "TB"]
  var n = Number(bytes) || 0
  var i = 0
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000
    i++
  }
  return (i ? n.toFixed(1) : String(n)) + " " + units[i]
}

if (typeof module !== "undefined") {
  module.exports = {
    root: root,
    localFolder: localFolder,
    SIZES_PAYLOAD: SIZES_PAYLOAD,
    CORE_CLEAR_PAYLOAD: CORE_CLEAR_PAYLOAD,
    format: format
  }
}
