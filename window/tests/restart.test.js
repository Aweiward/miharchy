const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const R = require("./load")("Restart.js");

const run = (cmd, env) => execFileSync(cmd[0], cmd.slice(1), { encoding: "utf8", env: env || process.env });

test("the fingerprint changes with the window's QML or JS, and nothing else in its folder", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miharchy-restart-"));
  fs.writeFileSync(path.join(dir, "shell.qml"), "a");
  fs.writeFileSync(path.join(dir, "Model.js"), "b");
  const print = () => R.check(R.INITIAL, run(R.fingerprintCommand(dir))).start;
  const first = print();
  assert.match(first, /^[0-9a-f]{64}$/);
  fs.writeFileSync(path.join(dir, "notes.txt"), "x");
  fs.mkdirSync(path.join(dir, "tests"));
  fs.writeFileSync(path.join(dir, "tests", "x.test.js"), "x");
  assert.equal(print(), first, "files the window does not load");
  fs.writeFileSync(path.join(dir, "Model.js"), "c");
  assert.notEqual(print(), first, "a changed JS module");
  fs.writeFileSync(path.join(dir, "Model.js"), "b");
  fs.writeFileSync(path.join(dir, "New.qml"), "d");
  assert.notEqual(print(), first, "a new QML file");
});

test("the first check keeps what the window loaded; a later one tells whether the disk differs", () => {
  const a = "a".repeat(64) + "  -\n";
  const b = "b".repeat(64) + "  -\n";
  const s = R.check(R.INITIAL, a);
  assert.deepEqual(s, { start: "a".repeat(64), changed: false });
  assert.equal(R.check(s, a).changed, false);
  const moved = R.check(s, b);
  assert.deepEqual(moved, { start: "a".repeat(64), changed: true });
  assert.equal(R.check(moved, a).changed, false, "a revert is the code that runs again");
  assert.equal(R.check(moved, ""), moved, "a failed check changes nothing");
  assert.equal(R.check(R.INITIAL, "cat: x: No such file"), R.INITIAL);
});

test("the relaunch waits for the old process to end, then runs the launcher without the old open target", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miharchy-relaunch-"));
  const out = path.join(dir, "out");
  const launcher = path.join(dir, "miharchy");
  fs.writeFileSync(launcher, '#!/bin/sh\necho "ran chapter=${MIHARCHY_OPEN_CHAPTER-unset} view=${MIHARCHY_OPEN_VIEW-unset}" > "' + out + '"\n', { mode: 0o755 });
  const old = spawn("sleep", ["30"]);
  const cmd = R.relaunchCommand(old.pid, launcher);
  const waiter = spawn(cmd[0], cmd.slice(1), { env: { ...process.env, MIHARCHY_OPEN_CHAPTER: "1 2", MIHARCHY_OPEN_VIEW: "updates" } });
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(fs.existsSync(out), false, "the launcher waits while the old window runs");
  old.kill();
  await new Promise((r) => waiter.on("exit", r));
  assert.equal(fs.readFileSync(out, "utf8"), "ran chapter=unset view=unset\n");
});
