const { test } = require("node:test");
const assert = require("node:assert/strict");
const S = require("./load")("Storage.js");

const home = { HOME: "/home/u" };

test("the local folder is the setting, or the server root's local", () => {
  assert.equal(S.localFolder(home, ""), "/home/u/.local/share/miharchy/suwayomi/local");
  assert.equal(S.localFolder({ HOME: "/home/u", MIHARCHY_SERVER_ROOT: "/s/server" }, undefined), "/s/server/local");
  assert.equal(S.localFolder(home, "/mnt/comics"), "/mnt/comics");
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
