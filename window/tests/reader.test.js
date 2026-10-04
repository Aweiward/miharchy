const { test } = require("node:test");
const assert = require("node:assert/strict");
const R = require("./load")("Reader.js");
const M = require("./load")("Model.js");

const config = { url: "http://127.0.0.1:4590", username: "u", password: "p" };
const ok = (data) => M.reply(200, JSON.stringify({ data }));

// Newest first, as Browse.detail holds them.
const chapters = [
  { id: 13, name: "Ch. 3" },
  { id: 12, name: "Ch. 2" },
  { id: 11, name: "Ch. 1" }
];
const pages = (id, n, o) => ok({ fetchChapterPages: {
  pages: Array.from({ length: n }, (_, i) => "/api/v1/manga/5/chapter/" + id + "/page/" + i),
  chapter: Object.assign({ id, isRead: false, lastPageRead: 0 }, o)
} });
const loaded = (id, n, o, mode) => R.reduce(R.open(chapters, id, mode || "paged-rtl"), { type: "pages", reply: pages(id, n, o), config });
const turn = (r, delta) => R.reduce(r, { type: "turn", delta });

test("webtoon and unknown settings fall back to paged right-to-left until webtoon lands", () => {
  assert.equal(R.mode("paged-ltr"), "paged-ltr");
  assert.equal(R.mode("paged-rtl"), "paged-rtl");
  assert.equal(R.mode("webtoon"), "paged-rtl");
  assert.equal(R.mode(undefined), "paged-rtl");
});

test("h and l follow the screen: in right-to-left, left is the next page", () => {
  assert.equal(R.delta("paged-rtl", "left"), 1);
  assert.equal(R.delta("paged-rtl", "right"), -1);
  assert.equal(R.delta("paged-ltr", "left"), -1);
  assert.equal(R.delta("paged-ltr", "right"), 1);
});

test("opening a chapter asks for its pages, which load with credentials", () => {
  const r = R.open(chapters, 12, "paged-rtl");
  assert.equal(r.state, "loading");
  assert.equal(R.chapterName(r), "Ch. 2");
  assert.deepEqual(R.pagesPayload(r).variables, { id: 12 });
  assert.equal(R.savePayload(r), null, "nothing saves before the pages are fetched: the server clamps to pageCount");
  const l = loaded(12, 3);
  assert.equal(l.state, "ok");
  assert.equal(l.pages[0], "http://u:p@127.0.0.1:4590/api/v1/manga/5/chapter/12/page/0");
  assert.equal(R.indicator(l), "1 / 3");
  assert.equal(R.pagesPayload(l), null);
});

test("reopening resumes on the saved page; a read chapter starts over", () => {
  assert.equal(loaded(12, 10, { lastPageRead: 6 }).page, 6);
  assert.equal(loaded(12, 10, { lastPageRead: 40 }).page, 9, "clamped to the last page");
  assert.equal(loaded(12, 10, { lastPageRead: 9, isRead: true }).page, 0);
});

test("the first save after opening always goes out, so the chapter enters the history", () => {
  const r = loaded(12, 10, { lastPageRead: 6 });
  assert.deepEqual(R.savePayload(r).variables, { id: 12, patch: { lastPageRead: 6 } });
  const s = R.reduce(r, { type: "saving" });
  assert.equal(R.savePayload(s), null, "an unchanged page saves once");
  assert.deepEqual(R.savePayload(turn(s, 1)).variables, { id: 12, patch: { lastPageRead: 7 } });
});

test("the last page marks the chapter read, and nothing ever marks it unread", () => {
  let r = R.reduce(loaded(12, 3, { lastPageRead: 1 }), { type: "saving" });
  r = turn(r, 1);
  assert.deepEqual(R.savePayload(r).variables, { id: 12, patch: { lastPageRead: 2, isRead: true } });
  r = turn(R.reduce(r, { type: "saving" }), -1);
  assert.deepEqual(R.savePayload(r).variables, { id: 12, patch: { lastPageRead: 1, isRead: true } });
});

test("a failed save goes out again; a stale failure from another chapter does not", () => {
  const r = R.reduce(loaded(12, 3), { type: "saving" });
  assert.notEqual(R.savePayload(R.reduce(r, { type: "save-failed", chapterId: 12 })), null);
  assert.equal(R.savePayload(R.reduce(r, { type: "save-failed", chapterId: 11 })), null);
});

test("past the last page the next chapter opens where it was left", () => {
  const r = turn(loaded(12, 2, { lastPageRead: 1 }), 1);
  assert.equal(R.chapterName(r), "Ch. 3");
  assert.equal(r.state, "loading");
  assert.deepEqual(R.pagesPayload(r).variables, { id: 13 });
  assert.equal(R.reduce(r, { type: "pages", reply: pages(13, 4), config }).page, 0);
  assert.equal(R.reduce(r, { type: "pages", reply: pages(13, 4, { lastPageRead: 2 }), config }).page, 2);
});

test("before the first page the previous chapter opens at its last page", () => {
  const r = turn(loaded(12, 2), -1);
  assert.equal(R.chapterName(r), "Ch. 1");
  assert.equal(R.reduce(r, { type: "pages", reply: pages(11, 4), config }).page, 3);
});

test("the first and last chapters stop at their edge and say so", () => {
  const last = turn(loaded(13, 1), 1);
  assert.equal(R.chapterName(last), "Ch. 3");
  assert.equal(last.edge, "last");
  assert.equal(turn(last, -1).edge, "", "turning back clears the edge");
  assert.equal(turn(loaded(11, 2), -1).edge, "first");
});

test("turns wait while pages load", () => {
  const r = R.open(chapters, 12, "paged-rtl");
  assert.equal(turn(r, 1), r);
});

test("a failed page fetch shows the problem and r fetches again", () => {
  const r = R.reduce(R.open(chapters, 12, "paged-rtl"), { type: "pages", reply: M.reply(0, ""), config });
  assert.equal(r.state, "down");
  assert.equal(R.pagesPayload(r), null);
  assert.deepEqual(R.pagesPayload(R.reduce(r, { type: "retry" })).variables, { id: 12 });
  assert.equal(R.chapterName(turn(r, 1)), "Ch. 3", "a broken chapter can still be skipped");
});

test("six image slots hold the page shown, the next three and the previous two", () => {
  const r = Object.assign(loaded(12, 20), { page: 7 });
  const s = R.slots(r);
  assert.equal(s.length, 6);
  assert.deepEqual(s.map((x) => x.page).sort((a, b) => a - b), [5, 6, 7, 8, 9, 10]);
  assert.equal(s[R.slotOf(7)].page, 7);
  const next = R.slots(Object.assign({}, r, { page: 8 }));
  assert.deepEqual(next.map((x, i) => x.page === s[i].page), next.map((x) => x.page !== 11), "a turn reloads one slot only");
  const start = R.slots(Object.assign({}, r, { page: 0 }));
  assert.deepEqual(start.filter((x) => x.url).map((x) => x.page).sort((a, b) => a - b), [0, 1, 2, 3], "no slot outside the chapter");
});
