const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const R = require("./load")("Runtime.js");

const check = (dir) => R.decide(dir, execFileSync(R.checkCommand(dir)[0], R.checkCommand(dir).slice(1), { encoding: "utf8" }));

test("no XDG_RUNTIME_DIR gives no folder, never a path from /", () => {
  assert.equal(R.candidate(undefined), "");
  assert.equal(R.candidate(""), "");
  assert.equal(R.decide("", "ok"), "");
  assert.equal(R.folder(), "");
});

test("every QML file takes the runtime folder from Runtime.js, never from XDG_RUNTIME_DIR itself", () => {
  for (const d of ["..", "../../plugin"]) {
    const dir = path.join(__dirname, d);
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".qml"))) {
      const reads = fs.readFileSync(path.join(dir, f), "utf8").match(/.*env\("XDG_RUNTIME_DIR"\).*/g) || [];
      for (const line of reads) assert.match(line, /Runtime\.candidate\(Quickshell\.env\("XDG_RUNTIME_DIR"\)\)/, f + ": " + line.trim());
    }
  }
});

test("the folder is made private and decided once it is the user's own real directory", () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "miharchy-runtime-"));
  const dir = R.candidate(runtime);
  assert.equal(dir, runtime + "/miharchy");
  assert.equal(check(dir), dir);
  assert.equal(R.folder(), dir);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700, "the folder is private");
  assert.equal(fs.statSync(dir + "/images").mode & 0o777, 0o700, "images/ is private");
});

test("a symlink planted at the folder fails closed and nothing is written through it", () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "miharchy-runtime-"));
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "miharchy-planted-"));
  fs.symlinkSync(target, path.join(runtime, "miharchy"));
  assert.equal(check(R.candidate(runtime)), "");
  assert.equal(R.folder(), "");
  assert.deepEqual(fs.readdirSync(target), [], "nothing written through the symlink");
});
