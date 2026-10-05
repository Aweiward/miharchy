const { test } = require("node:test");
const assert = require("node:assert/strict");
const R = require("./load")("Reader.js");
const M = require("./load")("Model.js");

const config = { url: "http://127.0.0.1:4590", username: "u", password: "p" };
const ok = (data) => M.reply(200, JSON.stringify({ data }));

// Newest first, as Browse.detail holds them.
const chapters = [
  { id: 13, name: "Ch. 3" },
  { id: 12, name: "Ch. 2", url: "https://example.org/c/2" },
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
  assert.equal(r.chapters[r.index].url, "https://example.org/c/2", "o and y in the reader act on this link");
  assert.deepEqual(R.pagesPayload(r).variables, { id: 12 });
  assert.equal(R.savePayload(r), null, "nothing saves before the pages are fetched: the server clamps to pageCount");
  const l = loaded(12, 3);
  assert.equal(l.state, "ok");
  assert.equal(l.pages[0], "http://127.0.0.1:4590/api/v1/manga/5/chapter/12/page/0");
  assert.equal(R.indicator(l, "screen", "60"), "1 / 3   right to left   fit screen");
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
  assert.match(push.query, /trackProgress\(input: \{ mangaId: 5 \}\)/);
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

test("past the last or first chapter the transition page says there is none; a turn on stops at the edge and says so", () => {
  const end = turn(loaded(13, 1), 1);
  assert.equal(end.transition.to, null);
  assert.deepEqual(R.transitionLines(end.transition), [{ label: "Finished", chapter: end.chapters[2] }, { none: "There's no next chapter" }]);
  const last = turn(end, 1);
  assert.equal(R.chapterName(last), "Ch. 3");
  assert.equal(last.edge, "last");
  assert.equal(last.transition, null);
  assert.equal(turn(last, -1).edge, "", "turning back clears the edge");
  const start = turn(loaded(11, 2), -1);
  assert.deepEqual(R.transitionLines(start.transition), [{ none: "There's no previous chapter" }, { label: "Current", chapter: start.chapters[0] }]);
  assert.equal(turn(start, -1).edge, "first");
});

// Newest first, numbered, as Browse.detail holds them: chapter 3 is missing.
const numbered = [
  { id: 24, name: "Ch. 4", url: "u4", number: 4, downloaded: false, scanlator: "Kumo" },
  { id: 22, name: "Ch. 2", url: "u2", number: 2, downloaded: true, scanlator: "Kumo" },
  { id: 21, name: "Ch. 1", url: "u1", number: 1, downloaded: false, scanlator: "" }
];
const onLast = (id, n) => R.reduce(R.open(5, numbered, id, "paged-ltr"), { type: "pages", reply: pages(id, n), config });
const readOn = (r, o) => R.reduce(r, Object.assign({ type: "turn", delta: 1 }, o));

test("with always show on, turning past the last page shows the finished and the next chapter; a turn back returns to the page, a turn on opens the next", () => {
  const r = R.reduce(onLast(21, 2), { type: "goto", page: 1 });
  const t = readOn(r, { always: true, offline: false });
  assert.equal(t.index, r.index, "still in the chapter");
  assert.equal(t.page, 1);
  assert.deepEqual(R.transitionLines(t.transition), [
    { label: "Finished", chapter: { id: 21, name: "Ch. 1", url: "u1", number: 1, downloaded: false, scanlator: "" } },
    { label: "Next", chapter: { id: 22, name: "Ch. 2", url: "u2", number: 2, downloaded: true, scanlator: "Kumo" } }
  ]);
  const back = R.reduce(t, { type: "turn", delta: -1 });
  assert.equal(back.transition, null);
  assert.equal(back.page, 1);
  const next = readOn(t, {});
  assert.equal(R.chapterId(next), 22);
  assert.equal(next.state, "loading");
  assert.equal(next.transition, null);
});

test("with always show off, the reader goes straight on unless the numbers skip a chapter or the next one cannot load", () => {
  const r = R.reduce(onLast(21, 2), { type: "goto", page: 1 });
  assert.equal(R.chapterId(readOn(r, { always: false, offline: false })), 22, "no gap: straight on");
  assert.equal(R.chapterId(readOn(r, { always: false, offline: true })), 22, "offline but downloaded: straight on");
  const gap = readOn(R.reduce(onLast(22, 2), { type: "goto", page: 1 }), { always: false, offline: false });
  assert.equal(gap.transition.gap, 1);
  assert.deepEqual(R.transitionLines(gap.transition).map((l) => l.warning || l.label), ["Finished", "There is 1 missing chapter", "Next"]);
  const offline = readOn(R.reduce(onLast(22, 2), { type: "goto", page: 1 }), { always: false, offline: true });
  assert.deepEqual(R.transitionLines(offline.transition).map((l) => l.warning || l.label), ["Finished", "There is 1 missing chapter", "You are offline and the next chapter is not downloaded", "Next"]);
});

test("going back past the first page shows the previous and the current chapter, with the gap between them", () => {
  const t = R.reduce(onLast(24, 3), { type: "turn", delta: -1, always: false, offline: false });
  assert.deepEqual(R.transitionLines(t.transition).map((l) => l.warning || l.label), ["Previous", "There is 1 missing chapter", "Current"]);
  const prev = R.reduce(t, { type: "turn", delta: -1 });
  assert.equal(R.chapterId(prev), 22);
  assert.equal(prev.toEnd, true, "the previous chapter opens on its last page");
});

test("the chapter gap is Mihon's: whole numbers between, none when a number is unknown", () => {
  assert.equal(R.gap({ number: 5 }, { number: 2 }), 2);
  assert.equal(R.gap({ number: 3.5 }, { number: 2.1 }), 0);
  assert.equal(R.gap({ number: 5 }, { number: -1 }), 0);
  assert.equal(R.gap({ number: 2 }, { number: 2 }), 0, "a duplicate is no gap");
  assert.equal(R.gap(null, { number: 1 }), 0);
});

test("] and [ skip the transition page, and a go-to leaves it", () => {
  const t = readOn(R.reduce(onLast(21, 2), { type: "goto", page: 1 }), { always: true });
  assert.equal(R.chapterId(R.reduce(t, { type: "chapter", delta: 1 })), 22);
  assert.equal(R.reduce(t, { type: "goto", page: 0 }).transition, null);
});

test("on the transition page every key that reads on or back turns; in webtoon the strip's end keeps it", () => {
  const t = readOn(R.reduce(onLast(21, 2), { type: "goto", page: 1 }), { always: true });
  assert.deepEqual(R.action(t, "reader.down", false, false), { turn: 1 }, "j turns at once, wherever the page is");
  assert.deepEqual(R.action(t, "reader.halfUp", false, false), { turn: -1 });
  assert.deepEqual(R.action(t, "reader.right", false, false), { turn: 1 }, "left to right: right reads on");
  const w = Object.assign({}, t, { mode: "webtoon" });
  assert.equal(R.action(w, "reader.left", true, false), null, "h and l do nothing in webtoon");
  assert.equal(R.reduce(w, { type: "scroll", page: 1, start: false, end: true }), w, "at the end the page stays");
  assert.equal(R.reduce(w, { type: "scroll", page: 1, start: false, end: false }).transition, null, "scrolling up leaves it");
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
  assert.equal(r.mode, "paged-vertical");
  assert.equal(R.indicator(r, "screen", "60"), "5 / 10   vertical   fit screen");
  r = R.reduce(r, { type: "mode" });
  assert.equal(r.mode, "webtoon");
  assert.equal(R.indicator(r, "screen", "60"), "5 / 10   webtoon   60%");
  r = R.reduce(r, { type: "mode" });
  assert.equal(r.mode, "continuous-vertical");
  assert.equal(R.indicator(r, "screen", "60"), "5 / 10   continuous vertical   60%");
  assert.equal(R.reduce(r, { type: "mode" }).mode, "paged-rtl");
});

test("vertical pages: j and k turn a page that fits, h back and l on, clicks in Mihon's L layout", () => {
  const v = loaded(12, 5, {}, "paged-vertical");
  assert.equal(R.strip("paged-vertical"), false);
  assert.deepEqual(R.action(v, "reader.down", true, true), { turn: 1 });
  assert.deepEqual(R.action(v, "reader.up", true, true), { turn: -1 });
  assert.deepEqual(R.action(v, "reader.down", false, true), { scroll: 0.25 }, "a page taller than the view scrolls first");
  assert.deepEqual(R.action(v, "reader.left"), { turn: -1 });
  assert.deepEqual(R.action(v, "reader.right"), { turn: 1 });
  assert.equal(R.tapZone("paged-vertical", 500, 900, 1000, 1000), "reader.halfDown");
  assert.equal(R.tapZone("paged-vertical", 500, 100, 1000, 1000), "reader.halfUp");
  assert.equal(R.stripGap("paged-vertical"), 0);
});

test("continuous vertical is the strip with a gap under each page; webtoon has none", () => {
  const c = loaded(12, 4, {}, "continuous-vertical");
  assert.equal(R.strip("continuous-vertical"), true);
  assert.ok(R.stripGap("continuous-vertical") > 0);
  assert.equal(R.stripGap("webtoon"), 0);
  assert.deepEqual(R.action(c, "reader.down"), { scroll: 0.25 });
  assert.equal(R.action(c, "reader.left"), null, "a strip has no sides");
  assert.deepEqual(R.action(c, "reader.down", true, false), { turn: 1, chapter: true }, "the strip's end leaves the chapter");
  assert.equal(R.mode({ readingMode: "continuous-vertical" }, "paged-rtl"), "continuous-vertical", "the manga's choice holds");
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
  assert.deepEqual(R.action(paged, "reader.down", true, true), { turn: 1 }, "a page that fits the view turns at once");
  assert.deepEqual(R.action(paged, "reader.halfUp", true, true), { turn: -1 });
  assert.deepEqual(R.action(paged, "reader.next", true, true), { turn: 1 });
  assert.deepEqual(R.action(paged, "reader.left"), { turn: 1 }, "right-to-left: left is next");
  assert.deepEqual(R.action(web, "reader.down"), { scroll: 0.25 });
  assert.deepEqual(R.action(web, "reader.halfUp"), { scroll: -0.5 });
  assert.deepEqual(R.action(web, "reader.next"), { scroll: 0.9 });
  assert.equal(R.action(web, "reader.left"), null, "a strip has no sides");
});

test("leaving a chapter this reading finished lets the chapter that many slots back in reading order go", () => {
  const done = turn(turn(loaded(13, 3), 1), 1);
  assert.equal(done.read, true);
  assert.equal(R.deleteTarget(done, 0), 13, "the last read chapter: this one");
  assert.equal(R.deleteTarget(done, 1), 12, "second to last");
  assert.equal(R.deleteTarget(done, 2), 11);
  assert.equal(R.deleteTarget(done, 3), null, "no chapter that far back");
  assert.equal(R.deleteTarget(done, -1), null, "off");
  assert.equal(R.deleteTarget(turn(loaded(13, 3), 1), 0), null, "an unfinished chapter lets none go");
  assert.equal(R.deleteTarget(loaded(13, 3, { isRead: true }), 0), null, "a chapter read before lets none go when read again");
  assert.equal(R.deleteTarget(R.open(5, chapters, 13, "paged-rtl"), 0), null, "nothing before the pages load");
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

test("a paged page taller than the view scrolls before it turns", () => {
  const paged = loaded(12, 4);
  assert.deepEqual(R.action(paged, "reader.down", false, true), { scroll: 0.25 }, "at its top, j scrolls down");
  assert.deepEqual(R.action(paged, "reader.next", false, true), { scroll: 0.9 }, "Space scrolls too");
  assert.deepEqual(R.action(paged, "reader.up", false, true), { turn: -1 }, "at its top, k turns back");
  assert.deepEqual(R.action(paged, "reader.halfDown", true, false), { turn: 1 }, "at its bottom, d turns on");
  assert.deepEqual(R.action(paged, "reader.halfUp", true, false), { scroll: -0.5 });
  assert.deepEqual(R.action(paged, "reader.right", false, false), { turn: -1 }, "h and l always turn");
});

test("each fit sizes the page from its own aspect and the view", () => {
  const view = { width: 1600, height: 1000 };
  const tall = { width: 800, height: 1200 };
  const wide = { width: 2000, height: 1000 };
  assert.deepEqual(R.fit("screen", tall, view), { width: 800 * (1000 / 1200), height: 1000, sourceWidth: 0, sourceHeight: 1000 });
  assert.deepEqual(R.fit("screen", wide, view), { width: 1600, height: 800, sourceWidth: 1600, sourceHeight: 0 });
  assert.deepEqual(R.fit("width", tall, view), { width: 1600, height: 2400, sourceWidth: 1600, sourceHeight: 0 }, "fit width runs past the bottom");
  assert.deepEqual(R.fit("height", wide, view), { width: 2000, height: 1000, sourceWidth: 0, sourceHeight: 1000 }, "fit height runs past the sides");
  assert.deepEqual(R.fit("original", tall, view), { width: 800, height: 1200, sourceWidth: 0, sourceHeight: 0 }, "original decodes at the natural size");
  const unknown = R.fit("width", { width: 0, height: 0 }, view);
  assert.equal(unknown.sourceWidth, 1600, "a page still loading decodes at the view's width");
  assert.ok(unknown.height > 0, "and takes room meanwhile");
  assert.equal(R.fit("sideways", tall, view).height, 1000, "an unknown fit reads as fit screen");
});

test("the webtoon strip is a share of the window's width, in steps", () => {
  assert.equal(R.stripWidth("60", 2000), 1200);
  assert.equal(R.stripWidth("100", 2000), 2000);
  const options = ["30", "40", "50"].map((value) => ({ value }));
  assert.equal(R.step(options, "40", 1), "50");
  assert.equal(R.step(options, "50", 1), "50", "the widest step stays");
  assert.equal(R.step(options, "30", -1), "30", "the narrowest step stays");
  assert.equal(R.step(options, "40", -1), "30");
});

test("the indicator names the fit in paged and the width in webtoon", () => {
  const r = loaded(12, 3);
  assert.equal(R.indicator(r, "width", "60"), "1 / 3   right to left   fit width");
  assert.equal(R.indicator(Object.assign({}, r, { mode: "webtoon" }), "width", "60"), "1 / 3   webtoon   60%");
  assert.equal(R.indicator(r, "width", "60", 2), "1 / 3   right to left   fit width   zoom 200%");
  assert.equal(R.indicator(r, "width", "60", 1), "1 / 3   right to left   fit width", "no zoom, no word");
});

test("zoom scales the fitted page and decodes it at that size; + and - step, stopping at either end", () => {
  const view = { width: 1600, height: 1000 };
  const tall = { width: 800, height: 1200 };
  const one = R.fit("screen", tall, view);
  const two = R.fit("screen", tall, view, 2);
  assert.deepEqual([two.width, two.height, two.sourceHeight], [one.width * 2, one.height * 2, one.sourceHeight * 2]);
  assert.deepEqual(R.fit("original", tall, view, 1.5), { width: 1200, height: 1800, sourceWidth: 0, sourceHeight: 0 });
  assert.equal(R.zoomStep(1, 1), 1.25);
  assert.equal(R.zoomStep(1, -1), 1, "no zoom out past the fit");
  assert.equal(R.zoomStep(4, 1), 4);
  assert.equal(R.zoomStep(2, -1), 1.5);
});

test("a zoom keeps the middle of the view on the same spot, inside the content", () => {
  assert.equal(R.zoomedAt(0, 1000, 1000, 2000), 500, "a page as wide as the view: its middle stays the middle");
  assert.equal(R.zoomedAt(0, 1000, 600, 1800), 400, "a centred page smaller than the view: its middle stays the middle");
  assert.equal(R.zoomedAt(1500, 1000, 4000, 2000), 500, "zoomed out, the spot at 2000 moves to 1000");
  assert.equal(R.zoomedAt(0, 1000, 2000, 600), -150, "a page that shrinks below the view sits in its middle again; within() takes it to 0");
  assert.equal(R.within(-20, 0, 2000, 1000), 0);
  assert.equal(R.within(1500, 0, 2000, 1000), 1000);
  assert.equal(R.within(300, 0, 800, 1000), 0, "content smaller than the view stays put");
  assert.equal(R.within(-50, -100, 2000, 1000), -50, "a ListView's origin counts");
});

test("h and l pan a page wider than the view before they turn, as Mihon's navigate to pan", () => {
  const r = loaded(12, 5, {}, "paged-rtl");
  assert.deepEqual(R.action(r, "reader.left", true, true, { left: true, right: false }), { pan: -0.5 });
  assert.deepEqual(R.action(r, "reader.left", true, true, { left: false, right: true }), { turn: 1 }, "at the left edge, left turns on");
  assert.deepEqual(R.action(r, "reader.right", true, true, { left: false, right: true }), { pan: 0.5 });
  assert.deepEqual(R.action(r, "reader.right", true, true, { left: false, right: false }), { turn: -1 });
  const w = loaded(12, 5, {}, "webtoon");
  assert.equal(R.action(w, "reader.left", true, true, { left: true, right: true }), null, "the strip never pans with h and l");
});

test("] and [ open the next and previous chapter where each was left", () => {
  const next = R.reduce(Object.assign(loaded(12, 10), { page: 4 }), { type: "chapter", delta: 1 });
  assert.equal(R.chapterName(next), "Ch. 3");
  assert.equal(R.reduce(next, { type: "pages", reply: pages(13, 8, { lastPageRead: 5 }), config }).page, 5);
  const back = R.reduce(loaded(12, 10), { type: "chapter", delta: -1 });
  assert.equal(R.chapterName(back), "Ch. 1");
  assert.equal(R.reduce(back, { type: "pages", reply: pages(11, 8, { lastPageRead: 2 }), config }).page, 2, "not at its end, unlike turning back");
  assert.equal(R.reduce(loaded(13, 3), { type: "chapter", delta: 1 }).edge, "last");
  assert.equal(R.reduce(loaded(11, 3), { type: "chapter", delta: -1 }).edge, "first");
  const broken = R.reduce(R.open(5, chapters, 12, "paged-rtl"), { type: "pages", reply: M.reply(0, ""), config });
  assert.equal(R.chapterName(R.reduce(broken, { type: "chapter", delta: 1 })), "Ch. 3", "a broken chapter can be skipped");
});

test("Home, End and a typed page number go to that page, within the chapter", () => {
  const r = Object.assign(loaded(12, 10), { page: 4 });
  const go = (page) => R.reduce(r, { type: "goto", page });
  assert.equal(go(0).page, 0);
  assert.equal(go(6).page, 6);
  assert.equal(go(99).page, 9, "past the end goes to the last page");
  assert.equal(go(-5).page, 0);
  assert.equal(go(NaN), r, "no number, no jump");
  assert.equal(go(9).read, true, "the last page marks the chapter read, as a turn there does");
  assert.deepEqual(R.savePayload(go(6)).variables, { id: 12, patch: { lastPageRead: 6 } });
  const loading = R.open(5, chapters, 12, "paged-rtl");
  assert.equal(R.reduce(loading, { type: "goto", page: 3 }), loading, "nothing to go to before the pages load");
  assert.equal(R.pageNumber(" 7 "), 6, "pages count from 1 on screen");
  assert.ok(Number.isNaN(R.pageNumber("abc")));
});

test("a new chapter list keeps the chapter open", () => {
  const r = R.reduce(R.open(5, chapters, 12, "paged-rtl"), { type: "chapters", chapters: [chapters[1], chapters[2]] });
  assert.deepEqual(r.chapters.map((c) => c.id), [11, 12]);
  assert.equal(R.chapterId(r), 12);
  assert.equal(R.reduce(r, { type: "chapter", delta: 1 }).edge, "last", "the next chapter is gone");
});

test("a click on the left or right third turns the page in the reading direction", () => {
  const click = (mode, x) => R.action(loaded(12, 5, {}, mode), R.tapZone(mode, x, 400, 1000, 800), true, true);
  assert.deepEqual(click("paged-rtl", 100), { turn: 1 }, "right to left: the left side reads on");
  assert.deepEqual(click("paged-rtl", 900), { turn: -1 });
  assert.deepEqual(click("paged-ltr", 100), { turn: -1 });
  assert.deepEqual(click("paged-ltr", 900), { turn: 1 }, "left to right: the right side reads on");
  assert.equal(R.tapZone("paged-ltr", 329, 0, 1000, 800), "reader.left");
  assert.equal(R.tapZone("paged-ltr", 330, 0, 1000, 800), null, "the middle third does nothing");
  assert.equal(R.tapZone("paged-ltr", 659, 799, 1000, 800), null);
  assert.equal(R.tapZone("paged-ltr", 660, 799, 1000, 800), "reader.right");
});

test("a webtoon click follows Mihon's L layout", () => {
  const zone = (x, y) => R.tapZone("webtoon", x, y, 1000, 1000);
  assert.equal(zone(500, 100), "reader.halfUp", "top third");
  assert.equal(zone(100, 500), "reader.halfUp", "left of the middle");
  assert.equal(zone(900, 500), "reader.halfDown", "right of the middle");
  assert.equal(zone(500, 900), "reader.halfDown", "bottom third");
  assert.equal(zone(500, 500), null, "the middle does nothing");
});

test("the wheel moves one step per notch and adds up touchpad deltas", () => {
  assert.deepEqual(R.wheel(0, -120), { steps: 1, acc: 0 }, "down reads on");
  assert.deepEqual(R.wheel(0, 240), { steps: -2, acc: 0 }, "up reads back");
  let s = { steps: 0, acc: 0 };
  const steps = [];
  for (let i = 0; i < 5; i++) { s = R.wheel(s.acc, -40); steps.push(s.steps); }
  assert.deepEqual(steps, [0, 0, 1, 0, 0], "three small deltas make one notch");
  assert.equal(s.acc, -80);
  assert.deepEqual(R.wheel(-80, 100), { steps: 0, acc: 20 }, "a turn back cancels a partial notch");
});

test("the settings panel shows the manga's reading mode first, then the reader's Settings rows with their values", () => {
  const S = require("./load")("Settings.js");
  const values = Object.assign({}, S.initial().values, { pageFit: "width", skipRead: true });
  const rows = R.panelRows(loaded(12, 4, {}, "paged-ltr"), values);
  assert.deepEqual(rows[0], { key: "readingMode", label: "Reading mode", text: "left to right", manga: true });
  assert.deepEqual(rows.slice(1).map((r) => r.key), R.PANEL_KEYS);
  assert.ok(rows.slice(1).every((r) => !r.manga), "every other row applies to every manga");
  assert.equal(rows.find((r) => r.key === "pageFit").text, "Fit width");
  assert.equal(rows.find((r) => r.key === "skipRead").text, "on");
  assert.ok(R.PANEL_KEYS.every((k) => S.ROWS.some((r) => r.key === k)), "each key is a Settings row");
});

test("the reader background is black, Mihon's gray, white, or the theme's background", () => {
  assert.equal(R.background("black", "#1a1b26"), "#000000");
  assert.equal(R.background("gray", "#1a1b26"), "#202125");
  assert.equal(R.background("white", "#1a1b26"), "#ffffff");
  assert.equal(R.background("theme", "#1a1b26"), "#1a1b26");
  assert.ok(R.PANEL_KEYS.includes("readerTheme"), "the reader's settings panel offers it");
});

test("in incognito the reader saves no read state, pushes no track and deletes nothing", () => {
  const open = R.open(5, chapters, 13, "paged-rtl", true);
  assert.equal(open.incognito, true);
  const read = turn(turn(R.reduce(open, { type: "pages", reply: pages(13, 3), config }), 1), 1);
  assert.equal(read.read, true, "the chapter still reads to its end");
  assert.equal(R.savePayload(read), null, "no lastPageRead or isRead, so no history entry");
  assert.equal(R.trackPayload(read), null);
  assert.equal(R.deleteTarget(read, 0), null);
  assert.equal(R.reduce(read, { type: "chapter", delta: -1 }).incognito, true, "the mode holds for the reader's whole session");
  const plain = turn(turn(R.reduce(R.open(5, chapters, 13, "paged-rtl"), { type: "pages", reply: pages(13, 3), config }), 1), 1);
  assert.notEqual(R.savePayload(plain), null, "without incognito the same reading saves");
  assert.notEqual(R.trackPayload(plain), null);
  assert.equal(R.deleteTarget(plain, 0), 13);
});

// Page sizes by URL, as ReaderView collects them; the pages at wideAt are
// double pages.
const sized = (r, wideAt) => Object.fromEntries(r.pages.map((u, i) => [u, wideAt.includes(i) ? { width: 1600, height: 1200 } : { width: 800, height: 1200 }]));
const turnIn = (r, delta, layout) => R.reduce(r, { type: "turn", delta, layout });

test("spreads show in right to left and left to right only: always, or while the window is wide", () => {
  assert.equal(R.dual("paged-rtl", "always", { width: 800, height: 1000 }), true);
  assert.equal(R.dual("paged-ltr", "wide", { width: 1600, height: 1000 }), true);
  assert.equal(R.dual("paged-ltr", "wide", { width: 800, height: 1000 }), false);
  assert.equal(R.dual("paged-rtl", "never", { width: 1600, height: 1000 }), false);
  assert.equal(R.dual("paged-vertical", "always", { width: 1600, height: 1000 }), false, "Mihon offers spreads for the horizontal pagers only");
  assert.equal(R.dual("webtoon", "always", { width: 1600, height: 1000 }), false);
  assert.ok(R.PANEL_KEYS.includes("dualPageView") && R.PANEL_KEYS.includes("dualPageSplit"));
});

test("spreads turn by their pages: the cover alone, then pairs, a wide page alone; back lands on the spread before", () => {
  let r = loaded(12, 7);
  const layout = { dual: true, split: false, sizes: sized(r, [3]) };
  const seen = [r.page];
  for (let i = 0; i < 4; i++) { r = turnIn(r, 1, layout); seen.push(r.page); }
  assert.deepEqual(seen, [0, 1, 3, 4, 6], "0 | 1 2 | 3 (wide) | 4 5 | 6");
  assert.equal(R.spreadAt(r, 6, layout), 1, "the last page has no partner");
  assert.equal(r.read, true);
  const back = [];
  for (let i = 0; i < 4; i++) { r = turnIn(r, -1, layout); back.push(r.page); }
  assert.deepEqual(back, [4, 3, 1, 0]);
  assert.equal(R.turnTo(loaded(12, 7), -1, layout), null, "before the first page is the chapter before");
  assert.equal(R.spreadAt(loaded(12, 7), 1, { dual: true, sizes: {} }), 2, "a page not loaded yet pairs");
  assert.deepEqual([turnIn(loaded(12, 7), 1).page, turnIn(turnIn(loaded(12, 7), 1), 1).page], [1, 2], "no layout: one page at a time");
});

test("the spread that ends on the last page reads the chapter", () => {
  let r = loaded(12, 5);
  const layout = { dual: true, split: false, sizes: sized(r, []) };
  r = turnIn(turnIn(r, 1, layout), 1, layout);
  assert.deepEqual([r.page, r.read], [3, true], "3 and 4 show: 4 is the last");
  assert.deepEqual(R.savePayload(r).variables.patch, { lastPageRead: 3, isRead: true });
  const reopened = loaded(12, 5, { lastPageRead: 3 });
  assert.equal(reopened.read, false, "opened on the spread before the last page");
  const past = R.reduce(reopened, { type: "turn", delta: 1, layout, always: true });
  assert.deepEqual([past.transition && past.transition.dir, past.read], ["next", true], "reading on past it marks the chapter read");
  assert.equal(R.savePayload(past).variables.patch.isRead, true);
});

test("a wide page splits in two halves outside spreads, turned half by half", () => {
  let r = loaded(12, 4, { lastPageRead: 1 });
  const layout = { dual: false, split: true, sizes: sized(r, [2]) };
  const seen = [];
  for (let i = 0; i < 3; i++) { r = turnIn(r, 1, layout); seen.push([r.page, r.half]); }
  assert.deepEqual(seen, [[2, 0], [2, 1], [3, 0]]);
  const back = [];
  for (let i = 0; i < 3; i++) { r = turnIn(r, -1, layout); back.push([r.page, r.half]); }
  assert.deepEqual(back, [[2, 1], [2, 0], [1, 1]], "back onto a split page shows its second half first");
  assert.equal(R.splits(Object.assign({}, r, { page: 2 }), Object.assign({}, layout, { dual: true })), false, "a spread shows a wide page whole");
  assert.equal(R.splits(Object.assign({}, r, { page: 2 }), Object.assign({}, layout, { split: false })), false);
});

test("a spread sits in the middle, the first page on the right in right to left", () => {
  const view = { width: 1600, height: 1000 };
  const at = (mode) => Object.assign(loaded(12, 7, {}, mode), { page: 1 });
  const rtl = at("paged-rtl");
  const layout = { dual: true, split: false, sizes: sized(rtl, []) };
  const s = R.spread(rtl, layout, "screen", view, 1);
  const w = 800 * (1000 / 1200);
  assert.deepEqual(s.items.map((i) => [i.page, i.x, i.width, i.height]), [[1, 800, w, 1000], [2, 800 - w, w, 1000]]);
  assert.deepEqual([s.width, s.height, s.pagesWidth], [1600, 1000, 2 * w]);
  const ltr = R.spread(at("paged-ltr"), layout, "screen", view, 1);
  assert.deepEqual(ltr.items.map((i) => [i.page, i.x]), [[1, 800 - w], [2, 800]]);
  assert.equal(R.spread(rtl, layout, "screen", view, 2).width, 4 * w, "a zoomed spread runs past the view");
});

test("a split page shows the half read first: the left in left to right, the right in right to left", () => {
  const view = { width: 1600, height: 1000 };
  const at = (mode, half) => Object.assign(loaded(12, 4, {}, mode), { page: 2, half });
  const layout = (r) => ({ dual: false, split: true, sizes: sized(r, [2]) });
  const half = (mode, h) => { const r = at(mode, h); return R.spread(r, layout(r), "screen", view, 1).items[0]; };
  const w = 800 * (1000 / 1200);
  assert.deepEqual([half("paged-ltr", 0).imageX, half("paged-ltr", 0).width, half("paged-ltr", 0).imageWidth], [0, w, 2 * w]);
  assert.equal(half("paged-ltr", 1).imageX, -w);
  assert.equal(half("paged-rtl", 0).imageX, -w);
  assert.equal(half("paged-rtl", 1).imageX, 0);
});
