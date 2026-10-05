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
const loaded = (id, n, o, mode) => R.reduce(R.open(5, chapters, id, mode || "paged-rtl"), { type: "pages", reply: pages(id, n, o), config });
const turn = (r, delta) => R.reduce(r, { type: "turn", delta });

test("the manga's own reading mode wins, then a long strip reads as webtoon, then the setting", () => {
  const manga = (o) => Object.assign({ id: 5, readingMode: "", longStrip: false }, o);
  assert.equal(R.mode(manga({ readingMode: "paged-ltr", longStrip: true }), "webtoon"), "paged-ltr");
  assert.equal(R.mode(manga({ longStrip: true }), "paged-ltr"), "webtoon");
  assert.equal(R.mode(manga(), "paged-ltr"), "paged-ltr");
  assert.equal(R.mode(manga(), "webtoon"), "webtoon");
  assert.equal(R.mode(manga({ readingMode: "sideways" }), undefined), "paged-rtl", "unknown values fall through to paged right-to-left");
});

test("h and l follow the screen: in right-to-left, left is the next page", () => {
  assert.equal(R.delta("paged-rtl", "left"), 1);
  assert.equal(R.delta("paged-rtl", "right"), -1);
  assert.equal(R.delta("paged-ltr", "left"), -1);
  assert.equal(R.delta("paged-ltr", "right"), 1);
});

