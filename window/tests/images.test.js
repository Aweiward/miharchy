const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load");

const Images = load("Images.js");

// A fake server and file system: fetches wait until answered, files are a map.
function world(idleBytes, maxAge) {
  const w = { requests: [], files: new Map(), time: 0 };
  w.cache = Images.cache("/run/images/", idleBytes, maxAge === undefined ? 60000 : maxAge, () => w.time);
  w.fetch = (url, done) => w.requests.push({ url, done });
  w.answer = (i, r) => w.requests[i].done(r || { status: 200, data: new ArrayBuffer(10), contentType: "image/png" });
  w.holder = (name) => {
    const h = { name, shown: [], failed: false };
    h.show = (file, type) => h.shown.push({ file, type, bytes: w.files.get(file) });
    h.fail = () => { h.failed = true; };
    h.write = (file, data) => { w.files.set(file, data.byteLength); return !w.full; };
    h.empty = (file) => { w.files.set(file, 0); };
    return h;
  };
  w.hold = (url, h) => Images.hold(w.cache, url, h, w.fetch);
  w.held = () => [...w.files.values()].filter((n) => n > 0).length;
  return w;
}

test("instances asking for one URL at once make one request, and all show it", () => {
  const w = world(0);
  const a = w.holder("a"), b = w.holder("b");
  w.hold("u", a);
  w.hold("u", b);
  assert.equal(w.requests.length, 1);
  w.answer(0);
  assert.deepEqual(a.shown.map((s) => s.file), b.shown.map((s) => s.file));
  assert.equal(a.shown[0].type, "image/png");
  assert.equal(a.shown[0].bytes, 10, "the file holds the bytes when shown");
});

test("a new instance with a URL already held shows it at once, without a request", () => {
  const w = world(0);
  const a = w.holder("a"), b = w.holder("b");
  w.hold("u", a);
  w.answer(0);
  w.hold("u", b);
  assert.equal(w.requests.length, 1);
  assert.equal(b.shown.length, 1, "shown during hold, before any reply");
  assert.equal(b.shown[0].file, a.shown[0].file);
});

test("a copy released without idle empties at once, however much room there is", () => {
  const w = world(1000);
  const a = w.holder("a");
  const e = w.hold("page", a);
  w.answer(0);
  Images.release(w.cache, e, a, false);
  assert.equal(w.held(), 0);
  w.hold("page", w.holder("b"));
  assert.equal(w.requests.length, 2);
});

test("the file empties when the last holder lets go, with no idle room", () => {
  const w = world(0);
  const a = w.holder("a"), b = w.holder("b");
  const e = w.hold("u", a);
  w.hold("u", b);
  w.answer(0);
  Images.release(w.cache, e, a, true);
  assert.equal(w.held(), 1, "b still holds it");
  Images.release(w.cache, e, b, true);
  assert.equal(w.held(), 0);
  w.hold("u", w.holder("c"));
  assert.equal(w.requests.length, 2, "a later hold fetches again");
});

test("a rebuilt delegate finds its idle copy without a request", () => {
  const w = world(100);
  const a = w.holder("a");
  const e = w.hold("u", a);
  w.answer(0);
  Images.release(w.cache, e, a, true);
  assert.equal(w.held(), 1, "the idle copy keeps its file");
  const b = w.holder("b");
  w.hold("u", b);
  assert.equal(w.requests.length, 1);
  assert.equal(b.shown.length, 1);
});

test("idle copies stay within the byte bound, oldest out first", () => {
  const w = world(25);
  for (let i = 0; i < 5; i++) {
    const h = w.holder("h" + i);
    const e = w.hold("u" + i, h);
    w.answer(i);
    Images.release(w.cache, e, h, true);
    assert.ok(w.held() * 10 <= 25, "idle files within the bound after " + (i + 1));
  }
  w.hold("u4", w.holder("x"));
  w.hold("u0", w.holder("y"));
  assert.deepEqual(w.requests.map((r) => r.url), ["u0", "u1", "u2", "u3", "u4", "u0"], "u4 stayed, u0 was evicted");
});

test("a held copy is never evicted for room", () => {
  const w = world(0);
  const a = w.holder("a"), b = w.holder("b");
  w.hold("u", a);
  w.answer(0);
  const e = w.hold("v", b);
  w.answer(1);
  Images.release(w.cache, e, b, true);
  assert.equal(w.held(), 1);
  assert.equal(w.files.get(a.shown[0].file), 10);
});

