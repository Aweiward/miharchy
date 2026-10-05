.pragma library
.import "Model.js" as Model
.import "Chapters.js" as Chapters
.import "Settings.js" as Settings

// The reader: one chapter's pages, the page shown, and the read state to
// save. Pure, so tests/reader.test.js pins it; ReaderView.qml fetches pages,
// sends saves and feeds replies back through reduce().

var PAGES_MUTATION = "mutation($id: Int!) { fetchChapterPages(input: { chapterId: $id }) { pages chapter { id isRead lastPageRead } } }"
// Setting lastPageRead also stamps lastReadAt, which is what puts the
// chapter in the history; isRead alone does not.
var SAVE_MUTATION = "mutation($id: Int!, $patch: UpdateChapterPatchInput!) { updateChapter(input: { id: $id, patch: $patch }) { chapter { id isRead lastPageRead } } }"

// The page shown, the next three and the previous two.
var SLOTS = 6

function copy(o, changes) {
  var c = {}
  for (var k in o) c[k] = o[k]
  for (var j in changes) c[j] = changes[j]
  return c
}

var MODE_MUTATION = "mutation($meta: MangaMetaTypeInput!) { setMangaMeta(input: { meta: $meta }) { meta { key value } } }"
var MODE_KEY = "miharchy.readingMode"
// The order m cycles through.
var MODES = ["paged-rtl", "paged-ltr", "webtoon"]
var MODE_LABELS = { "paged-rtl": "right to left", "paged-ltr": "left to right", "webtoon": "webtoon" }

// Webtoon keys scroll by these parts of the view height; paged keys turn
// one page their way.
var SCROLL = { "reader.down": 0.25, "reader.up": -0.25, "reader.halfDown": 0.5, "reader.halfUp": -0.5, "reader.next": 0.9 }

// manga: Browse's { readingMode, longStrip }; setting: the
// miharchy.defaultReadingMode value. The manga's own choice wins, then a
// long strip reads as webtoon, then the setting.
function mode(manga, setting) {
  if (MODES.indexOf(manga.readingMode) !== -1) return manga.readingMode
  if (manga.longStrip) return "webtoon"
  return MODES.indexOf(setting) !== -1 ? setting : "paged-rtl"
}

// The keys follow the screen: in right-to-left the next page lies to the
// left, as in a Japanese book. side: "left" | "right" -> +1 next, -1 back.
function delta(readingMode, side) {
  return (side === "right") === (readingMode === "paged-ltr") ? 1 : -1
}

// reader.state: "loading" | "ok" | a failed connection state.
// chapters run oldest first; index is the chapter open. page counts from 0.
// read: the chapter is read on the server or reached its last page.
// wasRead: it was read on the server before it opened.
// saved: { page, read } last sent for this chapter, null until a save goes
// out. toEnd: entered backwards, so it opens on its last page.
// edge: "first" | "last" when a turn ran past the first or last chapter.
// transition: the transition page shown past either end, or null (see
// transition()).
function at(r, index, toEnd) {
  return copy(r, { index: index, toEnd: toEnd, state: "loading", message: "", pages: [], page: 0, read: false, wasRead: false, saved: null, edge: "", transition: null })
}

// Mihon's calculateChapterGap: how many whole chapter numbers lie between
// two chapters; 0 when either number is unknown (below 0).
function gap(higher, lower) {
  if (!higher || !lower || !(higher.number >= 0) || !(lower.number >= 0)) return 0
  return Math.max(0, Math.floor(higher.number) - Math.floor(lower.number) - 1)
}

// Mihon's chapter transition between the chapter open (from) and the one
// dir ("next" | "prev") leads to (to, null past either end). gap: the
// chapters missing between them; missing: to is not downloaded while
// offline, so its pages cannot load.
function transition(r, dir, offline) {
  var from = r.chapters[r.index]
  var to = r.chapters[r.index + (dir === "next" ? 1 : -1)] || null
  return { dir: dir, from: from, to: to, gap: dir === "next" ? gap(to, from) : gap(from, to), missing: to !== null && offline === true && !to.downloaded }
}

