.pragma library

// Settings' storage rows: the disk space downloads and the server's image
// cache use, and the cache clear. Suwayomi has no API for either size, so
// SettingsView.qml runs du on the folders dirs() names and hands the output
// to sizes(). Pure, so tests/storage.test.js pins it.

// Suwayomi's ApplicationDirs: downloads in downloadsPath, or in the root's
// downloads when that is blank (library covers live there too, so they
// count as downloads); cached pages and cached covers under
// <java.io.tmpdir>/Tachidesk, which the JVM puts in /tmp.
// env: { HOME, MIHARCHY_SERVER_ROOT, MIHARCHY_SERVER_TMPDIR }; the last two
// name a scratch server's -D values, so a test never measures the real one.
function dirs(env, downloadsPath) {
  var root = env.MIHARCHY_SERVER_ROOT || env.HOME + "/.local/share/miharchy/suwayomi"
  var temp = (env.MIHARCHY_SERVER_TMPDIR || "/tmp") + "/Tachidesk"
  return { downloads: downloadsPath || root + "/downloads", cache: [temp + "/manga-cache", temp + "/thumbnails"] }
}

// Bytes on disk. A missing folder makes du fail but still print the rest,
// so the caller reads stdout whatever the exit code.
function command(d) {
  return ["du", "-s", "-B1", "--", d.downloads].concat(d.cache)
}

// du's "<bytes>\t<path>" lines -> { downloads, cache } in bytes; a folder
// du did not list holds nothing.
function sizes(d, stdout) {
  var by = {}
  String(stdout || "").split("\n").forEach(function(line) {
    var tab = line.indexOf("\t")
    if (tab > 0) by[line.slice(tab + 1)] = Number(line.slice(0, tab))
  })
  var of = function(path) { return by[path] || 0 }
  return { downloads: of(d.downloads), cache: d.cache.reduce(function(sum, p) { return sum + of(p) }, 0) }
}

// Cached pages and cached covers only: downloadedThumbnails, the library's
// covers, stays, and downloads have no clear at all.
var CLEAR_MUTATION = "mutation { clearCachedImages(input: { cachedPages: true, cachedThumbnails: true }) { cachedPages cachedThumbnails } }"

function clearPayload() {
  return { query: CLEAR_MUTATION }
}

// Whether the server cleared both; it answers false for a folder it could
// not empty.
function cleared(data) {
  var c = data && data.clearCachedImages
  return !!c && c.cachedPages === true && c.cachedThumbnails === true
}

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
    dirs: dirs,
    command: command,
    sizes: sizes,
    clearPayload: clearPayload,
    cleared: cleared,
    format: format
  }
}
