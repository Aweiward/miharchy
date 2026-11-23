const { test } = require("node:test");
const assert = require("node:assert/strict");
const D = require("./load")("DownloadsMove.js");

const status = (move) => ({ state: "ok", data: { state: "STOPPED", queue: [], move } });
const move = (over) => Object.assign({ state: "moving", done: 120, total: 800, from: "/old", to: "/new", error: null, startedAt: 1000 }, over);

test("the status is asked from download.queue, once a second", () => {
  assert.deepEqual(D.PAYLOAD, { route: "download.queue", body: {} });
  assert.equal(D.POLL_MS, 1000);
});

test("the move is the one a save started, not an earlier one", () => {
  assert.equal(D.moveOf(status(move()), 1000).done, 120);
  assert.equal(D.moveOf(status(move()), 500).state, "moving");
  assert.equal(D.moveOf(status(move({ state: "done" })), 1001), null, "a move from before the save");
  assert.equal(D.moveOf(status(null), 0), null);
  assert.equal(D.moveOf({ state: "down", message: "x" }, 0), null);
  assert.equal(D.moveOf(null, 0), null);
});

test("it polls only while core copies", () => {
  assert.equal(D.polling(move()), true);
  assert.equal(D.polling(move({ state: "done" })), false);
  assert.equal(D.polling(move({ state: "failed", error: "x" })), false);
  assert.equal(D.polling(null), false);
});

test("the row says how far the move is, what failed, and where the downloads went", () => {
  assert.equal(D.note(move()), "Moving downloads: 120 of 800 files");
  assert.equal(D.note(move({ done: 0, total: 0 })), "Moving downloads");
  assert.equal(D.note(move({ state: "failed", error: "/n/x: No space left on device" })), "Downloads not moved: /n/x: No space left on device");
  assert.equal(D.note(move({ state: "failed", error: null })), "Downloads not moved: core gave no reason");
  assert.equal(D.note(move({ state: "done", done: 800 })), "Downloads moved to /new.");
  assert.equal(D.note(null), "");
});

test("settings load again once, when the move is done", () => {
  assert.equal(D.reload(move(), move({ state: "done" })), true);
  assert.equal(D.reload(null, move({ state: "done" })), true, "a small move can end before the first answer");
  assert.equal(D.reload(move({ state: "done" }), move({ state: "done" })), false);
  assert.equal(D.reload(move(), move()), false);
  assert.equal(D.reload(move(), move({ state: "failed", error: "x" })), false);
  assert.equal(D.reload(move(), null), false);
});
