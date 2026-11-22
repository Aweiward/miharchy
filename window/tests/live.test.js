const { test } = require("node:test");
const assert = require("node:assert/strict");
const L = require("./load")("Live.js");

test("the socket pings often, and core answers a ping with a pong the socket ignores", () => {
  assert.ok(L.PING_MS <= 10000);
  assert.deepEqual(JSON.parse(L.PING), { type: "ping" });
  assert.deepEqual(L.parseCore(JSON.stringify({ type: "pong" }), "updates"), { type: "none" });
});

test("a topic's message is its data; another topic's or a malformed one changes nothing", () => {
  assert.deepEqual(L.parseCore(JSON.stringify({ topic: "updates", data: { isRunning: true } }), "updates"), { type: "data", data: { isRunning: true } });
  assert.deepEqual(L.parseCore(JSON.stringify({ topic: "downloads", data: {} }), "updates"), { type: "none" });
  assert.deepEqual(L.parseCore("not json", "updates"), { type: "none" });
});

test("reconnects back off from 1 s to at most 15 s", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 20].map(L.backoff), [1000, 2000, 4000, 8000, 15000, 15000, 15000]);
});