test("opening a chapter asks for its pages, which load from the server", () => {
  const r = R.open(5, chapters, 12, "paged-rtl");
  assert.equal(r.state, "loading");
  assert.equal(R.chapterName(r), "Ch. 2");
  assert.deepEqual(R.pagesPayload(r).variables, { id: 12 });
  assert.equal(R.savePayload(r), null, "nothing saves before the pages are fetched: the server clamps to pageCount");
  const l = loaded(12, 3);
  assert.equal(l.state, "ok");
  assert.equal(l.pages[0], "http://127.0.0.1:4590/api/v1/manga/5/chapter/12/page/0");
  assert.equal(R.indicator(l), "1 / 3   right to left");
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

test("the save that first marks a chapter read asks the server to push progress to the trackers", () => {
  let r = R.reduce(loaded(12, 3, { lastPageRead: 1 }), { type: "saving" });
  assert.equal(R.trackPayload(r), null, "not before the chapter is read");
  r = turn(r, 1);
  const push = R.trackPayload(r);
  assert.match(push.query, /trackProgress\(input: \{ mangaId: \$id \}\)/);
  assert.deepEqual(push.variables, { id: 5 });
  r = R.reduce(r, { type: "saving" });
  assert.equal(R.trackPayload(turn(r, -1)), null, "only once per reading");
  assert.notEqual(R.trackPayload(R.reduce(r, { type: "save-failed", chapterId: 12 })), null, "a failed save pushes again with its retry");
  assert.equal(R.trackPayload(loaded(12, 3, { isRead: true })), null, "rereading a read chapter raises nothing");
  assert.equal(R.trackPayload(R.open(5, chapters, 12, "paged-rtl")), null, "nothing before the pages load");
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
  const r = R.open(5, chapters, 12, "paged-rtl");
  assert.equal(turn(r, 1), r);
});

test("a failed page fetch shows the problem and r fetches again", () => {
  const r = R.reduce(R.open(5, chapters, 12, "paged-rtl"), { type: "pages", reply: M.reply(0, ""), config });
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

test("m cycles the reading mode and saves it for the manga, keeping the page", () => {
  let r = Object.assign(loaded(12, 10), { page: 4 });
  r = R.reduce(r, { type: "mode" });
  assert.equal(r.mode, "paged-ltr");
  assert.equal(r.page, 4);
  assert.deepEqual(R.modePayload(r).variables, { meta: { mangaId: 5, key: "miharchy.readingMode", value: "paged-ltr" } });
  r = R.reduce(r, { type: "mode" });
  assert.equal(r.mode, "webtoon");
  assert.equal(R.indicator(r), "5 / 10   webtoon");
  assert.equal(R.reduce(r, { type: "mode" }).mode, "paged-rtl");
});

test("in webtoon the page is the one at the middle of the view, the last at the end of the strip", () => {
  const r = loaded(12, 10, { lastPageRead: 3 }, "webtoon");
  const scroll = (x, page, start, end) => R.reduce(x, { type: "scroll", page, start: !!start, end: !!end });
  assert.equal(scroll(r, 3), r, "an unchanged page changes nothing");
  const s = scroll(R.reduce(r, { type: "saving" }), 5);
  assert.equal(s.page, 5);
  assert.deepEqual(R.savePayload(s).variables, { id: 12, patch: { lastPageRead: 5 } });
  const end = scroll(s, 8, false, true);
  assert.equal(end.page, 9, "a short last page never reaches the middle");
  assert.deepEqual(R.savePayload(end).variables, { id: 12, patch: { lastPageRead: 9, isRead: true } });
  assert.equal(scroll(s, 1, true).page, 0);
  assert.equal(scroll(R.open(5, chapters, 12, "webtoon"), 2).page, 0, "no scroll counts before the pages load");
});

test("in webtoon, scrolling past the end of the strip opens the next chapter", () => {
  const web = loaded(12, 4, {}, "webtoon");
  const down = R.action(web, "reader.down", true, false);
  assert.deepEqual(down, { turn: 1, chapter: true });
  const next = R.reduce(web, Object.assign({ type: "turn", delta: 1 }, down));
  assert.equal(R.chapterName(next), "Ch. 3", "a strip that fits the view leaves from its first page");
  assert.equal(next.toEnd, false);
  const up = R.action(web, "reader.up", false, true);
  assert.deepEqual(up, { turn: -1, chapter: true });
  const back = R.reduce(Object.assign({}, web, { page: 2 }), Object.assign({ type: "turn", delta: -1 }, up));
  assert.equal(R.chapterName(back), "Ch. 1");
  assert.equal(back.toEnd, true, "the previous chapter opens at its end");
});

test("keys: paged turns by page, webtoon scrolls by part of the view", () => {
  const paged = loaded(12, 4);
  const web = loaded(12, 4, {}, "webtoon");
  assert.deepEqual(R.action(paged, "reader.down"), { turn: 1 });
  assert.deepEqual(R.action(paged, "reader.halfUp"), { turn: -1 });
  assert.deepEqual(R.action(paged, "reader.next"), { turn: 1 });
  assert.deepEqual(R.action(paged, "reader.left"), { turn: 1 }, "right-to-left: left is next");
  assert.deepEqual(R.action(web, "reader.down"), { scroll: 0.25 });
  assert.deepEqual(R.action(web, "reader.halfUp"), { scroll: -0.5 });
  assert.deepEqual(R.action(web, "reader.next"), { scroll: 0.9 });
  assert.equal(R.action(web, "reader.left"), null, "a strip has no sides");
});

test("with delete after read on, leaving a chapter this reading finished deletes its download", () => {
  const done = turn(turn(loaded(12, 3), 1), 1);
  assert.equal(done.read, true);
  const p = R.deletePayload(done, true);
  assert.match(p.query, /deleteDownloadedChapters/);
  assert.deepEqual(p.variables, { ids: [12] });
  assert.equal(R.deletePayload(done, false), null, "off by default");
  assert.equal(R.deletePayload(turn(loaded(12, 3), 1), true), null, "an unfinished chapter stays");
  assert.equal(R.deletePayload(loaded(12, 3, { isRead: true }), true), null, "a chapter read before stays when read again");
  assert.equal(R.deletePayload(R.open(5, chapters, 12, "paged-rtl"), true), null, "nothing before the pages load");
});

test("quitting waits for the reader's saves and deletes in flight, then quits once", () => {
  const quit = (s) => R.exit(s, "quit");
  assert.equal(R.canQuit(quit(R.EXIT)), true, "nothing in flight quits now");
  const busy = R.exit(R.exit(R.EXIT, "write"), "write");
  assert.equal(R.canQuit(busy), false, "a write before the quit does not quit");
  assert.equal(R.canQuit(R.exit(busy, "wrote")), false);
  const waiting = quit(R.exit(busy, "wrote"));
  assert.equal(R.canQuit(waiting), false, "the quit waits for the write in flight");
  assert.equal(R.canQuit(R.exit(waiting, "wrote")), true, "the last reply quits");
  assert.equal(quit(waiting), waiting, "a second quit changes nothing, so it quits once");
});
