.pragma library
.import "Prefs.js" as Prefs
.import "Library.js" as Library
.import "Browse.js" as Browse
.import "Chapters.js" as Chapters
.import "History.js" as History

// Up next (GLOSSARY.md): the library manga a peek offers, each with its
// next chapter, in tiers. Derived from read state each time; nothing is
// stored. Pure, so tests/upnext.test.js pins it; shell.qml peek() sends
// payload() and opens the head of list(), or for the next key after().

// ponytail: fixed; Settings rows if they turn out wrong.
var CLOSE_UNREAD = 5
var FRESH_DAYS = 7

function payload() {
  return {
    query: "query($keys: [String!]) { metas(filter: { key: { in: $keys } }) { nodes { key value } }"
      + " mangas(condition: { inLibrary: true }) { nodes { id title inLibraryAt source { id } meta { key value }"
      + " chapters { nodes { id name chapterNumber uploadDate isRead isBookmarked lastPageRead pageCount isDownloaded scanlator sourceOrder lastReadAt fetchedAt } } } } }",
    variables: { keys: Prefs.keys(Library.CHAPTER_PREFS).concat([History.CLEARED_KEY]) }
  }
}

// data: payload()'s reply. -> [{ mangaId, chapterId, tier, title, chapter,
// page, pages, unread, update }], the head first. tier: 1 partly read, 2
// close to caught up, 3 a fresh update. page: the next chapter's
// lastPageRead, pages its page count (0 when the server has none yet);
// unread: what the filters leave; update: the newest shown update's
// fetchedAt in seconds, 0 for none. The popup's reasons read these.
function list(data, downloadedOnly, now) {
  var tiers = [[], [], []]
  var freshSince = now / 1000 - FRESH_DAYS * 86400
  var cleared = History.metaValue(data.metas && data.metas.nodes, History.CLEARED_KEY)
  ;((data.mangas && data.mangas.nodes) || []).forEach(function(m) {
    if (!m.source) return
    var prefs = Library.chapterPrefs({ metas: data.metas, manga: m }, downloadedOnly)
    var shown = Chapters.apply(Browse.toChapters(m.chapters.nodes), prefs)
    var next = Chapters.nextUnread(shown, prefs)
    if (!next) return
    var ids = {}
    shown.forEach(function(c) { ids[c.id] = true })
    var newest = function(field, keep) {
      return m.chapters.nodes.filter(keep).reduce(function(at, c) { return Math.max(at, Number(c[field]) || 0) }, 0)
    }
    var lastRead = newest("lastReadAt", function() { return true })
    // A shown update, as Updates.recent() has it: fetched after the manga joined the library.
    var update = newest("fetchedAt", function(c) { return !c.isRead && ids[c.id] && Number(c.fetchedAt) > Number(m.inLibraryAt) })
    var unread = shown.filter(function(c) { return !c.read }).length
    // A manga hidden on History counts as never read, as on History.
    var hidden = lastRead > 0 && lastRead <= Math.max(cleared, History.metaValue(m.meta, History.HIDDEN_KEY))
    var started = !hidden && (lastRead > 0 || shown.some(function(c) { return c.read }))
    var tier = started && next.lastPage > 0 ? 0 : started && unread <= CLOSE_UNREAD ? 1 : update > freshSince ? 2 : -1
    if (tier === -1) return
    var pages = Number(m.chapters.nodes.filter(function(c) { return c.id === next.id })[0].pageCount) || 0
    tiers[tier].push({
      at: tier === 2 ? update : lastRead,
      entry: { mangaId: m.id, chapterId: next.id, tier: tier + 1, title: String(m.title || ""), chapter: next.name, page: next.lastPage, pages: Math.max(0, pages), unread: unread, update: update }
    })
  })
  var out = []
  tiers.forEach(function(t) {
    t.sort(function(a, b) { return b.at - a.at }).forEach(function(e) { out.push(e.entry) })
  })
  return out
}

// The next key's pick from list(): the manga after mangaId (the reader's,
// null with the reader closed, which counts as the head) in order, the
// manga ids of Up next when the run of next presses began, wrapping from
// the last to the head. Opening a chapter moves its manga to the head of
// list(), so a fresh list would only ever offer the previous one. A manga
// that left Up next since is skipped. A manga not in order gives the head
// of list; an empty list gives undefined.
function after(list, order, mangaId) {
  var i = mangaId === null ? 0 : order.indexOf(mangaId)
  if (i === -1) return list[0]
  for (var k = 1; k <= order.length; k++) {
    var id = order[(i + k) % order.length]
    var e = list.filter(function(x) { return x.mangaId === id })[0]
    if (e) return e
  }
  return list[0]
}

if (typeof module !== "undefined") {
  module.exports = {
    payload: payload,
    list: list,
    after: after
  }
}
