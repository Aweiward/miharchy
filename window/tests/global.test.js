const { test } = require("node:test");
const assert = require("node:assert/strict");
const G = require("./load")("GlobalSearch.js");
const M = require("./load")("Model.js");

const config = { url: "http://127.0.0.1:4590", username: "u", password: "p" };
const ok = (ids) => M.reply(200, JSON.stringify({ data: { fetchSourceManga: { hasNextPage: true, mangas: ids.map((id) => ({ id, title: "M" + id, thumbnailUrl: null, inLibrary: false })) } } }));
const fail = (message) => M.reply(200, JSON.stringify({ errors: [{ message }] }));
const sources = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i + 1), name: "S" + (i + 1), supportsLatest: true }));

const start = (s, now = 0) => G.due(s).reduce((acc, i) => G.reduce(acc, i, { type: "request", now }), s);
// A reply to the group's current request, as the view sends it.
const answer = (s, i, reply) => G.reduce(s, i, { type: "reply", attempt: s.groups[i].attempt, reply, config });

test("one query asks every source for its first search page", () => {
  const s = G.search(sources(2), "berserk");
  assert.deepEqual(s.groups.map((g) => G.payload(g).variables), [
    { source: "1", type: "SEARCH", page: 1, query: "berserk", filters: [] },
    { source: "2", type: "SEARCH", page: 1, query: "berserk", filters: [] }
  ]);
});

test("at most LIMIT sources search at once; each answer frees a slot for the next", () => {
  let s = start(G.search(sources(G.LIMIT + 2), "q"));
  assert.equal(s.groups.filter((g) => g.state === "loading").length, G.LIMIT);
  assert.deepEqual(G.due(s), [], "no new request while every slot is busy");
  s = answer(s, 2, ok([1]));
  assert.deepEqual(G.due(s), [G.LIMIT]);
});

test("results land per source, in any order, and a failure leaves the others alone", () => {
  let s = start(G.search(sources(3), "q"));
  s = answer(s, 2, ok([7, 8]));
  assert.equal(G.status(s.groups[2], "/c"), "2 results");
  assert.equal(G.status(s.groups[0], "/c"), "searching");
  s = answer(s, 0, fail("Exception while fetching data (/fetchSourceManga) : Cloudflare bypass currently disabled\n\tat x"));
  assert.match(G.status(s.groups[0], "/c"), /^This source needs FlareSolverr/);
  s = answer(s, 1, ok([]));
  assert.match(G.status(s.groups[1], "/c"), /^No manga found/);
  assert.deepEqual(s.groups[2].items.map((m) => m.id), [7, 8]);
  assert.equal(G.status(G.search(sources(1), "q").groups[0], "/c"), "waiting");
  assert.equal(G.status(answer(start(G.search(sources(1), "q")), 0, ok([1])).groups[0], "/c"), "1 result");
});

test("a search never asks for a second page", () => {
  const s = answer(start(G.search(sources(1), "q")), 0, ok([1]));
  assert.deepEqual(G.due(s), []);
});

test("retry queues only the failed sources again", () => {
  let s = start(G.search(sources(2), "q"));
  s = answer(s, 0, fail("HTTP error 500"));
  s = answer(s, 1, ok([1]));
  s = G.retry(s);
  assert.deepEqual(G.due(s), [0]);
  assert.deepEqual(s.groups[1].items.map((m) => m.id), [1]);
});

test("hjkl move between sources and along a source's results, clamped to what is there", () => {
  let s = start(G.search(sources(3), "q"));
  s = answer(s, 0, ok([1, 2, 3]));
  s = answer(s, 1, ok([4]));
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

test("a source that has not answered TIMEOUT after its request times out", () => {
  let s = start(G.search(sources(G.LIMIT + 1), "q"), 1000);
  assert.deepEqual(G.expired(s, 1000 + G.TIMEOUT - 1), []);
  s = answer(s, 1, ok([1]));
  s = G.reduce(s, G.LIMIT, { type: "request", now: 2000 });
  assert.deepEqual(G.expired(s, 1000 + G.TIMEOUT), [0, 2, 3, 4], "only searching sources past their own deadline");
  s = G.reduce(s, 0, { type: "timeout" });
  assert.equal(G.status(s.groups[0], "/c"), "timed out. Press r to retry.");
  assert.deepEqual(G.expired(s, 1000 + G.TIMEOUT), [2, 3, 4]);
  assert.equal(G.reduce(s, 1, { type: "timeout" }).groups[1], s.groups[1], "an answered source cannot time out");
});

test("a timed out source frees its slot for the next one", () => {
  let s = start(G.search(sources(G.LIMIT + 1), "q"));
  assert.deepEqual(G.due(s), []);
  s = G.reduce(s, 3, { type: "timeout" });
  assert.deepEqual(G.due(s), [G.LIMIT]);
});

test("a reply after the timeout is dropped, also once r has asked again", () => {
  let s = start(G.search(sources(1), "q"));
  const first = s.groups[0].attempt;
  s = G.reduce(s, 0, { type: "timeout" });
  assert.equal(G.reduce(s, 0, { type: "reply", attempt: first, reply: M.reply(0, ""), config }), s, "the abort's status 0 does not read as a server that is down");
  s = G.retry(s);
  assert.deepEqual(G.due(s), [0], "r retries a timed out source");
  s = start(s);
  assert.equal(G.reduce(s, 0, { type: "reply", attempt: first, reply: ok([1]), config }), s, "the first request's reply does not answer the second");
  s = answer(s, 0, ok([2]));
  assert.deepEqual(s.groups[0].items.map((m) => m.id), [2]);
});