// always: the alwaysShowChapterTransition setting. Mihon also shows it at
// either end, and on a gap; here also when the chapter cannot load.
function showsTransition(t, always) {
  return always || t.to === null || t.gap > 0 || t.missing
}

// What the transition page says, top to bottom, as Mihon's: each chapter
// { label, chapter }, a warning { warning }, or { none } past either end.
function transitionLines(t) {
  var top = t.dir === "next" ? { label: "Finished", chapter: t.from } : { label: "Previous", chapter: t.to }
  var bottom = t.dir === "next" ? { label: "Next", chapter: t.to } : { label: "Current", chapter: t.from }
  var none = { none: t.dir === "next" ? "There's no next chapter" : "There's no previous chapter" }
  var lines = [top.chapter ? top : none]
  if (!bottom.chapter) return lines.concat([none])
  if (t.gap > 0) lines.push({ warning: t.gap === 1 ? "There is 1 missing chapter" : "There are " + t.gap + " missing chapters" })
  if (t.missing) lines.push({ warning: "You are offline and " + (t.dir === "next" ? "the next" : "the previous") + " chapter is not downloaded" })
  return lines.concat([bottom])
}

function move(r, delta) {
  if (delta > 0) return r.index + 1 < r.chapters.length ? at(r, r.index + 1, false) : copy(r, { edge: "last", transition: null })
  return r.index > 0 ? at(r, r.index - 1, true) : copy(r, { edge: "first", transition: null })
}

// chapters: newest first, as Chapters.readingOrder() hands them.
function open(mangaId, chapters, chapterId, readingMode) {
  var l = relist(chapters, chapterId)
  return at({ mangaId: mangaId, chapters: l.chapters, mode: readingMode }, l.index, false)
}

function relist(chapters, chapterId) {
  var list = chapters.slice().reverse().map(function(c) { return { id: c.id, name: c.name, url: c.url, number: c.number, downloaded: c.downloaded === true, scanlator: c.scanlator || "" } })
  var index = 0
  for (var i = 0; i < list.length; i++) if (list[i].id === chapterId) index = i
  return { chapters: list, index: index }
}

function chapterId(r) {
  return r.chapters[r.index].id
}

function chapterName(r) {
  return r.chapters[r.index].name
}

function pagesPayload(r) {
  return r.state === "loading" ? { query: PAGES_MUTATION, variables: { id: chapterId(r) } } : null
}

function last(r) {
  return r.pages.length - 1
}

