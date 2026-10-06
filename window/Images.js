.pragma library

// One fetched copy of each server image per process (#215). ServerImage
// instances hold a copy by URL: the first hold fetches, a hold while the
// fetch is in flight waits on it, and a hold on a copy already written
// shows it at once. A copy no instance holds stays idle until the idle
// copies pass IDLE_BYTES, oldest first out, so a delegate rebuilt by a model
// change or a scroll finds its cover still there. The runtime dir is RAM:
// the bound caps what idles, and the reader's pages never idle.
//
// Each fetch writes a new file name, and the pixmap cache is keyed by the
// file URL, so new bytes never show under an old decode. A copy older than
// MAX_AGE is fetched again on the next hold: a cover the server refreshed
// shows within that time.
//
// A holder is the instance: show(file, contentType), fail(),
// write(file, data) -> whether the bytes landed, empty(file). This module
// decides; the holder does the file work.

// About 50 covers at the 2.6 MB a MangaDex cover measured (#215): one
// Library screen and its cache buffer hold 33, so a rebuilt grid finds
// every cover.
var IDLE_BYTES = 128 * 1024 * 1024
var MAX_AGE = 10 * 60 * 1000

// dir: where the files go, with a trailing slash. now() -> ms.
function cache(dir, idleBytes, maxAge, now) {
  // Files left by an earlier window stay in the dir: a random prefix per
  // process keeps a new one's names apart from them.
  var prefix = dir + Math.random().toString(36).slice(2) + "-"
  return { prefix: prefix, idleBytes: idleBytes, maxAge: maxAge, now: now, seq: 0, entries: {}, idle: [], idleSize: 0, written: {} }
}

var processCache = null

// This process's cache: .pragma library keeps one copy per process.
function shared(dir) {
  if (!processCache) processCache = cache(dir, IDLE_BYTES, MAX_AGE, Date.now)
  return processCache
}

function current(c, e) {
  return c.entries[e.url] === e
}

function empty(c, holder, file) {
  delete c.written[file]
  holder.empty(file)
}

function unidle(c, e) {
  var i = c.idle.indexOf(e)
  if (i < 0) return false
  c.idle.splice(i, 1)
  c.idleSize -= e.bytes
  return true
}

// holder takes url's copy. fetch(url, done) asks the server, done({ status,
// data, contentType }), and runs only when no copy is held, idle or in
// flight. Returns the copy, which release() takes back.
function hold(c, url, holder, fetch) {
  var e = c.entries[url]
  if (e && e.file && c.now() - e.at > c.maxAge) {
    delete c.entries[url]
    if (unidle(c, e)) empty(c, holder, e.file)
    e = null
  }
  if (e) {
    unidle(c, e)
    e.holders.push(holder)
    if (e.file) holder.show(e.file, e.contentType)
    return e
  }
  e = { url: url, holders: [holder], file: "", contentType: "", bytes: 0, at: 0 }
  c.entries[url] = e
  fetch(url, function(r) { arrive(c, e, r) })
  return e
}

function arrive(c, e, r) {
  var holders = e.holders
  var file = c.prefix + ++c.seq
  // With no holder left the bytes go nowhere, written by no one.
  if (r.status !== 200 || !holders.length || !holders[0].write(file, r.data)) {
    delete c.entries[e.url]
    e.holders = []
    holders.forEach(function(h) { h.fail() })
    return
  }
  c.written[file] = true
  e.file = file
  e.contentType = r.contentType || ""
  e.bytes = (r.data && r.data.byteLength) || 0
  e.at = c.now()
  holders.slice().forEach(function(h) { h.show(file, e.contentType) })
}

// holder lets go of e. It is still alive, so it empties the files that
// leave the cache. idle: whether the copy may stay idle once no one holds
// it; the reader's pages may not, so a read keeps only the pages it shows.
function release(c, e, holder, idle) {
  var i = e.holders.indexOf(holder)
  if (i < 0) return
  e.holders.splice(i, 1)
  if (e.holders.length || !e.file) return
  if (!current(c, e)) return empty(c, holder, e.file)
  if (!idle) {
    delete c.entries[e.url]
    return empty(c, holder, e.file)
  }
  c.idle.push(e)
  c.idleSize += e.bytes
  while (c.idleSize > c.idleBytes) {
    var old = c.idle.shift()
    c.idleSize -= old.bytes
    delete c.entries[old.url]
    empty(c, holder, old.file)
  }
}

// The files still holding bytes, for the window to empty as it quits:
// instances are not destroyed on the way out. c: this process's cache by
// default. The cache is spent after this.
function drain(c) {
  c = c || processCache
  if (!c) return []
  var files = Object.keys(c.written)
  c.written = {}
  return files
}

if (typeof module !== "undefined") {
  module.exports = { IDLE_BYTES: IDLE_BYTES, MAX_AGE: MAX_AGE, cache: cache, hold: hold, release: release, drain: drain }
}
