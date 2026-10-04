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

test("the poll runs while the queue overlay shows or anything waits in the queue", () => {
  const empty = polled(D.initial(), { downloadStatus: status("STOPPED", []) });
  const busy = polled(D.initial(), { downloadStatus: status("STARTED", [item(13, "QUEUED", 0)]) });
  assert.equal(D.polling(empty, false), false);
  assert.equal(D.polling(empty, true), true);
  assert.equal(D.polling(busy, false), true);
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

test("U queues every unread chapter not yet downloaded", () => {
  assert.deepEqual(D.unread(chapters).map((c) => c.id), [14]);
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
