.pragma library
.import "Model.js" as Model

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
// saved: { page, read } last sent for this chapter, null until a save goes
// out. toEnd: entered backwards, so it opens on its last page.
// edge: "first" | "last" when a turn ran past the first or last chapter.
function at(r, index, toEnd) {
  return copy(r, { index: index, toEnd: toEnd, state: "loading", message: "", pages: [], page: 0, read: false, saved: null, edge: "" })
}

// chapters: newest first, as Browse.detail holds them.
function open(mangaId, chapters, chapterId, readingMode) {
  var list = chapters.slice().reverse().map(function(c) { return { id: c.id, name: c.name } })
  var index = 0
  for (var i = 0; i < list.length; i++) if (list[i].id === chapterId) index = i
  return at({ mangaId: mangaId, chapters: list, mode: readingMode }, index, false)
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
//   "turn"         { delta, chapter? } by one page; past either end, or
//                  at once with chapter, to the next or previous chapter
//   "scroll"       { page, start, end } in webtoon: the page at the middle
//                  of the view, and whether the strip is at its top or end
//   "mode"         the next reading mode
//   "saving"       savePayload() went out
//   "save-failed"  { chapterId }
//   "retry"        fetch the pages again after a failure
function reduce(r, event) {
  switch (event.type) {
    case "pages":
      if (event.reply.state !== "ok") return copy(r, { state: event.reply.state, message: event.reply.message })
      var f = event.reply.data.fetchChapterPages
      var pages = (f.pages || []).map(function(p) { return Model.coverUrl(event.config, p) })
      if (!pages.length) return copy(r, { state: "error", message: "This chapter has no pages." })
      var c = f.chapter
      var page = r.toEnd ? pages.length - 1 : c.isRead ? 0 : Math.max(0, Math.min(pages.length - 1, c.lastPageRead || 0))
      return copy(r, { state: "ok", pages: pages, page: page, read: c.isRead === true || page === pages.length - 1 })
    case "turn":
      if (r.state === "loading") return r
      var p = event.chapter ? -1 : r.page + event.delta
      if (r.state === "ok" && p >= 0 && p <= last(r)) return copy(r, { page: p, read: r.read || p === last(r), edge: "" })
      if (event.delta > 0) return r.index + 1 < r.chapters.length ? at(r, r.index + 1, false) : copy(r, { edge: "last" })
      return r.index > 0 ? at(r, r.index - 1, true) : copy(r, { edge: "first" })
    case "scroll":
      if (r.state !== "ok") return r
      // A last page shorter than half the view never reaches the middle.
      var shown = event.end ? last(r) : event.start ? 0 : Math.max(0, Math.min(last(r), event.page))
      return shown === r.page ? r : copy(r, { page: shown, read: r.read || shown === last(r), edge: "" })
    case "mode":
      return copy(r, { mode: MODES[(MODES.indexOf(r.mode) + 1) % MODES.length] })
    case "saving":
      return copy(r, { saved: { page: r.page, read: r.read } })
    case "save-failed":
      return event.chapterId === chapterId(r) ? copy(r, { saved: null }) : r
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

function modePayload(r) {
  return { query: MODE_MUTATION, variables: { meta: { mangaId: r.mangaId, key: MODE_KEY, value: r.mode } } }
}

// What a reader key does: { turn: delta } | { scroll: part of the view } |
// null. In webtoon a key past the top or end of the strip turns, which
// leaves the chapter, since the page there is the first or the last.
function action(r, id, atEnd, atStart) {
  var side = { "reader.left": "left", "reader.right": "right" }[id]
  if (r.mode !== "webtoon") return side ? { turn: delta(r.mode, side) } : SCROLL[id] ? { turn: SCROLL[id] > 0 ? 1 : -1 } : null
  if (side || !SCROLL[id]) return null
  if (SCROLL[id] > 0 ? atEnd : atStart) return { turn: SCROLL[id] > 0 ? 1 : -1, chapter: true }
  return { scroll: SCROLL[id] }
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

function indicator(r) {
  return r.state === "ok" ? (r.page + 1) + " / " + r.pages.length + "   " + MODE_LABELS[r.mode] : ""
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
    modePayload: modePayload,
    action: action,
    slotOf: slotOf,
    slots: slots,
    indicator: indicator
  }
}
