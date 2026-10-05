const { test } = require("node:test");
const assert = require("node:assert/strict");
const execFile = require("node:util").promisify(require("node:child_process").execFile);
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const B = require("./load")("Backup.js");

const finish = (output, code) => B.reduce(B.reduce(B.initial(), { type: "start" }), { type: "finish", text: output + "\n" + code + "\n" });

test("the backup goes to the backup folder row, or to the server's own backups folder", () => {
  assert.equal(B.folder("/home/u/Backups", { HOME: "/home/u" }), "/home/u/Backups");
  assert.equal(B.folder("", { HOME: "/home/u" }), "/home/u/.local/share/miharchy/suwayomi/backups");
  assert.equal(B.folder("", { HOME: "/home/u", MIHARCHY_SERVER_ROOT: "/scratch/server" }), "/scratch/server/backups");
});

test("the row says what runs, the file written, or why it failed", () => {
  assert.equal(B.note(B.initial()), "");
  assert.equal(B.note(B.reduce(B.initial(), { type: "start" })), "writing");
  const done = finish('WARNING: a JVM line\n{"file":"/b/miharchy-backup-2026-10-05_00-00-00.tachibk"}', 0);
  assert.deepEqual(done, { state: "done", file: "/b/miharchy-backup-2026-10-05_00-00-00.tachibk" });
  assert.equal(B.note(done), "Wrote /b/miharchy-backup-2026-10-05_00-00-00.tachibk");
  assert.equal(B.note(finish("/s is the sync folder. Choose another backup folder in Settings.", 1)), "/s is the sync folder. Choose another backup folder in Settings.");
  assert.equal(B.note(finish("A sync is already running.", 1)), "A sync is already running.");
  assert.equal(B.note(finish("", 127)), "The sync helper is not built. Build it in Setup.");
  assert.equal(B.note(finish("", 3)), "The sync helper stopped with status 3.");
});

test("the folder reaches the helper as one argument, never as shell text", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "backup-"));
  const dev = path.join(home, "dev-helper");
  fs.writeFileSync(dev, '#!/bin/sh\nprintf \'{"file":"%s|%s"}\\n\' "$1" "$2"\n', { mode: 0o755 });
  const [cmd, ...args] = B.command(dev, "/tmp/a b; touch x");
  const { stdout } = await execFile(cmd, args, { env: { HOME: home, PATH: process.env.PATH } });
  assert.deepEqual(B.reduce({ state: "running" }, { type: "finish", text: stdout }), { state: "done", file: "backup|/tmp/a b; touch x" });
});