// event.type:
//   "pages"        { reply, config } for the chapter open
//   "turn"         { delta, chapter?, always, offline } by one page; past
//                  either end, or at once with chapter, to the transition
//                  page (see showsTransition) or else the next or previous
//                  chapter. On the transition page a turn its way leaves
//                  the chapter, a turn back returns to the page.
//   "scroll"       { page, start, end } in webtoon: the page at the middle
//                  of the view, and whether the strip is at its top or end
//   "chapter"      { delta } to the next or previous chapter, where it
//                  was left (Mihon's chapter buttons)
//   "goto"         { page } in the chapter, clamped; NaN goes nowhere
//   "mode"         the next reading mode
//   "saving"       savePayload() went out
//   "save-failed"  { chapterId }
//   "retry"        fetch the pages again after a failure
//   "chapters"     { chapters } newest first: the list again, once the
//                  manga's chapter choices load; the chapter open stays
function reduce(r, event) {
  switch (event.type) {
    case "pages":
      if (event.reply.state !== "ok") return copy(r, { state: event.reply.state, message: event.reply.message })
      var f = event.reply.data.fetchChapterPages
      var pages = (f.pages || []).map(function(p) { return Model.coverUrl(event.config, p) })
      if (!pages.length) return copy(r, { state: "error", message: "This chapter has no pages." })
      var c = f.chapter
      var page = r.toEnd ? pages.length - 1 : c.isRead ? 0 : Math.max(0, Math.min(pages.length - 1, c.lastPageRead || 0))
      return copy(r, { state: "ok", pages: pages, page: page, read: c.isRead === true || page === pages.length - 1, wasRead: c.isRead === true })
    case "turn":
      if (r.state === "loading") return r
      var dir = event.delta > 0 ? "next" : "prev"
      if (r.transition) return r.transition.dir === dir ? move(r, event.delta) : copy(r, { transition: null })
      var p = event.chapter ? -1 : r.page + event.delta
      if (r.state === "ok" && p >= 0 && p <= last(r)) return copy(r, { page: p, read: r.read || p === last(r), edge: "" })
      var t = transition(r, dir, event.offline)
      if (r.state === "ok" && showsTransition(t, event.always)) return copy(r, { transition: t, edge: "" })
      return move(r, event.delta)
    case "scroll":
      if (r.state !== "ok") return r
      // A last page shorter than half the view never reaches the middle.
      var shown = event.end ? last(r) : event.start ? 0 : Math.max(0, Math.min(last(r), event.page))
      // The transition page stays while the strip stays at its end.
      var stays = r.transition !== null && (r.transition.dir === "next" ? event.end : event.start)
      if (shown === r.page && (stays || !r.transition)) return r
      return copy(r, { page: shown, read: r.read || shown === last(r), edge: "", transition: stays ? r.transition : null })
    case "chapter":
      var i = r.index + event.delta
      if (i < 0) return copy(r, { edge: "first" })
      return i < r.chapters.length ? at(r, i, false) : copy(r, { edge: "last" })
    case "goto":
      if (r.state !== "ok" || isNaN(event.page)) return r
      var g = Math.max(0, Math.min(last(r), event.page))
      return copy(r, { page: g, read: r.read || g === last(r), edge: "", transition: null })
    case "mode":
      return copy(r, { mode: MODES[(MODES.indexOf(r.mode) + 1) % MODES.length] })
    case "saving":
      return copy(r, { saved: { page: r.page, read: r.read } })
    case "save-failed":
      return event.chapterId === chapterId(r) ? copy(r, { saved: null }) : r
    case "chapters":
      var l = relist(event.chapters, chapterId(r))
      return copy(r, { chapters: l.chapters, index: l.index, transition: null })
    case "retry":
      return r.state === "loading" || r.state === "ok" ? r : copy(r, { state: "loading", message: "" })
  }
  return r
}

// The read state to save, or null before the pages load (the server clamps
// lastPageRead to a page count it only knows then) or when nothing changed.
// isRead only ever turns on.
function savePayload(r) {
  if (r.state !== "ok") return null
  if (r.saved && r.saved.page === r.page && r.saved.read === r.read) return null
  var patch = { lastPageRead: r.page }
  if (r.read) patch.isRead = true
  return { query: SAVE_MUTATION, variables: { id: chapterId(r), patch: patch } }
}

// The tracker push due after savePayload()'s reply: only for the save that
// first marks the chapter read. Take it before "saving" records the save.
function trackPayload(r) {
  if (r.state !== "ok" || !r.read || r.wasRead || (r.saved && r.saved.read)) return null
  return Chapters.trackPayload([r.mangaId])
}

// Mihon's delete after reading: once the chapter open is read here, the
// chapter slots back in reading order may go (0: this one; -1: off), the
// rules of Downloads.autoDeletePayload permitting. Asked as the reader
// leaves the chapter, so its pages stay on disk while it shows. -> a
// chapter id, or null.
function deleteTarget(r, slots) {
  if (slots < 0 || r.state !== "ok" || !r.read || r.wasRead) return null
  var c = r.chapters[r.index - slots]
  return c ? c.id : null
}

function modePayload(r) {
  return { query: MODE_MUTATION, variables: { meta: { mangaId: r.mangaId, key: MODE_KEY, value: r.mode } } }
}

