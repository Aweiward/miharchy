const { test } = require("node:test");
const assert = require("node:assert/strict");
const D = require("./load")("Downloads.js");
const M = require("./load")("Model.js");

const ok = (data) => M.reply(200, JSON.stringify({ data }));
const item = (id, state, progress, mangaId) => ({
  state, progress, tries: 0,
  chapter: { id, name: "Ch. " + id, mangaId: mangaId || 5 },
  manga: { id: mangaId || 5, title: "Spy Room" }
});
const status = (state, queue) => ({ state, queue });
const polled = (q, data) => D.reduce(q, { type: "reply", reply: ok(data) });

// Newest first, as Browse.detail holds them.
const chapters = [
  { id: 14, read: false, downloaded: false },
  { id: 13, read: false, downloaded: true },
  { id: 12, read: true, downloaded: false },
  { id: 11, read: true, downloaded: true }
];

test("a status reply lists the queue in order with each chapter's progress", () => {
  const q = polled(D.initial(), { downloadStatus: status("STARTED", [item(13, "DOWNLOADING", 0.42), item(14, "QUEUED", 0)]) });
  assert.equal(q.state, "ok");
  assert.equal(q.running, true);
  assert.deepEqual(q.items.map((i) => [i.chapterId, i.mangaId, i.state, i.progress]), [[13, 5, "DOWNLOADING", 0.42], [14, 5, "QUEUED", 0]]);
  assert.equal(q.items[0].manga, "Spy Room");
  assert.equal(q.items[0].chapter, "Ch. 13");
});

