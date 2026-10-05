const { test } = require("node:test");
const assert = require("node:assert/strict");
const Ch = require("./load")("Chapters.js");

// Newest first, as Browse.detail holds them.
const chapters = [
  { id: 14, read: false, lastPage: 0 },
  { id: 13, read: false, lastPage: 6 },
  { id: 12, read: true, lastPage: 0 },
  { id: 11, read: true, lastPage: 19 }
];

test("marking read sends isRead to the unread chapters only, and leaves lastPageRead alone", () => {
  const p = Ch.markPayload(chapters, true);
  assert.match(p.query, /updateChapters/);
  assert.deepEqual(p.variables, { ids: [14, 13], started: [], read: true });
});

test("marking unread sends isRead false and resets lastPageRead only where a page was read", () => {
  const p = Ch.markPayload(chapters, false);
  assert.match(p.query, /ids: \$started, patch: \{ isRead: false, lastPageRead: 0 \}/);
  assert.deepEqual(p.variables, { ids: [12], started: [13, 11], read: false }, "a started unread chapter goes back to page 1, as in Mihon");
});

test("nothing to change sends nothing", () => {
  assert.equal(Ch.markPayload([chapters[2], chapters[3]], true), null);
  assert.equal(Ch.markPayload([chapters[0]], false), null);
  assert.equal(Ch.markPayload([], true), null);
});

test("the chapters before the cursor are the ones below it, without it", () => {
  assert.deepEqual(Ch.previous(chapters, 1).map((c) => c.id), [12, 11]);
  assert.deepEqual(Ch.previous(chapters, 3), []);
});

test("the tracker push asks for each manga's progress once", () => {
  const one = Ch.trackPayload([5]);
  assert.match(one.query, /trackProgress\(input: \{ mangaId: 5 \}\)/);
  const two = Ch.trackPayload([5, 9, 5]);
  assert.equal(two.query.match(/trackProgress/g).length, 2);
  assert.match(two.query, /m9: trackProgress\(input: \{ mangaId: 9 \}\)/);
});
