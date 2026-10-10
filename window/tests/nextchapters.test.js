const { test } = require("node:test");
const assert = require("node:assert/strict");
const N = require("./load")("NextChapters.js");
const Ch = require("./load")("Chapters.js");

// Chapters as the server sends them, sourceOrder 1 oldest.
const ch = (id, sourceOrder, o) => Object.assign(
  { id, name: "Ch. " + sourceOrder, chapterNumber: sourceOrder, uploadDate: "0", isRead: false, isBookmarked: false, lastPageRead: 0,
    isDownloaded: false, scanlator: "", sourceOrder },
  o
);
const manga = (id, chapters, meta) => ({ id, title: "Manga " + id, meta: meta || [], chapters: { nodes: chapters } });
const data = (mangas, globalMeta) => ({ metas: { nodes: globalMeta || [] }, mangas: { nodes: mangas } });
const row = (id, count) => Ch.DOWNLOADS.find((r) => r.id === id && (count === undefined || r.count === count));
const ids = (list) => list.map((c) => c.id);
const pick = (d, r, count, queue) => ids(N.pick(d, r, count === undefined ? r.count : count, queue || []));

test("the download menu has a Next 2 chapters row after the next chapter", () => {
  assert.deepEqual(Ch.DOWNLOADS.slice(0, 3).map((r) => r.label), ["Next chapter", "Next 2 chapters", "Next 5 chapters"]);
});

test("next N tops up: the next N unread chapters in reading order, less those on disk", () => {
  const m = manga(1, [ch(11, 1, { isRead: true }), ch(12, 2, { isDownloaded: true }), ch(13, 3), ch(14, 4)]);
  assert.deepEqual(pick(data([m]), row("next", 2)), [13], "12 is on disk and counts toward the 2");
  const full = manga(2, [ch(21, 1, { isDownloaded: true }), ch(22, 2, { isDownloaded: true }), ch(23, 3)]);
  assert.deepEqual(pick(data([full]), row("next", 2)), [], "a manga whose next 2 are on disk queues nothing");
  assert.deepEqual(pick(data([m, full]), row("next", 0), 3), [13, 14, 23]);
});

test("next N follows the manga's chapter filters and excluded scanlators, in either direction", () => {
  const chapters = [ch(31, 1, { scanlator: "B" }), ch(32, 2, { isBookmarked: true }), ch(33, 3), ch(34, 4)];
  const own = [{ key: "miharchy.excludedScanlators", value: JSON.stringify(["B"]) }, { key: "miharchy.chapterFilterBookmarked", value: "exclude" }];
  assert.deepEqual(pick(data([manga(3, chapters, own)]), row("next", 2)), [33, 34]);
  const asc = [{ key: "miharchy.chapterSortDirection", value: "asc" }];
  assert.deepEqual(pick(data([manga(3, chapters)], asc), row("next", 2)), [31, 32]);
});

test("next N ignores Downloaded only and a stored downloaded filter", () => {
  const chapters = [ch(41, 1, { isDownloaded: true }), ch(42, 2), ch(43, 3)];
  const own = [{ key: "miharchy.chapterFilterDownloaded", value: "include" }];
  assert.deepEqual(pick(data([manga(4, chapters, own)]), row("next", 2)), [42]);
});

test("a chapter already in the queue is not queued again", () => {
  const m = manga(5, [ch(51, 1), ch(52, 2)]);
  assert.deepEqual(pick(data([m]), row("next", 2), 2, [{ chapterId: 51 }]), [52]);
});

test("unread and bookmarked keep the library's rule: every such chapter not on disk, no filters", () => {
  const chapters = [ch(61, 1, { isRead: true, isBookmarked: true }), ch(62, 2, { isDownloaded: true }), ch(63, 3, { scanlator: "B", isBookmarked: true }), ch(64, 4)];
  const own = [{ key: "miharchy.excludedScanlators", value: JSON.stringify(["B"]) }];
  assert.deepEqual(pick(data([manga(6, chapters, own)]), row("unread")).sort(), [63, 64]);
  assert.deepEqual(pick(data([manga(6, chapters, own)]), row("bookmarked")).sort(), [61, 63]);
});

