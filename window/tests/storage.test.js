const { test } = require("node:test");
const assert = require("node:assert/strict");
const S = require("./load")("Storage.js");

test("the local folder is the one core reads, from its storage reply", () => {
  assert.equal(S.localFolderOf({ state: "ok", data: { settings: {}, localFolder: "/mnt/comics" } }), "/mnt/comics");
  assert.equal(S.localFolderOf({ state: "ok", data: { downloads: 0 } }), "");
  assert.equal(S.localFolderOf({ state: "down", message: "x" }), "");
  assert.equal(S.localFolderOf(null), "");
});

test("the server root is MIHARCHY_SERVER_ROOT, or under HOME", () => {
  assert.equal(S.root({ HOME: "/home/u" }), "/home/u/.local/share/miharchy/suwayomi");
  assert.equal(S.root({ HOME: "/home/u", MIHARCHY_SERVER_ROOT: "/s/server" }), "/s/server");
});

test("sizes read in decimal units", () => {
  assert.equal(S.format(0), "0 B");
  assert.equal(S.format(999), "999 B");
  assert.equal(S.format(1234), "1.2 kB");
  assert.equal(S.format(56700000), "56.7 MB");
  assert.equal(S.format(3.2e9), "3.2 GB");
});

test("the sizes and the clear are core's routes", () => {
  assert.deepEqual(S.SIZES_PAYLOAD, { route: "storage.get", body: {} });
  assert.deepEqual(S.CORE_CLEAR_PAYLOAD, { route: "cache.clear", body: {} });
});
