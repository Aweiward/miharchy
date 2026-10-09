.pragma library

// Crop borders (GLOSSARY.md): the plain margin around a page, found in
// its pixels, and Auto levels: the black and white points of the part a
// mode shows. ReaderView draws the page small into a Canvas and hands the
// RGBA bytes here.

// A margin is no deeper than a quarter of the page on any side, and a crop
// that keeps less than this share of the area leaves the page whole: a
// mostly white text page stays as it is.
var MAX_SIDE = 0.25
var MIN_KEPT = 0.6
// Near white and near black, in luminance. A line of the margin may have
// this share of other pixels: grain and specks of a scan.
var WHITE = 220
var BLACK = 35
var NOISE = 0.05
// Auto levels: at most this share of the pixels turns black, and as much
// white. A part whose points lie further apart than NARROW is left as it
// is, and so is a flat one (closer than FLAT): a blank page or plain
// paper, where a stretch would only show the grain.
var CLIP = 0.005
var NARROW = 204
var FLAT = 64

// RGBA bytes -> one luminance byte per pixel (Rec. 601).
function luminance(data) {
  var n = data.length / 4
  var out = new Uint8Array(n)
  for (var i = 0; i < n; i++) out[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000
  return out
}

function kind(v) {
  return v >= WHITE ? 1 : v <= BLACK ? 2 : 0
}

// How many lines from one edge of the rect r are plain in one color: the
// edge line sets the color. horizontal: rows from the top (step 1) or the
// bottom (step -1); else columns from the left or the right.
function depth(luma, w, r, horizontal, step) {
  var lines = horizontal ? r.y1 - r.y0 : r.x1 - r.x0
  var across = horizontal ? r.x1 - r.x0 : r.y1 - r.y0
  var cap = Math.floor(lines * MAX_SIDE)
  var color = -1
  for (var d = 0; d < cap; d++) {
    var line = step > 0 ? (horizontal ? r.y0 : r.x0) + d : (horizontal ? r.y1 : r.x1) - 1 - d
    var count = [0, 0, 0]
    for (var a = 0; a < across; a++) {
      var x = horizontal ? r.x0 + a : line
      var y = horizontal ? line : r.y0 + a
      count[kind(luma[y * w + x])]++
    }
    if (color < 0) color = count[1] >= count[2] ? 1 : 2
    if (across - count[color] > across * NOISE) return d
  }
  return cap
}

// The part of rect r without its margins: left and right, then the top and
// bottom between them unless sides only. -> a rect, or null when there is
// nothing to crop or the crop would keep too little.
function crop(luma, w, r, sidesOnly) {
  var x0 = r.x0 + depth(luma, w, r, false, 1)
  var x1 = r.x1 - depth(luma, w, r, false, -1)
  var inner = { x0: x0, x1: x1, y0: r.y0, y1: r.y1 }
  var y0 = sidesOnly ? r.y0 : r.y0 + depth(luma, w, inner, true, 1)
  var y1 = sidesOnly ? r.y1 : r.y1 - depth(luma, w, inner, true, -1)
  var kept = (x1 - x0) * (y1 - y0) / ((r.x1 - r.x0) * (r.y1 - r.y0))
  if (kept === 1 || kept < MIN_KEPT) return null
  return { x0: x0, y0: y0, x1: x1, y1: y1 }
}

// The black and white points of rect r: a luminance histogram, up to
// CLIP of it off each end. -> { black, white } in 0..255, or null to leave
// the part as it is.
function levels(luma, w, r) {
  var hist = new Uint32Array(256)
  for (var y = r.y0; y < r.y1; y++) for (var x = r.x0; x < r.x1; x++) hist[luma[y * w + x]]++
  var clip = (r.x1 - r.x0) * (r.y1 - r.y0) * CLIP
  var black = 0, white = 255, s = 0
  while (s + hist[black] <= clip) s += hist[black++]
  for (s = 0; s + hist[white] <= clip;) s += hist[white--]
  return white - black > NARROW || white - black < FLAT ? null : { black: black, white: white }
}

// Levels -> MultiEffect's contrast and brightness for the linear stretch
// that maps black to 0 and white to 1, the same for all three channels.
// Its shader draws (v - 0.5) * (1 + contrast) + 0.5 + brightness, and Qt
// 6.11 does not clamp contrast to its documented -1..1. null: no effect.
function effect(l) {
  if (!l) return null
  var gain = 255 / (l.white - l.black)
  return { contrast: gain - 1, brightness: gain * (0.5 - l.black / 255) - 0.5 }
}

// A rect in pixels -> { x, y, width, height } in fractions of the page.
function share(c, w, h) {
  return c && { x: c.x0 / w, y: c.y0 / h, width: (c.x1 - c.x0) / w, height: (c.y1 - c.y0) / h }
}

// data: RGBA bytes of a page drawn width x height. -> { width, height,
// page: the box paged shows, strip: the box webtoon shows (left and right
// only), halves: [left, right] each half's box for a wide page, else null,
// levels: { page, strip, halves } the levels() inside each box }. A box is
// { x, y, width, height } in fractions of the whole page, null to show it
// whole. Levels read the box with Crop borders off too: a margin is no
// part of the art.
function analyze(data, width, height) {
  var luma = luminance(data)
  var mid = Math.floor(width / 2)
  function part(r, sidesOnly) {
    var c = crop(luma, width, r, sidesOnly)
    return { box: share(c, width, height), levels: levels(luma, width, c || r) }
  }
  var all = { x0: 0, y0: 0, x1: width, y1: height }
  var page = part(all, false)
  var strip = part(all, true)
  var halves = width > height ? [part({ x0: 0, y0: 0, x1: mid, y1: height }, false), part({ x0: mid, y0: 0, x1: width, y1: height }, false)] : null
  var of = function(key) { return halves && halves.map(function(h) { return h[key] }) }
  return {
    width: width,
    height: height,
    page: page.box,
    strip: strip.box,
    halves: of("box"),
    levels: { page: page.levels, strip: strip.levels, halves: of("levels") }
  }
}

if (typeof module !== "undefined") {
  module.exports = { analyze: analyze, luminance: luminance, effect: effect }
}