const shown = { name: "Action", manga: [{ id: 1, title: "One" }, { id: 2, title: "Two" }, { id: 3, title: "Three" }] };

test("the Library set is the selection, or with none the shown category tab", () => {
  assert.deepEqual(N.librarySet(shown, []), { label: "Action", manga: [{ id: 1, title: "One" }, { id: 2, title: "Two" }, { id: 3, title: "Three" }] });
  assert.deepEqual(N.librarySet(shown, [3, 1]), { label: "2 manga", manga: [{ id: 1, title: "One" }, { id: 3, title: "Three" }] });
  assert.deepEqual(N.librarySet(shown, [2]).label, "Two");
});

test("the Up next set is every manga in Up next, in its order", () => {
  const list = [{ mangaId: 7, title: "Seven" }, { mangaId: 4, title: "Four" }];
  assert.deepEqual(N.upNextSet(list), { label: "Up next", manga: [{ id: 7, title: "Seven" }, { id: 4, title: "Four" }] });
});

test("a run keeps its label, the chapters queued and each refresh failure with the raw message", () => {
  let run = N.start(N.librarySet(shown, []), row("next", 2), 2);
  assert.deepEqual(run, { label: "Next 2 chapters of Action", mangaIds: [1, 2, 3], queued: [], failures: [], state: "refreshing" });
  run = N.failed(run, shown.manga[1], "HTTP error 503");
  run = N.queued(run, [13, 14]);
  assert.deepEqual(run.failures, [{ mangaId: 2, title: "Two", message: "HTTP error 503" }]);
  assert.deepEqual(run.queued, [13, 14]);
  assert.equal(run.state, "done");
  assert.equal(N.start(N.upNextSet([]), row("next", 1), 1).label, "Next chapter of Up next");
  assert.equal(N.start(N.upNextSet([]), row("next", 0), 7).label, "Next 7 chapters of Up next");
  assert.equal(N.start(N.upNextSet([]), row("unread")).label, "Unread chapters of Up next");
});

test("each menu remembers its last row in its own global meta key", () => {
  assert.deepEqual(N.MENU_PREFS.map((p) => p.key), ["downloadMenuManga", "downloadMenuSet"]);
  Ch.DOWNLOADS.forEach((r, i) => assert.equal(N.rowIndex(N.rowKey(r)), i, r.label));
  assert.equal(N.rowIndex("next2"), 1);
  assert.equal(N.rowIndex("gone"), 0, "an unknown key falls back to the first row");
  assert.deepEqual(N.MENU_PREFS[1].options, Ch.DOWNLOADS.map(N.rowKey));
});

test("the refresh and the read ask the server for one manga and for the set", () => {
  assert.match(N.refreshPayload(9).query, /fetchChapters\(input: \{ mangaId: \$id \}\)/);
  assert.deepEqual(N.refreshPayload(9).variables, { id: 9 });
  const read = N.readPayload([1, 2]);
  assert.deepEqual(read.variables.ids, [1, 2]);
  assert.ok(read.variables.keys.includes("miharchy.excludedScanlators"));
  assert.match(read.query, /mangas\(filter: \{ id: \{ in: \$ids \} \}\)/);
});

// The run in the download queue: queue items and live updates as Downloads.js
// holds them.
const q = (id, state) => ({ chapterId: id, state });
const up = (type, id) => ({ type, download: { chapter: { id } } });
const done = (failures) => Object.assign(N.queued(N.start(N.librarySet(shown, []), row("next", 2), 2), [11, 12, 13, 14]), failures ? { failures } : {});
const follow = (run, steps) => steps.reduce((marks, [items, updates]) => N.track(marks, run, items, updates || []), {});

test("a run chapter is queued until the queue has shown it, on disk once it leaves, failed while it is in ERROR", () => {
  const run = done();
  const items = [q(11, "DOWNLOADING"), q(12, "QUEUED"), q(13, "ERROR"), q(14, "QUEUED"), q(99, "QUEUED")];
  let marks = follow(run, [[items]]);
  assert.deepEqual(N.tally(run, items, marks), { onDisk: 0, queued: 3, failed: [13] }, "99 is not the run's");
  const later = [q(13, "ERROR"), q(99, "QUEUED")];
  marks = N.track(marks, run, later, [up("FINISHED", 11), up("FINISHED", 12), up("FINISHED", 14)]);
  assert.deepEqual(N.tally(run, later, marks), { onDisk: 3, queued: 0, failed: [13] });
  assert.deepEqual(N.tally(run, [], {}), { onDisk: 0, queued: 4, failed: [] }, "a chapter the queue has not shown yet is still to come");
});