test("a copy past the max age is fetched again under a new file name", () => {
  const w = world(100, 1000);
  const a = w.holder("a"), b = w.holder("b");
  const old = w.hold("u", a);
  w.answer(0);
  w.time = 1001;
  w.hold("u", b);
  assert.equal(w.requests.length, 2);
  w.answer(1, { status: 200, data: new ArrayBuffer(20), contentType: "image/png" });
  assert.notEqual(b.shown[0].file, a.shown[0].file, "a new name, so no decode of the old bytes shows");
  assert.equal(b.shown[0].bytes, 20);
  Images.release(w.cache, old, a, true);
  assert.equal(w.files.get(a.shown[0].file), 0, "the old file empties when its last holder goes");
  assert.equal(w.held(), 1);
});

test("an idle copy past the max age empties as a new hold replaces it", () => {
  const w = world(100, 1000);
  const a = w.holder("a");
  const e = w.hold("u", a);
  w.answer(0);
  Images.release(w.cache, e, a, true);
  w.time = 2000;
  w.hold("u", w.holder("b"));
  assert.equal(w.files.get(a.shown[0].file), 0);
  assert.equal(w.requests.length, 2);
});

test("a failed fetch fails every waiting holder and the next hold tries again", () => {
  const w = world(100);
  const a = w.holder("a"), b = w.holder("b");
  w.hold("u", a);
  w.hold("u", b);
  w.answer(0, { status: 500, data: null, contentType: "" });
  assert.ok(a.failed && b.failed);
  assert.equal(w.held(), 0);
  w.hold("u", w.holder("c"));
  assert.equal(w.requests.length, 2);
});

test("a failed write fails the holders and leaves nothing cached", () => {
  const w = world(100);
  const a = w.holder("a");
  w.full = true;
  w.hold("u", a);
  w.answer(0);
  assert.ok(a.failed);
  assert.equal(a.shown.length, 0);
  w.full = false;
  w.hold("u", w.holder("b"));
  assert.equal(w.requests.length, 2);
});

test("a fetch every holder left writes nothing, and a hold before it lands waits on it", () => {
  const w = world(100);
  const a = w.holder("a");
  Images.release(w.cache, w.hold("u", a), a, true);
  const b = w.holder("b");
  w.hold("u", b);
  assert.equal(w.requests.length, 1, "the fetch in flight serves the new hold");
  w.answer(0);
  assert.equal(b.shown.length, 1);
  const c = w.holder("c");
  Images.release(w.cache, w.hold("v", c), c, true);
  w.answer(1);
  assert.equal(w.files.size, 1, "no file for v");
});

test("a fetch that answers at once still shows its holder", () => {
  const w = world(0);
  const a = w.holder("a");
  Images.hold(w.cache, "u", a, (url, done) => done({ status: 200, data: new ArrayBuffer(10), contentType: "image/png" }));
  assert.equal(a.shown.length, 1);
});

test("drain hands over every file still holding bytes, held or idle, once", () => {
  const w = world(100);
  const a = w.holder("a"), b = w.holder("b"), c = w.holder("c");
  w.hold("held", a);
  w.answer(0);
  const idle = w.hold("idle", b);
  w.answer(1);
  Images.release(w.cache, idle, b, true);
  const gone = w.hold("gone", c);
  w.answer(2);
  w.time = 120000;
  w.hold("gone", w.holder("d"));
  w.answer(3);
  Images.release(w.cache, gone, c, true);
  const drained = Images.drain(w.cache);
  assert.deepEqual(drained.sort(), [...w.files].filter(([, n]) => n > 0).map(([f]) => f).sort());
  assert.equal(drained.length, 3);
  assert.deepEqual(Images.drain(w.cache), []);
});

test("each fetch writes a new file name, under the dir", () => {
  const w = world(0);
  const a = w.holder("a");
  const e = w.hold("u", a);
  w.answer(0);
  Images.release(w.cache, e, a, true);
  const b = w.holder("b");
  w.hold("u", b);
  w.answer(1);
  assert.notEqual(a.shown[0].file, b.shown[0].file);
  assert.ok(a.shown[0].file.startsWith("/run/images/"));
});
