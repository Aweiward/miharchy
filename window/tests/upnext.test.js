const { test } = require("node:test");
const assert = require("node:assert/strict");
const U = require("./load")("UpNext.js");

// Seconds, as the server sends fetchedAt, lastReadAt and inLibraryAt; now in ms.
const NOW = Date.UTC(2026, 9, 9) / 1000;
const DAY = 86400;

// Chapters as the server sends them, sourceOrder 1 oldest.
const ch = (id, sourceOrder, o) => Object.assign(
  { id, name: "Ch. " + sourceOrder, chapterNumber: sourceOrder, uploadDate: "0", isRead: false, isBookmarked: false, lastPageRead: 0,
    isDownloaded: false, scanlator: "", sourceOrder, lastReadAt: "0", fetchedAt: String(NOW - 100 * DAY) },
  o
);
const read = (at) => ({ isRead: true, lastReadAt: String(at || NOW - 50 * DAY) });
const manga = (id, chapters, o) => Object.assign({ id, inLibraryAt: String(NOW - 200 * DAY), source: { id: "1" }, meta: [], chapters: { nodes: chapters } }, o);
const data = (mangas, globalMeta) => ({ metas: { nodes: globalMeta || [] }, mangas: { nodes: mangas } });
const list = (d, downloadedOnly) => U.list(d, downloadedOnly || false, NOW * 1000);

test("Up next puts a partly read next chapter before a manga close to caught up", () => {
  const close = manga(1, [ch(11, 1, read(NOW - DAY)), ch(12, 2)]);
  const partly = manga(2, [ch(21, 1, read(NOW - 9 * DAY)), ch(22, 2, { lastPageRead: 4, lastReadAt: String(NOW - 9 * DAY) })]);
  assert.deepEqual(list(data([close, partly])), [{ mangaId: 2, chapterId: 22 }, { mangaId: 1, chapterId: 12 }]);
});

const unread = (from, n, o) => Array.from({ length: n }, (_, i) => ch(from + i, from + i, o));

test("Up next leaves out a started manga with more than 5 unread and no fresh update", () => {
  const five = manga(1, [ch(100, 0, read()), ...unread(1, 5)]);
  const archive = manga(2, [ch(200, 0, read(NOW - DAY)), ...unread(1, 6)]);
  const never = manga(3, unread(301, 2));
  assert.deepEqual(list(data([five, archive, never])), [{ mangaId: 1, chapterId: 1 }]);
});

test("a fresh update puts a manga in Up next after the started ones, the newest update first", () => {
  const close = manga(1, [ch(11, 1, read(NOW - 30 * DAY)), ch(12, 2)]);
  const archive = manga(2, [ch(200, 0, read(NOW - DAY)), ...unread(201, 6), ch(207, 207, { fetchedAt: String(NOW - 6 * DAY) })]);
  const fresh = manga(3, [ch(31, 1, { fetchedAt: String(NOW - DAY) })]);
  const old = manga(4, [ch(41, 1, { fetchedAt: String(NOW - 8 * DAY) })]);
  const beforeLibrary = manga(5, [ch(51, 1, { fetchedAt: String(NOW - DAY) })], { inLibraryAt: String(NOW - DAY + 10) });
  assert.deepEqual(list(data([archive, old, fresh, close, beforeLibrary])),
    [{ mangaId: 1, chapterId: 12 }, { mangaId: 3, chapterId: 31 }, { mangaId: 2, chapterId: 201 }]);
});

test("Up next leaves out a manga whose source is not installed", () => {
  const gone = manga(1, [ch(11, 1, read(NOW - DAY)), ch(12, 2)], { source: null });
  const kept = manga(2, [ch(21, 1, read(NOW - 9 * DAY)), ch(22, 2)]);
  assert.deepEqual(list(data([gone, kept])), [{ mangaId: 2, chapterId: 22 }]);
});