test("a run chapter taken out of the queue counts nowhere, unless it comes back", () => {
  const run = done();
  const items = [q(11, "QUEUED"), q(12, "QUEUED"), q(13, "ERROR"), q(14, "QUEUED")];
  let marks = follow(run, [[items], [[q(13, "ERROR")], [up("DEQUEUED", 11), up("DEQUEUED", 12), up("DEQUEUED", 14)]]]);
  assert.deepEqual(N.tally(run, [q(13, "ERROR")], marks), { onDisk: 0, queued: 0, failed: [13] });
  const retried = [q(13, "QUEUED")];
  marks = N.track(marks, run, retried, [up("DEQUEUED", 13), up("QUEUED", 13)]);
  assert.deepEqual(N.tally(run, retried, marks), { onDisk: 0, queued: 1, failed: [] }, "a retry dequeues and queues again in one result");
});

test("the run ends when none of its chapters is queued or downloading; failed ones stay behind", () => {
  const run = done();
  const marks = follow(run, [[[q(11, "QUEUED"), q(12, "QUEUED"), q(13, "QUEUED"), q(14, "QUEUED")]]]);
  assert.equal(N.ended(run, N.tally(run, [q(13, "ERROR"), q(14, "DOWNLOADING")], marks)), false);
  assert.equal(N.ended(run, N.tally(run, [q(13, "ERROR")], marks)), true);
  assert.equal(N.ended(run, N.tally(run, [], {})), false, "not before the queue shows its chapters");
  assert.equal(N.ended(N.start(N.librarySet(shown, []), row("next", 2), 2), { onDisk: 0, queued: 0, failed: [] }), false, "not while it fetches chapters");
});

test("the summary counts the run's chapters and the manga whose chapters could not be fetched", () => {
  const run = done([{ mangaId: 2, title: "Two", message: "Missing source 7" }]);
  assert.equal(N.summary(run, { onDisk: 38, queued: 0, failed: [1, 2, 3, 4] }), "Next 2 chapters of Action: 38 on disk, 4 failed, 1 manga could not fetch chapters");
  assert.equal(N.summary(done(), { onDisk: 2, queued: 2, failed: [] }), "Next 2 chapters of Action: 2 on disk, 2 queued");
  assert.equal(N.summary(N.start(N.upNextSet([]), row("next", 2), 2), { onDisk: 0, queued: 0, failed: [] }), "Next 2 chapters of Up next: fetching chapters");
  assert.equal(N.summary(N.start(N.librarySet(shown, [1, 2]), row("next", 1), 1), { onDisk: 0, queued: 0, failed: [] }), "Next chapter of 2 manga: fetching chapters");
});

test("a run shows in the queue once it has something to count", () => {
  assert.equal(N.shown(null), false);
  assert.equal(N.shown(N.start(N.upNextSet([]), row("next", 2), 2)), true, "while it fetches chapters");
  assert.equal(N.shown(N.queued(N.start(N.upNextSet([]), row("next", 2), 2), [])), false, "nothing queued and nothing failed");
  assert.equal(N.shown(done()), true);
  assert.equal(N.shown(Object.assign(N.queued(N.start(N.upNextSet([]), row("next", 2), 2), []), { failures: [{ mangaId: 1, title: "One", message: "x" }] })), true);
});

test("the end of a run notifies with the same summary, unless nothing of it was left to report", () => {
  const run = done();
  assert.deepEqual(N.notifyCommand(run, { onDisk: 3, queued: 0, failed: [13] }), ["notify-send", "-a", "Miharchy", "--", "Next 2 chapters of Action", "3 on disk, 1 failed"]);
  assert.equal(N.notifyCommand(run, { onDisk: 0, queued: 0, failed: [] }), null, "every chapter taken out");
});