test("X cancels every download with one clearDownloader, whose reply empties the queue", () => {
  assert.match(D.CLEAR_PAYLOAD.query, /clearDownloader\(input: \{\}\) \{ downloadStatus/);
  const q = polled(D.initial(), { downloadStatus: status("STARTED", [item(13, "DOWNLOADING", 0.4)]) });
  const cleared = polled(q, { clearDownloader: { downloadStatus: status("STOPPED", []) } });
  assert.deepEqual(cleared.items, []);
  assert.deepEqual(D.left(q.items, cleared.items).map((i) => i.chapterId), [13]);
});

test("enqueue, dequeue, start and stop replies all carry the status the queue reads", () => {
  for (const field of ["enqueueChapterDownloads", "dequeueChapterDownloads", "startDownloader", "stopDownloader"]) {
    const data = {};
    data[field] = { downloadStatus: status("STOPPED", [item(14, "QUEUED", 0)]) };
    const q = polled(D.initial(), data);
    assert.equal(q.running, false, field);
    assert.deepEqual(q.items.map((i) => i.chapterId), [14], field);
  }
});

test("a failed poll keeps the queue shown and only changes state", () => {
  const q = polled(D.initial(), { downloadStatus: status("STARTED", [item(13, "DOWNLOADING", 0.5)]) });
  const down = D.reduce(q, { type: "reply", reply: M.reply(0, "") });
  assert.equal(down.state, "down");
  assert.deepEqual(down.items, q.items);
});

test("left lists the items gone from the queue since the last poll", () => {
  const before = polled(D.initial(), { downloadStatus: status("STARTED", [item(13, "DOWNLOADING", 0.9), item(14, "QUEUED", 0, 6)]) });
  const after = polled(before, { downloadStatus: status("STARTED", [item(14, "DOWNLOADING", 0.1, 6)]) });
  assert.deepEqual(D.left(before.items, after.items).map((i) => [i.chapterId, i.mangaId]), [[13, 5]]);
  assert.deepEqual(D.left(after.items, after.items), []);
});

test("the queue stays live while the overlay shows or anything waits in it", () => {
  const empty = polled(D.initial(), { downloadStatus: status("STOPPED", []) });
  const busy = polled(D.initial(), { downloadStatus: status("STARTED", [item(13, "QUEUED", 0)]) });
  assert.equal(D.live(empty, false), false);
  assert.equal(D.live(empty, true), true);
  assert.equal(D.live(busy, false), true);
});

// downloadStatusChanged results, as measured on Suwayomi v2.3.
const at = (position, i) => Object.assign({ position }, i);
const changes = (q, state, updates, omittedUpdates) => D.reduce(q, { type: "live", data: { downloadStatusChanged: { state, omittedUpdates: !!omittedUpdates, initial: null, updates } } });
const ids = (q) => q.items.map((i) => [i.chapterId, i.state, i.progress]);

test("the subscription's first result is the whole queue, the later ones change it in place", () => {
  assert.match(D.LIVE_QUERY, /^subscription \{ downloadStatusChanged\(input: \{ maxUpdates: \d+ \}\) \{ state omittedUpdates initial \{ position state progress /);
  const first = D.reduce(D.initial(), { type: "live", data: { downloadStatusChanged: { state: "STARTED", omittedUpdates: false, initial: [at(0, item(13, "DOWNLOADING", 0.1)), at(1, item(14, "QUEUED", 0))], updates: [] } } });
  assert.equal(first.state, "ok");
  assert.equal(first.running, true);
  assert.deepEqual(ids(first), [[13, "DOWNLOADING", 0.1], [14, "QUEUED", 0]]);
  assert.equal(first.items[0].manga, "Spy Room");

  const progress = changes(first, "STARTED", [{ type: "PROGRESS", download: at(0, item(13, "DOWNLOADING", 0.6)) }]);
  assert.deepEqual(ids(progress), [[13, "DOWNLOADING", 0.6], [14, "QUEUED", 0]]);
  const queued = changes(progress, "STARTED", [{ type: "QUEUED", download: at(2, item(15, "QUEUED", 0)) }]);
  assert.deepEqual(ids(queued).map((i) => i[0]), [13, 14, 15], "a new download joins at its position");
  const failed = changes(queued, "STARTED", [{ type: "ERROR", download: at(1, item(14, "ERROR", 0)) }]);
  assert.deepEqual(ids(failed)[1], [14, "ERROR", 0]);
  const stopped = changes(failed, "STOPPED", [{ type: "STOPPED", download: at(0, item(13, "QUEUED", 0.6)) }]);
  assert.equal(stopped.running, false);
  assert.deepEqual(ids(stopped).map((i) => i[0]), [13, 14, 15]);
});

test("a finished or dequeued download leaves the queue, and left() names it", () => {
  const first = D.reduce(D.initial(), { type: "live", data: { downloadStatusChanged: { state: "STARTED", initial: [at(0, item(13, "DOWNLOADING", 0.9)), at(1, item(14, "QUEUED", 0, 6)), at(2, item(15, "QUEUED", 0))] } } });
  const next = changes(first, "STARTED", [{ type: "FINISHED", download: at(0, item(13, "FINISHED", 1)) }, { type: "DEQUEUED", download: at(1, item(15, "QUEUED", 0)) }]);
  assert.deepEqual(ids(next).map((i) => i[0]), [14]);
  assert.deepEqual(D.left(first.items, next.items).map((i) => i.chapterId), [13, 15]);
});

test("a moved download takes its new position", () => {
  const first = D.reduce(D.initial(), { type: "live", data: { downloadStatusChanged: { state: "STOPPED", initial: [at(0, item(13, "QUEUED", 0)), at(1, item(14, "QUEUED", 0)), at(2, item(15, "QUEUED", 0))] } } });
  assert.deepEqual(ids(changes(first, "STOPPED", [{ type: "POSITION", download: at(0, item(15, "QUEUED", 0)) }])).map((i) => i[0]), [15, 13, 14]);
  assert.deepEqual(ids(changes(first, "STOPPED", [{ type: "POSITION", download: at(9, item(13, "QUEUED", 0)) }])).map((i) => i[0]), [14, 15, 13], "past the end: last");
});

test("the server's results for the overlay's moves, dequeue and cancel all end in the server's order", () => {
  // Measured: one POSITION per moved download, in the mutation's order,
  // with only its target index; the downloads it pushes aside get none.
  const queue = D.reduce(D.initial(), { type: "live", data: { downloadStatusChanged: { state: "STOPPED", initial: [1, 2, 3, 4, 5].map((id, i) => at(i, item(id, "QUEUED", 0))) } } });
  const moved = changes(queue, "STOPPED", [{ type: "POSITION", download: at(0, item(3, "QUEUED", 0)) }]);
  const sorted = changes(moved, "STOPPED", [{ type: "POSITION", download: at(0, item(5, "QUEUED", 0)) }, { type: "POSITION", download: at(1, item(4, "QUEUED", 0)) }]);
  const dequeued = changes(sorted, "STOPPED", [{ type: "DEQUEUED", download: at(1, item(2, "QUEUED", 0)) }]);
  assert.deepEqual(ids(dequeued).map((i) => i[0]), [5, 4, 3, 1], "what downloadStatus listed after the same mutations");
  const cleared = changes(dequeued, "STOPPED", [5, 4, 3, 1].map((id) => ({ type: "DEQUEUED", download: at(0, item(id, "QUEUED", 0)) })));
  assert.deepEqual(cleared.items, []);
});

test("a result that left changes out says so, so the subscription starts over", () => {
  const first = D.reduce(D.initial(), { type: "live", data: { downloadStatusChanged: { state: "STARTED", initial: [] } } });
  assert.equal(D.omitted({ downloadStatusChanged: { omittedUpdates: true } }), true);
  assert.equal(D.omitted({ downloadStatusChanged: { omittedUpdates: false } }), false);
  assert.equal(D.omitted({}), false);
  assert.equal(D.reduce(first, { type: "live", data: {} }), first, "a result without the field changes nothing");
});

test("the marked chapters: the one under the cursor, or the range from the anchor in either direction", () => {
  assert.deepEqual(D.marked(chapters, 1, -1).map((c) => c.id), [13]);
  assert.deepEqual(D.marked(chapters, 3, 1).map((c) => c.id), [13, 12, 11]);
  assert.deepEqual(D.marked(chapters, 0, 2).map((c) => c.id), [14, 13, 12]);
  assert.deepEqual(D.marked([], 0, -1), []);
});

test("d queues the marked chapters not yet downloaded; nothing to queue sends nothing", () => {
  const p = D.enqueuePayload(chapters);
  assert.match(p.query, /enqueueChapterDownloads/);
  assert.match(p.query, /downloadStatus/);
  assert.deepEqual(p.variables, { ids: [14, 12] });
  assert.equal(D.enqueuePayload([chapters[1], chapters[3]]), null);
});

test("x dequeues and then deletes the marked chapters that are downloaded or queued", () => {
  const queue = polled(D.initial(), { downloadStatus: status("STARTED", [item(14, "DOWNLOADING", 0.3)]) }).items;
  const p = D.removePayload(chapters, queue);
  assert.deepEqual(p.variables, { queued: [14], ids: [14, 13, 11] });
  assert.ok(p.query.indexOf("dequeueChapterDownloads") < p.query.indexOf("deleteDownloadedChapters"), "a download in flight leaves the queue before its folder goes");
  assert.equal(D.removePayload([chapters[2]], queue), null);
});

test("x on chapters only on disk never dequeues: the server waits 30 s on an id not in the queue", () => {
  const p = D.removePayload(chapters, []);
  assert.doesNotMatch(p.query, /dequeueChapterDownloads/);
  assert.deepEqual(p.variables, { ids: [13, 11] });
});

test("Space starts a stopped downloader and stops a running one", () => {
  const stopped = polled(D.initial(), { downloadStatus: status("STOPPED", [item(14, "QUEUED", 0)]) });
  assert.match(D.togglePayload(stopped).query, /startDownloader/);
  const started = polled(D.initial(), { downloadStatus: status("STARTED", [item(14, "QUEUED", 0)]) });
  assert.match(D.togglePayload(started).query, /stopDownloader/);
});

test("x on a queue item takes it out of the queue only", () => {
  const p = D.dequeuePayload(14);
  assert.match(p.query, /dequeueChapterDownloads/);
  assert.doesNotMatch(p.query, /deleteDownloadedChapters/);
  assert.deepEqual(p.variables, { ids: [14] });
});

test("a chapter's marker: its place in the queue first, then whether it is on disk", () => {
  const queue = polled(D.initial(), { downloadStatus: status("STARTED", [
    item(14, "DOWNLOADING", 0.426), item(12, "QUEUED", 0), item(11, "ERROR", 0)
  ]) }).items;
  assert.equal(D.marker(chapters[0], queue), "42%");
  assert.equal(D.marker(chapters[2], queue), "queued");
  assert.equal(D.marker(chapters[3], queue), "failed");
  assert.equal(D.marker(chapters[1], queue), "downloaded");
  assert.equal(D.marker(chapters[0], []), "");
});

test("an item's line shows its manga, chapter and state", () => {
  const queue = polled(D.initial(), { downloadStatus: status("STARTED", [item(14, "DOWNLOADING", 0.5), item(12, "QUEUED", 0)]) }).items;
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
  return p ? p.variables.ids : [];
};

test("an automatic delete takes read chapters on disk only, as Mihon's getChaptersToDelete", () => {
  assert.deepEqual(autoDeleted([node(1), node(2, { isRead: false }), node(3, { isDownloaded: false })], false), [1]);
  assert.deepEqual(autoDeleted([node(2, { isRead: false })], false, [2]), [2], "a chapter just read, its save still on the way");
  assert.equal(D.autoDeletePayload({ chapters: { nodes: [node(3, { isDownloaded: false })] } }, false, []), null);
  assert.match(D.autoDeletePayload({ chapters: { nodes: [node(1)] } }, false, []).query, /deleteDownloadedChapters/);
});

test("bookmarked chapters stay unless deleting them is allowed", () => {
  assert.deepEqual(autoDeleted([node(1, { isBookmarked: true }), node(2)], false), [2]);
  assert.deepEqual(autoDeleted([node(1, { isBookmarked: true }), node(2)], true), [1, 2]);
});

test("a manga in a category that keeps downloads keeps them", () => {
  assert.deepEqual(autoDeleted([node(1, { manga: keepCategory("true") }), node(2)], true), [2]);
  assert.deepEqual(autoDeleted([node(1, { manga: keepCategory("false") })], true), [1]);
});

test("the automatic delete query asks for what the rules read", () => {
  const q = D.autoDeleteQuery([4, 5]);
  assert.deepEqual(q.variables, { ids: [4, 5] });
  for (const field of ["isRead", "isBookmarked", "isDownloaded", "meta { key value }"]) assert.ok(q.query.includes(field), field);
});

const queued = (running, list) => polled(D.initial(), { downloadStatus: status(running ? "STARTED" : "STOPPED", list.map(([id, number, date]) => {
  const i = item(id, "QUEUED", 0);
  i.chapter.chapterNumber = number;
  i.chapter.uploadDate = String(date);
  return i;
})) });
// Replays a reorder payload's moves on the ids, as the server does.
const replay = (ids, payload) => {
  const out = ids.slice();
  for (const [, id, to] of payload.query.matchAll(/chapterId: (\d+), to: (\d+)/g)) {
    out.splice(out.indexOf(Number(id)), 1);
    out.splice(Number(to), 0, Number(id));
  }
  return out;
};

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

test("the reorder payload moves each item out of place in one request and lands on the order", () => {
  const q = queued(true, [[1, 1, 0], [2, 2, 0], [3, 3, 0], [4, 4, 0]]);
  const order = [4, 2, 1, 3];
  assert.deepEqual(replay([1, 2, 3, 4], D.orderPayload(q, order)), order);
  assert.equal(D.orderPayload(q, [1, 2, 3, 4]), null);
});

test("only the last move of a reorder answers with the queue, which the queue reads", () => {
  const q = queued(true, [[1, 1, 0], [2, 2, 0], [3, 3, 0]]);
  const query = D.orderPayload(q, [3, 2, 1]).query;
  assert.equal(query.match(/downloadStatus/g).length, 1);
  assert.match(query, /downloadStatus \{[^]*\} \}$/);
  const data = { m2: { downloadStatus: status("STARTED", [item(3, "QUEUED", 0), item(2, "QUEUED", 0), item(1, "QUEUED", 0)]) }, m0: { clientMutationId: null } };
  assert.deepEqual(polled(q, data).items.map((i) => i.chapterId), [3, 2, 1]);
});

test("a retry takes the failed chapters out and queues them again in one request, so their tries start over", () => {
  const p = D.retryPayload([4, 9]);
  assert.match(p.query, /dequeueChapterDownloads\(input: \{ ids: \$ids \}\).*enqueueChapterDownloads\(input: \{ ids: \$ids \}\)/);
  assert.deepEqual(p.variables, { ids: [4, 9] });
  assert.equal(D.retryPayload([]), null);
});

const failedItem = (id, source) => Object.assign(item(id, "ERROR", 0), { manga: { id: 5, title: "Spy Room", source } });
const queueOf = (...items) => polled(D.initial(), { downloadStatus: status("STARTED", items) }).items;
const gqlError = (raw) => M.reply(200, JSON.stringify({ errors: [{ message: raw }] }));

test("the queue asks each manga's source, so a missing one shows without a probe", () => {
  assert.match(D.STATUS_QUERY, /manga \{ id title source \{ id \} \}/);
  assert.match(D.LIVE_QUERY, /manga \{ id title source \{ id \} \}/);
  const items = queueOf(failedItem(13, null), failedItem(14, { id: "0" }));
  assert.deepEqual(items.map((i) => i.sourceMissing), [true, false]);
});

test("a healthy queue is never probed", () => {
  const f = D.failed(queueOf(item(13, "DOWNLOADING", 0.4), item(14, "QUEUED", 0), item(15, "FINISHED", 1)), {});
  assert.deepEqual(f.probe, []);
  assert.deepEqual(f.reasons, {});
});

test("a failed chapter is probed once, with fetchChapterPages, until it is retried", () => {
  const first = D.failed(queueOf(failedItem(13, { id: "0" }), item(14, "QUEUED", 0)), {});
  assert.deepEqual(first.probe, [13]);
  assert.match(D.probePayload(13).query, /fetchChapterPages\(input: \{ chapterId: \$id \}\) \{ pages \}/);
  assert.deepEqual(D.probePayload(13).variables, { id: 13 });
  assert.deepEqual(D.failed(queueOf(failedItem(13, { id: "0" })), first.reasons).probe, [], "probe in flight");
  const known = D.probed(first.reasons, 13, gqlError("Exception while fetching data (/a) : Chapter not found\r\n\r\nat x"));
  assert.equal(known[13].kind, "notFound");
  assert.deepEqual(D.failed(queueOf(failedItem(13, { id: "0" })), known).probe, [], "reason cached");
  const retried = D.failed(queueOf(item(13, "QUEUED", 0)), known);
  assert.deepEqual(retried.reasons, {});
  assert.deepEqual(D.failed(queueOf(failedItem(13, { id: "0" })), retried.reasons).probe, [13], "failed again");
});

test("a chapter that left the queue loses its reason", () => {
  const known = D.probed(D.failed(queueOf(failedItem(13, { id: "0" })), {}).reasons, 13, gqlError("timeout"));
  assert.deepEqual(D.failed([], known).reasons, {});
});

test("a failed chapter whose source is missing gets its reason without a probe", () => {
  const f = D.failed(queueOf(failedItem(13, null)), {});
  assert.deepEqual(f.probe, []);
  assert.equal(f.reasons[13].kind, "sourceMissing");
});

test("a probe that loads says what it found, and one the server never answered goes again", () => {
  const pending = D.failed(queueOf(failedItem(13, { id: "0" })), {}).reasons;
  assert.deepEqual(D.probed(pending, 13, ok({ fetchChapterPages: { pages: [] } }))[13], { kind: "other", text: "Chapter does not have any pages to download" });
  assert.equal(D.probed(pending, 13, ok({ fetchChapterPages: { pages: ["a"] } }))[13].kind, "other");
  const down = D.probed(pending, 13, M.reply(0, ""));
  assert.deepEqual(down, {});
  assert.deepEqual(D.failed(queueOf(failedItem(13, { id: "0" })), down).probe, [13]);
});

test("a probe answer for a chapter no longer waiting on one changes nothing", () => {
  const known = { 13: { kind: "network", text: "No connection to the source" } };
  assert.equal(D.probed(known, 13, gqlError("Chapter not found")), known);
  assert.deepEqual(D.probed({}, 13, gqlError("Chapter not found")), {}, "left the queue or retried meanwhile");
});

test("a failed row shows its reason and hint beside failed", () => {
  const it = queueOf(failedItem(13, { id: "0" }))[0];
  assert.equal(D.statusText(it, undefined, false), "failed");
  assert.equal(D.statusText(it, null, false), "failed");
  assert.equal(D.statusText(it, { kind: "notFound", text: "Not found on the source" }, false), "failed   Not found on the source");
  assert.equal(D.statusText(it, { kind: "cloudflare", text: "Cloudflare blocked the source" }, false), "failed   Cloudflare blocked the source   set up FlareSolverr in Setup");
  assert.equal(D.statusText(it, { kind: "cloudflare", text: "Cloudflare blocked the source" }, true), "failed   Cloudflare blocked the source");
  assert.equal(D.statusText(queueOf(item(14, "DOWNLOADING", 0.5))[0], undefined, false), "50%");
});
