.pragma library

// Crop borders (GLOSSARY.md): the plain margin around a page, found in
// its pixels. ReaderView draws the page small into a Canvas and hands the
// RGBA bytes here; Auto levels (#281) reads the same pass.

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

// A rect in pixels -> { x, y, width, height } in fractions of the page.
function share(c, w, h) {
  return c && { x: c.x0 / w, y: c.y0 / h, width: (c.x1 - c.x0) / w, height: (c.y1 - c.y0) / h }
}

// data: RGBA bytes of a page drawn width x height. -> { width, height,
// page: the box paged shows, strip: the box webtoon shows (left and right
// only), halves: [left, right] each half's box for a wide page, else null }.
// A box is { x, y, width, height } in fractions of the whole page, null to
// show it whole.
function analyze(data, width, height) {
  var luma = luminance(data)
  var all = { x0: 0, y0: 0, x1: width, y1: height }
  var mid = Math.floor(width / 2)
  return {
    width: width,
    height: height,
    page: share(crop(luma, width, all, false), width, height),
    strip: share(crop(luma, width, all, true), width, height),
    halves: width > height ? [
      share(crop(luma, width, { x0: 0, y0: 0, x1: mid, y1: height }, false), width, height),
      share(crop(luma, width, { x0: mid, y0: 0, x1: width, y1: height }, false), width, height)
    ] : null
  }
}

if (typeof module !== "undefined") {
  module.exports = { analyze: analyze, luminance: luminance }
}
