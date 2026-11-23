const { test } = require("node:test");
const assert = require("node:assert/strict");
const B = require("./load")("Backup.js");

const reply = (r) => B.reduce(B.reduce(B.initial(), { type: "start" }), { type: "reply", reply: r });

test("the row says what runs, the file written, or why it failed", () => {
  assert.equal(B.note(B.initial()), "");
  assert.equal(B.note(B.reduce(B.initial(), { type: "start" })), "writing");
  const done = reply({ state: "ok", data: { file: "/b/miharchy-backup-2026-10-05_00-00-00.tachibk" } });
  assert.deepEqual(done, { state: "done", file: "/b/miharchy-backup-2026-10-05_00-00-00.tachibk" });
  assert.equal(B.note(done), "Wrote /b/miharchy-backup-2026-10-05_00-00-00.tachibk");
  assert.equal(B.note(reply({ state: "error", message: "/s is the sync folder. Choose another backup folder in Settings." })), "/s is the sync folder. Choose another backup folder in Settings.");
  assert.equal(B.note(reply({ state: "error", message: "A sync is already running." })), "A sync is already running.");
  assert.match(B.note(reply({ state: "down" })), /not running/);
});

test("the backup is a route that names no folder, and its reply is the file written", () => {
  assert.deepEqual(B.PAYLOAD, { route: "backup.export", body: {} });
  assert.deepEqual(reply({ state: "ok", data: { file: "/core/backups/miharchy-backup-x.tachibk" } }),
    { state: "done", file: "/core/backups/miharchy-backup-x.tachibk" });
});
