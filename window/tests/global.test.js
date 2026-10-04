const { test } = require("node:test");
const assert = require("node:assert/strict");
const G = require("./load")("GlobalSearch.js");
const M = require("./load")("Model.js");

const config = { url: "http://127.0.0.1:4590", username: "u", password: "p" };
const ok = (ids) => M.reply(200, JSON.stringify({ data: { fetchSourceManga: { hasNextPage: true, mangas: ids.map((id) => ({ id, title: "M" + id, thumbnailUrl: null, inLibrary: false })) } } }));
const fail = (message) => M.reply(200, JSON.stringify({ errors: [{ message }] }));
const sources = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i + 1), name: "S" + (i + 1), supportsLatest: true }));

const start = (s) => G.due(s).reduce((acc, i) => G.reduce(acc, i, { type: "request" }), s);

test("one query asks every source for its first search page", () => {
  const s = G.search(sources(2), "berserk");
  assert.deepEqual(s.groups.map((g) => G.payload(g).variables), [
    { source: "1", type: "SEARCH", page: 1, query: "berserk" },
    { source: "2", type: "SEARCH", page: 1, query: "berserk" }
  ]);
});

test("at most LIMIT sources search at once; each answer frees a slot for the next", () => {
  let s = start(G.search(sources(G.LIMIT + 2), "q"));
  assert.equal(s.groups.filter((g) => g.state === "loading").length, G.LIMIT);
  assert.deepEqual(G.due(s), [], "no new request while every slot is busy");
  s = G.reduce(s, 2, { type: "reply", reply: ok([1]), config });
  assert.deepEqual(G.due(s), [G.LIMIT]);
});

test("results land per source, in any order, and a failure leaves the others alone", () => {
  let s = start(G.search(sources(3), "q"));
  s = G.reduce(s, 2, { type: "reply", reply: ok([7, 8]), config });
  assert.equal(G.status(s.groups[2], "/c"), "2 results");
  assert.equal(G.status(s.groups[0], "/c"), "searching");
  s = G.reduce(s, 0, { type: "reply", reply: fail("Exception while fetching data (/fetchSourceManga) : Cloudflare bypass currently disabled\n\tat x"), config });
  assert.match(G.status(s.groups[0], "/c"), /^This source needs FlareSolverr/);
  s = G.reduce(s, 1, { type: "reply", reply: ok([]), config });
  assert.match(G.status(s.groups[1], "/c"), /^No manga found/);
  assert.deepEqual(s.groups[2].items.map((m) => m.id), [7, 8]);
  assert.equal(G.status(G.search(sources(1), "q").groups[0], "/c"), "waiting");
  assert.equal(G.status(G.reduce(start(G.search(sources(1), "q")), 0, { type: "reply", reply: ok([1]), config }).groups[0], "/c"), "1 result");
});

test("a search never asks for a second page", () => {
  const s = G.reduce(start(G.search(sources(1), "q")), 0, { type: "reply", reply: ok([1]), config });
  assert.deepEqual(G.due(s), []);
});

test("retry queues only the failed sources again", () => {
  let s = start(G.search(sources(2), "q"));
  s = G.reduce(s, 0, { type: "reply", reply: fail("HTTP error 500"), config });
  s = G.reduce(s, 1, { type: "reply", reply: ok([1]), config });
  s = G.retry(s);
  assert.deepEqual(G.due(s), [0]);
  assert.deepEqual(s.groups[1].items.map((m) => m.id), [1]);
});

test("hjkl move between sources and along a source's results, clamped to what is there", () => {
  let s = start(G.search(sources(3), "q"));
  s = G.reduce(s, 0, { type: "reply", reply: ok([1, 2, 3]), config });
  s = G.reduce(s, 1, { type: "reply", reply: ok([4]), config });
  let c = { row: 0, col: 0 };
  c = G.move(s, c, 0, 5);
  assert.deepEqual(c, { row: 0, col: 2 });
  c = G.move(s, c, 1, 0);
  assert.deepEqual(c, { row: 1, col: 0 }, "a shorter row pulls the column in");
  c = G.move(s, c, 5, 0);
  assert.deepEqual(c, { row: 2, col: 0 });
  c = G.move(s, c, -9, -1);
  assert.deepEqual(c, { row: 0, col: 0 });
  assert.equal(G.current(s, { row: 0, col: 1 }).id, 2);
  assert.equal(G.current(s, { row: 2, col: 0 }), null);
});