// What a reader key does: { turn: delta } | { scroll: part of the view } |
// null. atEnd, atStart: whether the page (paged) or the strip (webtoon) is
// at its bottom or top. A scroll key scrolls until that edge, then turns:
// a page taller than the view reads down first. In webtoon the turn leaves
// the chapter, since the page at either end is the first or the last.
function action(r, id, atEnd, atStart) {
  var side = { "reader.left": "left", "reader.right": "right" }[id]
  // On the transition page every key that reads on or back turns at once.
  if (r.transition) {
    var d = side ? (r.mode === "webtoon" ? 0 : delta(r.mode, side)) : SCROLL[id] ? (SCROLL[id] > 0 ? 1 : -1) : 0
    return d ? { turn: d } : null
  }
  if (side) return r.mode === "webtoon" ? null : { turn: delta(r.mode, side) }
  if (!SCROLL[id]) return null
  var forward = SCROLL[id] > 0
  if (!(forward ? atEnd : atStart)) return { scroll: SCROLL[id] }
  return r.mode === "webtoon" ? { turn: forward ? 1 : -1, chapter: true } : { turn: forward ? 1 : -1 }
}

// Where a click on the reader lands, as the key command it stands for,
// or null. x, y: the click; w, h: the reader's size. Paged follows
// Mihon's default pager navigation (RightAndLeftNavigation): the left
// third is reader.left and the right third reader.right, so the reading
// direction decides the turn as it does for h and l. Webtoon follows
// Mihon's default L layout: the top third and the left of the middle
// scroll back, the bottom third and the right of the middle scroll on.
// The middle opens Mihon's menu; Miharchy has none, so it does nothing.
function tapZone(readingMode, x, y, w, h) {
  var fx = x / w
  var fy = y / h
  if (readingMode !== "webtoon") return fx < 0.33 ? "reader.left" : fx >= 0.66 ? "reader.right" : null
  if (fy < 0.33 || (fy < 0.66 && fx < 0.33)) return "reader.halfUp"
  if (fy >= 0.66 || fx >= 0.66) return "reader.halfDown"
  return null
}

// A paged wheel moves one notch (120 in Qt's angleDelta) at a time; a
// touchpad sends small deltas that add up. acc: the delta not used yet.
// Returns { steps, acc }: steps > 0 reads on, < 0 back.
function wheel(acc, dy) {
  var total = acc + dy
  var notches = total < 0 ? Math.ceil(total / 120) : Math.floor(total / 120)
  return { steps: -notches || 0, acc: total - notches * 120 }
}

// The go-to field's text -> a page index, NaN for no number.
function pageNumber(text) {
  return parseInt(String(text).trim(), 10) - 1
}

// How a paged page fits the view: the pageFit setting's values, as Mihon's
// image scale types. Stretch and smart fit are left out.
var FIT_LABELS = { screen: "fit screen", width: "fit width", height: "fit height", original: "original size" }

// fit: a pageFit value; page: the image's size so far (0 while it loads),
// read for its aspect, and for its size in original; view: the reader's.
// -> the size shown, and the decode size: one side only, 0 for free, so
// the image keeps its own aspect and a guess made while it loads never
// sticks.
function fit(mode, page, view) {
  var known = page.width > 0 && page.height > 0
  var w = known ? page.width : 1
  var h = known ? page.height : 1.4
  var byWidth = view.width / w
  var byHeight = view.height / h
  if (mode === "original") return known ? { width: w, height: h, sourceWidth: 0, sourceHeight: 0 } : { width: view.width, height: view.width * h, sourceWidth: 0, sourceHeight: 0 }
  var side = mode === "width" || (mode !== "height" && byWidth <= byHeight) ? "width" : "height"
  var scale = side === "width" ? byWidth : byHeight
  return { width: w * scale, height: h * scale, sourceWidth: side === "width" ? view.width : 0, sourceHeight: side === "height" ? view.height : 0 }
}

