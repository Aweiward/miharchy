const { test } = require("node:test");
const assert = require("node:assert/strict");
const R = require("./load")("Restore.js");

const reply = (data) => ({ type: "checked-reply", reply: { state: "ok", data } });
const checking = { step: "checking", path: "/home/u/Sync/phone.tachibk" };

test("the path starts in the sync folder and keeps the last file", () => {
  assert.deepEqual(R.reduce(R.initial(), { type: "open", folder: "/home/u/Sync" }), { step: "path", path: "/home/u/Sync/" });
  assert.deepEqual(R.reduce(R.initial(), { type: "open", folder: "" }), { step: "path", path: "" });
  const done = { step: "done", path: "/x/b.tachibk" };
  assert.deepEqual(R.reduce(done, { type: "open", folder: "/home/u/Sync" }), { step: "path", path: "/x/b.tachibk" });
  const running = { step: "running", path: "/x/b.tachibk" };
  assert.equal(R.reduce(running, { type: "open", folder: "/y" }), running);
});

test("Undo the last sync opens on the file it names, over the last file and the sync folder", () => {
  const done = { step: "done", path: "/x/b.tachibk" };
  const pre = "/home/u/.local/share/miharchy/sync/pre-sync.tachibk";
  assert.deepEqual(R.reduce(done, { type: "open", folder: "/home/u/Sync", path: pre }), { step: "path", path: pre });
  assert.deepEqual(R.reduce(R.initial(), { type: "open", folder: "/home/u/Sync", path: pre }), { step: "path", path: pre });
});

test("a path is absolute or starts with ~; any other stays in the field with a hint", () => {
  const check = (text) => R.reduce(R.initial(), { type: "check", text: text, home: "/home/u" });
  assert.deepEqual(check(" ~/Sync/a.tachibk "), { step: "checking", path: "/home/u/Sync/a.tachibk" });
  assert.deepEqual(check("/a.tachibk"), { step: "checking", path: "/a.tachibk" });
  for (const text of ["a.tachibk", "~x/a.tachibk"]) {
    const s = check(text);
    assert.equal(s.step, "path");
    assert.equal(s.path, text);
    assert.deepEqual(R.lines(s), ["Enter an absolute path, such as ~/Sync/Mihon/backup.tachibk."]);
  }
});

test("the check lists the missing sources and trackers before the restore, in Mihon's words", () => {
  const s = R.reduce(checking, reply({ file: checking.path, missingSources: ["MangaDex"], missingTrackers: ["MyAnimeList"] }));
  assert.equal(s.step, "confirm");
  assert.deepEqual(R.lines(s).slice(1), [
    "", "Missing sources:", "- MangaDex",
    "", "Trackers not logged in:", "- MyAnimeList",
    "", "Install the missing extensions and log in to the trackers afterwards to use them."
  ]);
  const clean = R.reduce(checking, reply({ file: checking.path, missingSources: [], missingTrackers: [] }));
  assert.equal(R.lines(clean).length, 1);
  assert.equal(R.hint(clean), "enter restore   esc cancel");
});

test("a confirmed restore says what it restores", () => {
  const s = R.reduce({ step: "confirm", path: "/b.tachibk", missingSources: [], missingTrackers: [] }, { type: "start" });
  assert.deepEqual(R.lines(s), ["Restoring /b.tachibk."]);
  assert.equal(R.hint(s), "esc hide (the restore goes on)");
});

test("on core the check and the restore are routes, and the undo asks core for the file", () => {
  const R = require("./load")("Restore.js");
  const path = { step: "checking", path: "/s/b.tachibk" };
  assert.deepEqual(R.checkPayload(path), { route: "backup.check", body: { file: "/s/b.tachibk" } });
  const undo = R.reduce(R.initial(), { type: "check-presync" });
  assert.deepEqual(R.checkPayload(undo), { route: "backup.check", body: { preSync: true } });
  assert.deepEqual(R.lines(undo), ["Reading the library from before the last sync."]);
  const data = { file: "/core/sync/pre-sync.tachibk", missingSources: ["Gone"], missingTrackers: [] };
  const confirm = R.reduce(undo, { type: "checked-reply", reply: { state: "ok", data } });
  assert.equal(confirm.step, "confirm");
  assert.equal(confirm.path, "/core/sync/pre-sync.tachibk");
  assert.deepEqual(R.importPayload(confirm), { route: "backup.import", body: { file: "/core/sync/pre-sync.tachibk" } });
  const running = R.reduce(confirm, { type: "start" });
  assert.deepEqual(R.lines(R.reduce(running, { type: "finish-reply", reply: { state: "ok", data: { manga: 3 } } })), ["Restored /core/sync/pre-sync.tachibk."]);
  const refused = R.reduce(running, { type: "finish-reply", reply: { state: "error", message: "A sync is already running." } });
  assert.deepEqual(R.lines(refused), ["A sync is already running."]);
  assert.deepEqual(R.lines(R.reduce(undo, { type: "checked-reply", reply: { state: "error", message: "There is no sync to undo yet." } })), ["There is no sync to undo yet."]);
});
