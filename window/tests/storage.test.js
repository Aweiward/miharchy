const { test } = require("node:test");
const assert = require("node:assert/strict");
const S = require("./load")("Storage.js");

const home = { HOME: "/home/u" };

test("the folders are the server's: its root's downloads and the JVM's /tmp cache", () => {
  assert.deepEqual(S.dirs(home, ""), {
    downloads: "/home/u/.local/share/miharchy/suwayomi/downloads",
    cache: ["/tmp/Tachidesk/manga-cache", "/tmp/Tachidesk/thumbnails"]
  });
  assert.equal(S.dirs(home, "/mnt/manga").downloads, "/mnt/manga", "a download folder setting wins");
});

test("a scratch server's root and tmpdir replace the real ones", () => {
  const d = S.dirs({ HOME: "/home/u", MIHARCHY_SERVER_ROOT: "/s/server", MIHARCHY_SERVER_TMPDIR: "/s/server/tmp" }, "");
  assert.deepEqual(d, { downloads: "/s/server/downloads", cache: ["/s/server/tmp/Tachidesk/manga-cache", "/s/server/tmp/Tachidesk/thumbnails"] });
  assert.deepEqual(S.command(d), ["du", "-s", "-B1", "--", "/s/server/downloads", "/s/server/tmp/Tachidesk/manga-cache", "/s/server/tmp/Tachidesk/thumbnails"]);
});

test("du's lines add up to downloads and cache, and a folder du skipped holds nothing", () => {
  const d = S.dirs(home, "/mnt/my manga");
  const out = "5000\t/mnt/my manga\n1200\t/tmp/Tachidesk/manga-cache\n34\t/tmp/Tachidesk/thumbnails\n";
  assert.deepEqual(S.sizes(d, out), { downloads: 5000, cache: 1234 });
  assert.deepEqual(S.sizes(d, "1200\t/tmp/Tachidesk/manga-cache\n"), { downloads: 0, cache: 1200 });
  assert.deepEqual(S.sizes(d, ""), { downloads: 0, cache: 0 });
});

test("the clear asks for cached pages and cached covers only, never the library's covers", () => {
  const q = S.clearPayload().query;
  assert.match(q, /clearCachedImages\(input: \{ cachedPages: true, cachedThumbnails: true \}\)/);
  assert.doesNotMatch(q, /downloadedThumbnails/);
  assert.equal(S.cleared({ clearCachedImages: { cachedPages: true, cachedThumbnails: true } }), true);
  assert.equal(S.cleared({ clearCachedImages: { cachedPages: true, cachedThumbnails: false } }), false);
});

test("sizes read in decimal units", () => {
  assert.equal(S.format(0), "0 B");
  assert.equal(S.format(999), "999 B");
  assert.equal(S.format(1234), "1.2 kB");
  assert.equal(S.format(56700000), "56.7 MB");
  assert.equal(S.format(3.2e9), "3.2 GB");
});
