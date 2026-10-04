const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("../../window/tests/load");
const Mark = load("../plugin/Mark.js");
const M = load("Model.js");

const config = { url: "http://127.0.0.1:4590", username: "u", password: "p" };
const now = new Date(2026, 9, 4, 15).getTime();
const sec = (h) => String(Math.floor(new Date(2026, 9, 4, h).getTime() / 1000));
const manga = { id: 7, title: "Maid to Skate", thumbnailUrl: null, inLibraryAt: sec(1) };
const chapter = (id, h) => ({ id, name: "Ch." + id, uploadDate: String(now), fetchedAt: sec(h), sourceOrder: id, isRead: false, manga });
const reply = (nodes) => M.reply(200, JSON.stringify({ data: { chapters: { nodes } } }));
const after = (r) => Mark.reduce(Mark.initial(), { type: "reply", reply: r, config, now });

test("the mark shows the unread update count, the popup the newest few", () => {
  const nodes = [];
  for (let i = 1; i <= Mark.LIMIT + 2; i++) nodes.push(chapter(i, 2 + i % 10));
  const m = after(reply(nodes));
  assert.equal(Mark.label(m), String(Mark.LIMIT + 2));
  assert.equal(Mark.down(m), false);
  assert.equal(m.rows.length, Mark.LIMIT);
  assert.equal(m.rows[0].id, 9, "newest fetched first");
  assert.equal(m.rows[0].mangaId, 7);
  assert.equal(m.rows[0].title, "Maid to Skate");
  assert.equal(m.rows[0].chapter, "Ch.9");
  assert.equal(m.rows[0].date, "2026-10-04");
  assert.equal(Mark.tooltip(m), "Miharchy: " + (Mark.LIMIT + 2) + " new chapters");
  assert.equal(Mark.notice(m, "/c"), null);
});

test("no updates: the mark shows no count", () => {
  const m = after(reply([]));
  assert.equal(Mark.label(m), "");
  assert.equal(Mark.down(m), false);
  assert.equal(Mark.tooltip(m), "Miharchy: no new chapters");
  assert.equal(Mark.notice(m, "/c").title, "No new chapters");
});

test("a server that does not answer shows the dot, never a stale count", () => {
  const up = after(reply([chapter(1, 3)]));
  const m = Mark.reduce(up, { type: "reply", reply: M.reply(0, ""), config, now });
  assert.equal(Mark.down(m), true);
  assert.equal(Mark.label(m), "");
  assert.deepEqual(m.rows, []);
  assert.equal(Mark.tooltip(m), "Miharchy: The server is not running");
  assert.equal(Mark.notice(m, "/c").title, "The server is not running");
});

test("any failure to reach the updates is the dot; loading is not", () => {
  assert.equal(Mark.down(Mark.initial()), false);
  assert.equal(Mark.label(Mark.initial()), "");
  assert.equal(Mark.down(Mark.reduce(Mark.initial(), { type: "config-missing" })), true);
  assert.equal(Mark.down(after(M.reply(401, ""))), true);
  const broken = after(M.reply(500, ""));
  assert.equal(Mark.down(broken), true);
  assert.match(Mark.notice(broken, "/c").detail, /HTTP 500/);
});
