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

// dir: where the files go, with a trailing slash. pid: this process's, so
// a later window can tell whose files these are (sweep). now() -> ms.
function cache(dir, pid, idleBytes, maxAge, now) {
  // An earlier window with this PID may have left files: the random part
  // keeps a new one's names apart from them.
  var prefix = dir + pid + "-" + Math.random().toString(36).slice(2) + "-"
  return { prefix: prefix, idleBytes: idleBytes, maxAge: maxAge, now: now, seq: 0, entries: {}, idle: [], idleSize: 0, written: {} }
}

var processCache = null

// This process's cache: .pragma library keeps one copy per process.
function shared(dir, pid) {
  if (!processCache) processCache = cache(dir, pid, IDLE_BYTES, MAX_AGE, Date.now)
  return processCache
}

// A window that crashes or is killed leaves its files behind. A new window
// lists the dir and the running processes with this command, and sweep()
// picks the files to remove. Lines: "f <mtime s> <name>" for each regular
// file directly in dir, "b <boot time s>", "t <clock ticks per s>", and
// "p <pid> <start, ticks since boot>" for each running process.
function sweepCommand(dir) {
  return ["sh", "-c",
    "find \"$1\" -mindepth 1 -maxdepth 1 -type f -printf 'f %Ts %f\\n'\n" +
    "while read -r k v _; do [ \"$k\" = btime ] && echo \"b $v\"; done < /proc/stat\n" +
    "echo \"t $(getconf CLK_TCK)\"\n" +
    "for s in /proc/[0-9]*/stat; do read -r l 2>/dev/null < \"$s\" || continue; p=${s#/proc/}; l=${l##*) }; set -- $l; echo \"p ${p%/stat} ${20}\"; done",
    "sh", dir]
}

// The paths in dir to remove, from sweepCommand's output: files with no
// PID in their name (older builds), files whose process is gone, and files
// older than their process, whose PID a new process took. selfPid's files
// always stay.
function sweep(text, dir, selfPid) {
  var files = [], start = {}, boot = 0, tick = 100
  text.split("\n").forEach(function(line) {
    var m = /^(f|b|t|p) (\S+)(?: (.+))?$/.exec(line)
    if (!m) return
    if (m[1] === "f") files.push({ mtime: Number(m[2]), name: m[3] })
    else if (m[1] === "b") boot = Number(m[2])
    else if (m[1] === "t") tick = Number(m[2])
    else start[m[2]] = Number(m[3])
  })
  return files.filter(function(f) {
    var m = /^(\d+)-/.exec(f.name)
    if (!m) return true
    if (m[1] === String(selfPid)) return false
    if (!(m[1] in start)) return true
    // A minute's slack: a clock set forward after a window starts moves its
    // computed start past the files it wrote first.
    return f.mtime < boot + start[m[1]] / tick - 60
  }).map(function(f) { return dir + f.name })
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
  module.exports = { IDLE_BYTES: IDLE_BYTES, MAX_AGE: MAX_AGE, cache: cache, hold: hold, release: release, drain: drain, sweepCommand: sweepCommand, sweep: sweep }
}
