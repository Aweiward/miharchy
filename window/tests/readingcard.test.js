process.env.TZ = "America/New_York";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const C = require("./load")("ReadingCard.js");

const config = { url: "http://127.0.0.1:4590", username: "u", password: "p" };
const sec = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi || 0).getTime() / 1000;
// Friday 2026-10-09 22:00 in New York.
const now = sec(2026, 10, 9, 22);

const manga = (id, o) => Object.assign({ id, title: "Manga " + id, thumbnailUrl: "/api/v1/manga/" + id + "/thumbnail", inLibrary: true, unreadCount: 2 }, o);
const chapter = (id, at, m, o) => Object.assign({ id, lastReadAt: String(at), isRead: true, manga: m || manga(1) }, o);
const rows = (nodes) => C.rows({ chapters: { nodes } });
const card = (nodes, at) => C.card(rows(nodes), at === undefined ? now : at, config);

test("the query pages finished chapters, newest read first", () => {
  const p = C.payload("abc");
  assert.match(p.query, /isRead: \{ equalTo: true \}/);
  assert.match(p.query, /by: LAST_READ_AT, byType: DESC/);
  assert.match(p.query, /pageInfo \{ hasNextPage endCursor \}/);
  assert.equal(p.variables.after, "abc");
  assert.equal(C.payload().variables.after, null);
});

test("chapters counts finished chapters read in the last 7 days, rolling", () => {
  const c = card([
    chapter(1, now - 60),
    chapter(2, now - 7 * 86400 + 60),
    chapter(3, now - 7 * 86400 - 60),
    chapter(4, now - 3600, manga(1), { isRead: false })
  ]);
  assert.equal(c.chapters, 2);
});

test("manga in progress: in the library, a read and an unread chapter, read in the last 30 days", () => {
  const c = card([
    chapter(1, now - 3600, manga(1)),
    chapter(2, now - 7200, manga(1)),
    chapter(3, now - 29 * 86400, manga(2)),
    chapter(4, now - 3600, manga(3, { unreadCount: 0 })),
    chapter(5, now - 3600, manga(4, { inLibrary: false })),
    chapter(6, now - 31 * 86400, manga(5))
  ]);
  assert.equal(c.inProgress, 2);
});

test("the streak counts days in a row ending today", () => {
  const c = card([chapter(1, sec(2026, 10, 9, 8)), chapter(2, sec(2026, 10, 8, 12)), chapter(3, sec(2026, 10, 7, 12)), chapter(4, sec(2026, 10, 5, 12))]);
  assert.equal(c.streak, 3);
});

test("with nothing read yet today the streak ends yesterday", () => {
  assert.equal(card([chapter(1, sec(2026, 10, 8, 12)), chapter(2, sec(2026, 10, 7, 12))]).streak, 2);
});

test("a streak that ended before yesterday is 0", () => {
  assert.equal(card([chapter(1, sec(2026, 10, 7, 12)), chapter(2, sec(2026, 10, 6, 12))]).streak, 0);
});

test("reads either side of midnight are two days", () => {
  assert.equal(card([chapter(1, sec(2026, 10, 9, 0, 1)), chapter(2, sec(2026, 10, 8, 23, 59))]).streak, 2);
  assert.equal(card([chapter(1, sec(2026, 10, 9, 0, 1)), chapter(2, sec(2026, 10, 9, 0, 0))]).streak, 1);
});

test("days are local dates", () => {
  // 2026-10-09 02:00 UTC is 2026-10-08 22:00 in New York.
  const c = card([chapter(1, Date.UTC(2026, 9, 9, 2) / 1000), chapter(2, sec(2026, 10, 7, 12))], sec(2026, 10, 9, 10));
  assert.equal(c.streak, 2);
});

test("a streak runs through a daylight saving change", () => {
  // New York leaves daylight saving time on 2026-11-01.
  const at = sec(2026, 11, 2, 20);
  assert.equal(card([chapter(1, sec(2026, 11, 2, 9)), chapter(2, sec(2026, 11, 1, 9)), chapter(3, sec(2026, 10, 31, 9))], at).streak, 3);
});

