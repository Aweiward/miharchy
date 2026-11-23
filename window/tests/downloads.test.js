const { test } = require("node:test");
const assert = require("node:assert/strict");
const D = require("./load")("Downloads.js");
const M = require("./load")("Model.js");

const ok = (data) => M.coreReply(200, JSON.stringify(data));
const item = (id, state, progress, mangaId) => ({
  state, progress, tries: 0,
  chapter: { id, name: "Ch. " + id, mangaId: mangaId || 5 },
  manga: { id: mangaId || 5, title: "Spy Room" }
});
const status = (state, queue) => ({ state, queue });
// A download route's reply: core sends the plain status.
const polled = (q, data) => D.reduce(q, { type: "reply", reply: ok(data) });

// Newest first, as Browse.detail holds them.
const chapters = [
  { id: 14, read: false, downloaded: false },
  { id: 13, read: false, downloaded: true },
  { id: 12, read: true, downloaded: false },
  { id: 11, read: true, downloaded: true }
];

test("a status reply lists the queue in order with each chapter's progress", () => {
  const q = polled(D.initial(), status("STARTED", [item(13, "DOWNLOADING", 0.42), item(14, "QUEUED", 0)]));
  assert.equal(q.state, "ok");
  assert.equal(q.running, true);
  assert.deepEqual(q.items.map((i) => [i.chapterId, i.mangaId, i.state, i.progress]), [[13, 5, "DOWNLOADING", 0.42], [14, 5, "QUEUED", 0]]);
  assert.equal(q.items[0].manga, "Spy Room");
  assert.equal(q.items[0].chapter, "Ch. 13");
});

test("cancel all's reply empties the queue", () => {
  const q = polled(D.initial(), status("STARTED", [item(13, "DOWNLOADING", 0.4)]));
  const cleared = polled(q, status("STOPPED", []));
  assert.deepEqual(cleared.items, []);
  assert.deepEqual(D.left(q.items, cleared.items).map((i) => i.chapterId), [13]);
});

test("a failed poll keeps the queue shown and only changes state", () => {
  const q = polled(D.initial(), status("STARTED", [item(13, "DOWNLOADING", 0.5)]));
  const down = D.reduce(q, { type: "reply", reply: M.coreReply(0, "") });
  assert.equal(down.state, "down");
  assert.deepEqual(down.items, q.items);
});

test("left lists the items gone from the queue since the last poll", () => {
  const before = polled(D.initial(), status("STARTED", [item(13, "DOWNLOADING", 0.9), item(14, "QUEUED", 0, 6)]));
  const after = polled(before, status("STARTED", [item(14, "DOWNLOADING", 0.1, 6)]));
  assert.deepEqual(D.left(before.items, after.items).map((i) => [i.chapterId, i.mangaId]), [[13, 5]]);
  assert.deepEqual(D.left(after.items, after.items), []);
});

test("the queue stays live while the overlay shows or anything waits in it", () => {
  const empty = polled(D.initial(), status("STOPPED", []));
  const busy = polled(D.initial(), status("STARTED", [item(13, "QUEUED", 0)]));
  assert.equal(D.live(empty, false), false);
  assert.equal(D.live(empty, true), true);
  assert.equal(D.live(busy, false), true);
});

const ids = (q) => q.items.map((i) => [i.chapterId, i.state, i.progress]);
const live = (q, st) => D.reduce(q, { type: "live", data: st });

test("each topic result is the whole queue, and one without a queue changes nothing", () => {
  const first = live(D.initial(), status("STARTED", [item(13, "DOWNLOADING", 0.1), item(14, "QUEUED", 0)]));
  assert.equal(first.state, "ok");
  assert.equal(first.running, true);
  assert.deepEqual(ids(first), [[13, "DOWNLOADING", 0.1], [14, "QUEUED", 0]]);
  assert.equal(first.items[0].manga, "Spy Room");
  const progress = live(first, status("STARTED", [item(13, "DOWNLOADING", 0.6), item(14, "QUEUED", 0), item(15, "QUEUED", 0)]));
  assert.deepEqual(ids(progress), [[13, "DOWNLOADING", 0.6], [14, "QUEUED", 0], [15, "QUEUED", 0]]);
  const stopped = live(progress, status("STOPPED", [item(14, "QUEUED", 0), item(13, "QUEUED", 0.6)]));
  assert.equal(stopped.running, false);
  assert.deepEqual(ids(stopped).map((i) => i[0]), [14, 13], "the server's order");
  assert.equal(live(first, {}), first);
  assert.deepEqual(D.left(progress.items, stopped.items).map((i) => i.chapterId), [15]);
});