test("a manga hidden on History leaves the started tiers until it gets a fresh update", () => {
  const at = NOW - 9 * DAY;
  const hidden = (id, o) => manga(id, [ch(id * 10 + 1, 1, read(at)), ch(id * 10 + 2, 2, Object.assign({ lastPageRead: 3, lastReadAt: String(at) }, o))],
    { meta: [{ key: "miharchy.historyHiddenAt", value: String(at) }] });
  assert.deepEqual(list(data([hidden(1)])), [], "hidden, nothing new");
  assert.deepEqual(list(data([hidden(2, { fetchedAt: String(NOW - DAY) })])), [{ mangaId: 2, chapterId: 22 }], "a fresh update brings it back");
  const reopened = manga(3, [ch(31, 1, read(at)), ch(32, 2, { lastPageRead: 3, lastReadAt: String(at + 60) })], { meta: [{ key: "miharchy.historyHiddenAt", value: String(at) }] });
  assert.deepEqual(list(data([reopened])), [{ mangaId: 3, chapterId: 32 }], "opened again after the hide");
  const cleared = data([manga(4, [ch(41, 1, read(at)), ch(42, 2)])], [{ key: "miharchy.historyClearedAt", value: String(at) }]);
  assert.deepEqual(list(cleared), [], "History cleared");
});

test("a manga with chapters marked read but never opened is close to caught up, after the opened ones", () => {
  const marked = manga(1, [ch(11, 1, { isRead: true }), ch(12, 2)]);
  const opened = manga(2, [ch(21, 1, read(NOW - 90 * DAY)), ch(22, 2)]);
  assert.deepEqual(list(data([marked, opened])), [{ mangaId: 2, chapterId: 22 }, { mangaId: 1, chapterId: 12 }]);
});

test("with Downloaded only on, Up next offers the next unread chapter on disk, and drops a manga with none", () => {
  const some = manga(1, [ch(11, 1, read(NOW - DAY)), ch(12, 2), ch(13, 3, { isDownloaded: true })]);
  const none = manga(2, [ch(21, 1, read(NOW - 2 * DAY)), ch(22, 2)]);
  assert.deepEqual(list(data([some, none])), [{ mangaId: 1, chapterId: 12 }, { mangaId: 2, chapterId: 22 }]);
  assert.deepEqual(list(data([some, none]), true), [{ mangaId: 1, chapterId: 13 }]);
});

test("Up next follows the manga's own chapter filters and excluded scanlators over the global defaults", () => {
  const chapters = () => [ch(10, 0, read(NOW - DAY)), ch(11, 1, { scanlator: "Bad" }), ch(12, 2, { isBookmarked: true }), ch(13, 3)];
  const excluded = { key: "miharchy.excludedScanlators", value: "[\"Bad\"]" };
  const bookmarked = (value) => ({ key: "miharchy.chapterFilterBookmarked", value });
  assert.deepEqual(list(data([manga(1, chapters())])), [{ mangaId: 1, chapterId: 11 }]);
  assert.deepEqual(list(data([manga(1, chapters(), { meta: [excluded] })])), [{ mangaId: 1, chapterId: 12 }]);
  assert.deepEqual(list(data([manga(1, chapters(), { meta: [excluded] })], [bookmarked("exclude")])), [{ mangaId: 1, chapterId: 13 }], "a global default applies");
  assert.deepEqual(list(data([manga(1, chapters(), { meta: [excluded, bookmarked("off")] })], [bookmarked("exclude")])), [{ mangaId: 1, chapterId: 12 }], "the manga's own choice wins");
});

test("Up next counts only the unread chapters its filters leave", () => {
  const six = [ch(10, 0, read(NOW - DAY)), ...unread(1, 5), ch(6, 6, { scanlator: "Bad" })];
  assert.deepEqual(list(data([manga(1, six)])), [], "6 unread");
  assert.deepEqual(list(data([manga(1, six, { meta: [{ key: "miharchy.excludedScanlators", value: "[\"Bad\"]" }] })])), [{ mangaId: 1, chapterId: 1 }], "5 after the filter");
});

test("Up next is empty for an empty library", () => {
  assert.deepEqual(list(data([])), []);
});
