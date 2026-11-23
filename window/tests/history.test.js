const { test } = require("node:test");
const assert = require("node:assert/strict");
const H = require("./load")("History.js");
const M = require("./load")("Model.js");

const config = { url: "http://127.0.0.1:4591", secret: "c0ffee" };
const ok = (data) => M.coreReply(200, JSON.stringify(data));
const sec = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime() / 1000;

const manga = (id, hiddenAt) => ({
  id,
  title: "Manga " + id,
  thumbnailUrl: "/api/cover/" + id,
  meta: hiddenAt === undefined ? [{ key: "miharchy.readingMode", value: "webtoon" }] : [{ key: "miharchy.historyHiddenAt", value: String(hiddenAt) }]
});
const chapter = (id, mangaId, at, o) => Object.assign(
  { id, name: "Ch. " + id, lastReadAt: String(at), lastPageRead: 4, pageCount: 20, isRead: false, manga: manga(mangaId) },
  o
);
const reply = (nodes, clearedAt) => ok({
  metas: { nodes: clearedAt === undefined ? [] : [{ value: String(clearedAt) }] },
  chapters: { nodes }
});
const loaded = (nodes, clearedAt) => H.reduce(H.initial(), { type: "reply", reply: reply(nodes, clearedAt), config });

test("one entry per manga, its most recent chapter, in the server's order", () => {
  const h = loaded([chapter(31, 3, 300), chapter(12, 1, 250), chapter(30, 3, 200), chapter(11, 1, 100)]);
  assert.equal(h.state, "ok");
  assert.deepEqual(h.entries.map((e) => [e.mangaId, e.chapterId, e.at]), [[3, 31, 300], [1, 12, 250]]);
  const e = h.entries[0];
  assert.equal(e.title, "Manga 3");
  assert.equal(e.chapter, "Ch. 31");
  assert.equal(e.cover, "http://127.0.0.1:4591/api/cover/3");
  assert.equal(e.page, 4);
  assert.equal(e.pages, 20);
  assert.equal(e.read, false);
});

test("a removed manga hides until a chapter of it opens after the removal", () => {
  const hidden = (id, mangaId, at, cut) => chapter(id, mangaId, at, { manga: manga(mangaId, cut) });
  const h = loaded([chapter(21, 2, 400), hidden(31, 3, 300, 300), hidden(30, 3, 200, 300), chapter(11, 1, 100)]);
  assert.deepEqual(h.entries.map((e) => e.mangaId), [2, 1]);
  const back = loaded([hidden(31, 3, 301, 300), chapter(11, 1, 100)]);
  assert.deepEqual(back.entries.map((e) => e.chapterId), [31, 11], "opening it again brings it back");
});

test("clearing hides everything opened up to then; what opens later shows", () => {
  const h = loaded([chapter(21, 2, 400), chapter(31, 3, 300), chapter(11, 1, 100)], 300);
  assert.deepEqual(h.entries.map((e) => e.mangaId), [2]);
});

test("a failed reply keeps the shown entries and reports the problem", () => {
  const h = loaded([chapter(31, 3, 300)]);
  const down = H.reduce(h, { type: "reply", reply: M.coreReply(0, ""), config });
  assert.equal(down.state, "down");
  assert.equal(down.entries.length, 1);
  assert.equal(H.reduce(down, { type: "request" }).state, "loading");
});

test("progress shows the page reached, or read", () => {
  assert.equal(H.progress({ page: 4, pages: 20, read: false }), "page 5 / 20");
  assert.equal(H.progress({ page: 0, pages: -1, read: false }), "page 1");
  assert.equal(H.progress({ page: 19, pages: 20, read: true }), "read");
});

test("entries group by day: today, yesterday, then the date; each shows its time", () => {
  const now = sec(2026, 10, 4, 12, 0);
  assert.equal(H.day(sec(2026, 10, 4, 0, 5), now), "Today");
  assert.equal(H.day(sec(2026, 10, 3, 23, 59), now), "Yesterday");
  assert.equal(H.day(sec(2026, 9, 28, 9, 0), now), "2026-09-28");
  assert.equal(H.time(sec(2026, 10, 4, 9, 7)), "09:07");
});

test("a notice for an empty or failed history, none while entries show", () => {
  assert.equal(H.notice(H.initial(), "core.json", "").title, "Loading the history");
  assert.equal(H.notice(H.reduce(loaded([chapter(31, 3, 300)]), { type: "config-missing" }), "core.json", "").title, "No miharchy-core config");
  assert.equal(H.notice(loaded([]), "core.json", "").title, "No history yet");
  assert.equal(H.notice(loaded([chapter(31, 3, 300)]), "core.json", ""), null);
  assert.equal(H.notice(H.reduce(H.initial(), { type: "reply", reply: M.coreReply(401, JSON.stringify({ error: { kind: "unauthorized", message: "secret" } })), config }), "core.json", "").title, "miharchy-core rejected the secret");
});

test("the search keeps the entries whose manga title holds it, ignoring case", () => {
  const h = loaded([chapter(31, 3, 300), chapter(12, 12, 200), chapter(51, 5, 100)]);
  assert.deepEqual(H.search(h.entries, "manga 1").map((e) => e.mangaId), [12]);
  assert.deepEqual(H.search(h.entries, "  MANGA ").map((e) => e.mangaId), [3, 12, 5], "trimmed, any case");
  assert.deepEqual(H.search(h.entries, ""), h.entries, "no search, every entry");
  assert.equal(H.notice(h, "core.json", "manga 3"), null);
  assert.deepEqual(H.notice(h, "core.json", "nothing "), { title: "No history matches \"nothing\"", detail: "Esc clears the search." });
  assert.equal(H.notice(loaded([]), "core.json", "x").title, "No history yet", "an empty history says so, search or not");
});