test("the marked chapters: the one under the cursor, or the range from the anchor in either direction", () => {
  assert.deepEqual(D.marked(chapters, 1, -1).map((c) => c.id), [13]);
  assert.deepEqual(D.marked(chapters, 3, 1).map((c) => c.id), [13, 12, 11]);
  assert.deepEqual(D.marked(chapters, 0, 2).map((c) => c.id), [14, 13, 12]);
  assert.deepEqual(D.marked([], 0, -1), []);
});

test("x deletes the marked chapters that are downloaded or queued; none of those sends nothing", () => {
  const queue = polled(D.initial(), status("STARTED", [item(14, "DOWNLOADING", 0.3)])).items;
  assert.deepEqual(D.removePayload(chapters, queue), { route: "download.delete", body: { ids: [14, 13, 11] } });
  assert.deepEqual(D.removePayload(chapters, []).body, { ids: [13, 11] });
  assert.equal(D.removePayload([chapters[2]], queue), null);
});

test("a chapter's marker: its place in the queue first, then whether it is on disk", () => {
  const queue = polled(D.initial(), status("STARTED", [
    item(14, "DOWNLOADING", 0.426), item(12, "QUEUED", 0), item(11, "ERROR", 0)
  ])).items;
  assert.equal(D.marker(chapters[0], queue), "42%");
  assert.equal(D.marker(chapters[2], queue), "queued");
  assert.equal(D.marker(chapters[3], queue), "failed");
  assert.equal(D.marker(chapters[1], queue), "downloaded");
  assert.equal(D.marker(chapters[0], []), "");
});

test("an item's line shows its manga, chapter and state", () => {
  const queue = polled(D.initial(), status("STARTED", [item(14, "DOWNLOADING", 0.5), item(12, "QUEUED", 0)])).items;
  assert.equal(D.progressText(queue[0]), "50%");
  assert.equal(D.progressText(queue[1]), "queued");
});

test("the delete after reading setting is how many read chapters back the delete goes, -1 for off", () => {
  assert.deepEqual(["false", "true", "1", "2", "3", "4", "", undefined].map(D.deleteSlots), [-1, 0, 1, 2, 3, 4, -1, -1]);
});

const node = (id, o) => Object.assign({ id, isRead: true, isBookmarked: false, isDownloaded: true, manga: { categories: { nodes: [] } } }, o);
const keepCategory = (value) => ({ categories: { nodes: [{ meta: [{ key: "miharchy.other", value: "true" }] }, { meta: [{ key: D.KEEP_KEY, value }] }] } });
const autoDeleted = (nodes, bookmarked, readIds) => {
  const p = D.autoDeletePayload({ chapters: { nodes } }, bookmarked, readIds || []);
  return p ? p.body.ids : [];
};

test("an automatic delete takes read chapters on disk only, as Mihon's getChaptersToDelete", () => {
  assert.deepEqual(autoDeleted([node(1), node(2, { isRead: false }), node(3, { isDownloaded: false })], false), [1]);
  assert.deepEqual(autoDeleted([node(2, { isRead: false })], false, [2]), [2], "a chapter just read, its save still on the way");
  assert.equal(D.autoDeletePayload({ chapters: { nodes: [node(3, { isDownloaded: false })] } }, false, []), null);
  assert.equal(D.autoDeletePayload({ chapters: { nodes: [node(1)] } }, false, []).route, "download.delete");
});

test("bookmarked chapters stay unless deleting them is allowed", () => {
  assert.deepEqual(autoDeleted([node(1, { isBookmarked: true }), node(2)], false), [2]);
  assert.deepEqual(autoDeleted([node(1, { isBookmarked: true }), node(2)], true), [1, 2]);
});

test("a manga in a category that keeps downloads keeps them", () => {
  assert.deepEqual(autoDeleted([node(1, { manga: keepCategory("true") }), node(2)], true), [2]);
  assert.deepEqual(autoDeleted([node(1, { manga: keepCategory("false") })], true), [1]);
});