test("covers: the manga with the most chapters read in the last 7 days, ties to the newest read, at most 3", () => {
  const c = card([
    chapter(1, now - 100, manga(1)),
    chapter(2, now - 200, manga(2)),
    chapter(3, now - 300, manga(2)),
    chapter(4, now - 400, manga(3)),
    chapter(5, now - 500, manga(4, { thumbnailUrl: null })),
    chapter(6, now - 600, manga(4, { thumbnailUrl: null })),
    chapter(7, now - 700, manga(5)),
    chapter(8, now - 8 * 86400, manga(3)),
    chapter(9, now - 8 * 86400, manga(3))
  ]);
  assert.deepEqual(c.covers, [2, 1, 3].map((id) => config.url + "/api/v1/manga/" + id + "/thumbnail"));
});

test("an empty week still makes a card, with a friendly line", () => {
  const c = card([]);
  assert.deepEqual([c.chapters, c.inProgress, c.streak, c.covers], [0, 0, 0, []]);
  assert.ok(c.line.length > 0);
  assert.equal(card([chapter(1, now - 60)]).line, "");
});

test("the date range is the 7 days", () => {
  assert.equal(card([]).range, "Oct 2 – Oct 9, 2026");
  assert.equal(card([], sec(2027, 1, 3, 12)).range, "Dec 27, 2026 – Jan 3, 2027");
});

test("paging goes on until the 30 days are covered and the streak broke", () => {
  const page = (...nodes) => rows(nodes);
  const next = { hasNextPage: true, endCursor: "x" };
  assert.equal(C.more(page(chapter(1, now - 60)), next, now), true, "inside 30 days");
  assert.equal(C.more(page(chapter(1, now - 60)), { hasNextPage: false }, now), false, "no more pages");
  assert.equal(C.more(page(chapter(1, now - 60), chapter(2, now - 31 * 86400)), next, now), false, "covered, streak broke");
  // Read every day for 40 days: the streak may go on in the next page.
  const daily = Array.from({ length: 40 }, (_, i) => chapter(i, sec(2026, 10, 9 - i, 12)));
  assert.equal(C.more(page(...daily), next, now), true, "streak still running");
  assert.equal(C.more(page(...daily, chapter(99, sec(2026, 8, 20, 12))), next, now), false, "streak broke past 30 days");
  assert.equal(C.more(page(), next, now), false, "an empty page");
});

test("a later page adds to the streak", () => {
  const first = rows(Array.from({ length: 3 }, (_, i) => chapter(i, sec(2026, 10, 9 - i, 12))));
  const second = rows([chapter(9, sec(2026, 10, 6, 12)), chapter(10, sec(2026, 10, 4, 12))]);
  assert.equal(C.card(first.concat(second), now, config).streak, 4);
});

test("paging reads the streak from every page so far", () => {
  const first = rows(Array.from({ length: 3 }, (_, i) => chapter(i, sec(2026, 10, 9 - i, 12))));
  const second = rows(Array.from({ length: 37 }, (_, i) => chapter(10 + i, sec(2026, 10, 6 - i, 12))));
  assert.equal(C.more(first.concat(second), { hasNextPage: true }, now), true);
});

test("c on History opens the card; on the card Esc closes it and S, Y, h act", () => {
  const K = require("./load")("Commands.js");
  const press = (view, text, key) => K.dispatch({ view }, { key: key || text.toUpperCase().charCodeAt(0), text, ctrl: false });
  assert.equal(press("history", "c"), "readingCard.open");
  assert.equal(press("reading-card", "", K.KEY.Escape), "readingCard.close");
  assert.equal(press("reading-card", "q"), "readingCard.close");
  assert.deepEqual(["S", "Y", "h"].map((k) => press("reading-card", k)), ["readingCard.save", "readingCard.copy", "readingCard.covers"]);
  assert.ok(K.paletteRows("reading card").some((c) => c.id === "readingCard.open"));
});

test("the card saves as reading-card-<date>.png in the pages folder", () => {
  assert.deepEqual(C.target("", "/home/u", now), { dir: "/home/u/Pictures/Miharchy", name: "reading-card-2026-10-09.png" });
  assert.deepEqual(C.target("/tmp/p", "/home/u", sec(2026, 1, 2, 0, 30)), { dir: "/tmp/p", name: "reading-card-2026-01-02.png" });
});
