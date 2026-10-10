.pragma library
.import "Model.js" as Model

// The reading card (GLOSSARY.md): chapters read in the last 7 days, manga in
// progress, the streak and a few covers, from History's own source
// (lastReadAt). Pure, so tests/readingcard.test.js pins it;
// ReadingCard.qml pages the query and draws the card.
//
// History's hidden and cleared cutoffs do not apply: hiding an entry takes
// it off the list, not off what the user read.

var DAY = 86400
var WEEK = 7 * DAY
var MONTH = 30 * DAY
var PAGE = 200

var PREFS = [{ key: "readingCardCovers", default: "shown", options: ["shown", "hidden"] }]

var QUERY = "query($after: Cursor) { chapters(filter: { isRead: { equalTo: true }, lastReadAt: { greaterThan: \"0\" } },"
  + " order: [{ by: LAST_READ_AT, byType: DESC }], first: " + PAGE + ", after: $after) {"
  + " pageInfo { hasNextPage endCursor } nodes { lastReadAt isRead manga { id thumbnailUrl inLibrary unreadCount } } } }"

function payload(after) {
  return { query: QUERY, variables: { after: after || null } }
}

// Reply data -> [{ at, mangaId, thumbnailUrl, inLibrary, unread }], at in
// epoch seconds, newest first as the query orders them.
function rows(data) {
  return ((data.chapters && data.chapters.nodes) || []).filter(function(c) { return c.isRead === true }).map(function(c) {
    return { at: Number(c.lastReadAt) || 0, mangaId: c.manga.id, thumbnailUrl: c.manga.thumbnailUrl || "", inLibrary: c.manga.inLibrary === true, unread: c.manga.unreadCount || 0 }
  })
}

// The local date of a time as a day number, so a daylight saving change
// never splits or merges two days.
function day(at) {
  var d = new Date(at * 1000)
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / (DAY * 1000))
}

// { streak, first }: the days in a row ending today, or yesterday when
// nothing is read yet today, and the first day of that run.
function streak(list, now) {
  var days = {}
  list.forEach(function(r) { days[day(r.at)] = true })
  var end = day(now)
  if (!days[end]) end--
  var d = end
  while (days[d]) d--
  return { streak: end - d, first: d + 1 }
}

// Whether to read the next page: until the 30 days are covered and the
// streak broke inside what is read. list: the rows of every page so far.
function more(list, pageInfo, now) {
  if (!pageInfo || !pageInfo.hasNextPage || !list.length) return false
  var oldest = list[list.length - 1].at
  return oldest >= now - MONTH || day(oldest) >= streak(list, now).first
}

var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function range(from, to) {
  var a = new Date(from * 1000)
  var b = new Date(to * 1000)
  var label = function(d) { return MONTHS[d.getMonth()] + " " + d.getDate() }
  if (a.getFullYear() === b.getFullYear()) return label(a) + " – " + label(b) + ", " + b.getFullYear()
  return label(a) + ", " + a.getFullYear() + " – " + label(b) + ", " + b.getFullYear()
}

// rows (all pages), now in epoch seconds -> what the card shows.
function card(list, now, config) {
  var week = list.filter(function(r) { return r.at > now - WEEK })
  var inProgress = {}
  list.forEach(function(r) {
    if (r.at > now - MONTH && r.inLibrary && r.unread > 0) inProgress[r.mangaId] = true
  })
  // Newest read first, so a tie keeps the manga read last.
  var counts = {}
  var order = []
  week.forEach(function(r) {
    if (!r.thumbnailUrl) return
    if (!counts[r.mangaId]) order.push(r)
    counts[r.mangaId] = (counts[r.mangaId] || 0) + 1
  })
  var covers = order.map(function(r, i) { return { r: r, i: i } })
    .sort(function(a, b) { return counts[b.r.mangaId] - counts[a.r.mangaId] || a.i - b.i })
    .slice(0, 3)
    .map(function(e) { return Model.coverUrl(config, e.r.thumbnailUrl) })
  return {
    chapters: week.length,
    inProgress: Object.keys(inProgress).length,
    streak: streak(list, now).streak,
    covers: covers,
    range: range(now - WEEK, now),
    line: week.length ? "" : "A quiet week. One chapter starts a streak."
  }
}

// Where S saves the card: the "Save pages to" folder, empty for
// ~/Pictures/Miharchy.
function target(folder, home, now) {
  var d = new Date(now * 1000)
  return { dir: folder || home + "/Pictures/Miharchy", name: "reading-card-" + d.getFullYear() + "-" + Model.pad(d.getMonth() + 1) + "-" + Model.pad(d.getDate()) + ".png" }
}

if (typeof module !== "undefined") {
  module.exports = {
    PREFS: PREFS,
    payload: payload,
    rows: rows,
    more: more,
    card: card,
    target: target
  }
}