const queued = (running, list) => polled(D.initial(), status(running ? "STARTED" : "STOPPED", list.map(([id, number, date]) => {
  const i = item(id, "QUEUED", 0);
  i.chapter.chapterNumber = number;
  i.chapter.uploadDate = String(date);
  return i;
})));

test("a download moves up, down, to the top and to the bottom, and stays inside the queue", () => {
  const q = queued(false, [[1, 1, 0], [2, 2, 0], [3, 3, 0]]);
  assert.deepEqual(D.moved(q, 1, 0), [2, 1, 3]);
  assert.deepEqual(D.moved(q, 1, 2), [1, 3, 2]);
  assert.deepEqual(D.moved(q, 2, 0), [3, 1, 2]);
  assert.deepEqual(D.moved(q, 0, 3), [2, 3, 1]);
  assert.deepEqual(D.moved(q, 0, -1), [1, 2, 3]);
});

test("a sort orders the queue ascending, and descending once it already runs ascending", () => {
  const q = queued(true, [[7, 3, 300], [8, 1, 100], [9, 2, 50]]);
  assert.deepEqual(D.sorted(q, "chapterNumber"), [8, 9, 7]);
  assert.deepEqual(D.sorted(q, "uploadDate"), [9, 8, 7]);
  const asc = queued(true, [[8, 1, 100], [9, 2, 50], [7, 3, 300]]);
  assert.deepEqual(D.sorted(asc, "chapterNumber"), [7, 9, 8]);
});

test("a retry of no chapter sends nothing", () => {
  assert.equal(D.retryPayload([]), null);
});

const failedItem = (id, error) => Object.assign(item(id, "ERROR", 0), { error });
const queueOf = (...items) => polled(D.initial(), status("STARTED", items)).items;

test("the queue keeps whether each manga's source is installed", () => {
  const items = queueOf(
    Object.assign(item(13, "ERROR", 0), { manga: { id: 5, title: "Spy Room", source: null } }),
    Object.assign(item(14, "ERROR", 0), { manga: { id: 5, title: "Spy Room", source: { id: "0" } } }));
  assert.deepEqual(items.map((i) => i.sourceMissing), [true, false]);
});

test("a healthy queue has no failure reasons", () => {
  const f = D.failed(queueOf(item(13, "DOWNLOADING", 0.4), item(14, "QUEUED", 0), item(15, "FINISHED", 1)), {});
  assert.deepEqual(f.reasons, {});
});

test("a failed chapter keeps its reason until it is retried or leaves the queue", () => {
  const error = { kind: "source", message: "Chapter not found" };
  const first = D.failed(queueOf(failedItem(13, error), item(14, "QUEUED", 0)), {});
  assert.deepEqual(Object.keys(first.reasons), ["13"]);
  assert.equal(first.reasons[13].kind, "notFound");
  const kept = D.failed(queueOf(failedItem(13, { kind: "network", message: "timeout" })), first.reasons);
  assert.equal(kept.reasons[13], first.reasons[13], "reason cached");
  assert.deepEqual(D.failed(queueOf(item(13, "QUEUED", 0)), first.reasons).reasons, {}, "retried");
  assert.deepEqual(D.failed([], first.reasons).reasons, {}, "left the queue");
});

test("a failed row shows its reason beside failed", () => {
  const it = queueOf(failedItem(13, null))[0];
  assert.equal(D.statusText(it, undefined, false), "failed");
  assert.equal(D.statusText(it, null, false), "failed");
  assert.equal(D.statusText(it, { kind: "notFound", text: "Not found on the source" }, false), "failed   Not found on the source");
  assert.equal(D.statusText(it, { kind: "cloudflare", text: "Cloudflare blocked the source" }, false), "failed   Cloudflare blocked the source", "no hint on core");
  assert.equal(D.statusText(queueOf(item(14, "DOWNLOADING", 0.5))[0], undefined, false), "50%");
});

test("a local manga offers no download or delete", () => {
  assert.equal(D.offered({ sourceId: "0" }), false);
  assert.equal(D.offered({ sourceId: "2499283573021220255" }), true);
  assert.equal(D.offered(null), true);
});