// The webtoonWidth setting: a percent of the window's width (Mihon's side
// padding, the other way round).
function stripWidth(percent, windowWidth) {
  return Math.round(windowWidth * Number(percent) / 100)
}

// The value dir steps to from value in a choice row's options, stopping at
// either end.
function step(options, value, dir) {
  var values = options.map(function(o) { return o.value })
  return values[Math.max(0, Math.min(values.length - 1, values.indexOf(value) + dir))]
}

// The settings panel (s), Mihon's reader settings sheet: the manga's own
// reading mode, then the Settings rows the reader reads, which apply to
// every manga. A later reader setting is one more key here.
var PANEL_KEYS = ["pageFit", "webtoonWidth", "readerTheme", "keepScreenOn", "alwaysShowChapterTransition", "skipRead", "skipFiltered", "skipDupe"]

// The readerTheme setting -> the reader's background; themeColor for
// "theme". Gray is Mihon's ReaderGrayBackgroundColor.
function background(readerTheme, themeColor) {
  return { black: "#000000", gray: "#202125", white: "#ffffff" }[readerTheme] || themeColor
}

function settingRow(key) {
  return Settings.ROWS.filter(function(row) { return row.key === key })[0]
}

// values: the Settings values. -> [{ key, label, text, manga }], manga true
// for the row stored in the manga's meta.
function panelRows(r, values) {
  return [{ key: "readingMode", label: "Reading mode", text: MODE_LABELS[r.mode], manga: true }].concat(PANEL_KEYS.map(function(key) {
    var row = settingRow(key)
    return { key: key, label: row.label, text: Settings.display(row, values[key]), manga: false }
  }))
}

function slotOf(page) {
  return (page % SLOTS + SLOTS) % SLOTS
}

// What each image slot holds: { page, url }, url "" outside the chapter.
// A page keeps its slot while it stays in the window, so a turn loads one
// image and the rest stay decoded.
function slots(r) {
  var out = []
  for (var p = r.page - 2; p <= r.page + 3; p++) out[slotOf(p)] = { page: p, url: r.pages[p] || "" }
  return out
}

// Quitting the window waits for the saves and deletes in flight: a process
// that exits first can drop the request. event: "write" | "wrote" | "quit".
var EXIT = { quitting: false, writes: 0 }

function exit(s, event) {
  if (event === "quit") return s.quitting ? s : copy(s, { quitting: true })
  return copy(s, { writes: s.writes + (event === "write" ? 1 : -1) })
}

function canQuit(s) {
  return s.quitting && s.writes === 0
}

// fit, width: the pageFit and webtoonWidth settings.
function indicator(r, fit, width) {
  if (r.state !== "ok") return ""
  var shape = r.mode === "webtoon" ? width + "%" : FIT_LABELS[fit]
  return (r.page + 1) + " / " + r.pages.length + "   " + MODE_LABELS[r.mode] + (shape ? "   " + shape : "")
}

if (typeof module !== "undefined") {
  module.exports = {
    SLOTS: SLOTS,
    mode: mode,
    delta: delta,
    open: open,
    chapterId: chapterId,
    chapterName: chapterName,
    pagesPayload: pagesPayload,
    reduce: reduce,
    savePayload: savePayload,
    trackPayload: trackPayload,
    deleteTarget: deleteTarget,
    modePayload: modePayload,
    action: action,
    tapZone: tapZone,
    wheel: wheel,
    pageNumber: pageNumber,
    fit: fit,
    stripWidth: stripWidth,
    step: step,
    gap: gap,
    transition: transition,
    showsTransition: showsTransition,
    transitionLines: transitionLines,
    PANEL_KEYS: PANEL_KEYS,
    background: background,
    settingRow: settingRow,
    panelRows: panelRows,
    slotOf: slotOf,
    slots: slots,
    EXIT: EXIT,
    exit: exit,
    canQuit: canQuit,
    indicator: indicator
  }
}
