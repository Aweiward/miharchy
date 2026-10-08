const { test } = require("node:test");
const assert = require("node:assert/strict");
const execFile = require("node:util").promisify(require("node:child_process").execFile);
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const R = require("./load")("Restore.js");

const job = (output, code) => output + "\n" + code + "\n";
const checking = { step: "checking", path: "/home/u/Sync/phone.tachibk" };

test("the path starts in the sync folder and keeps the last file", () => {
  assert.deepEqual(R.reduce(R.initial(), { type: "open", folder: "/home/u/Sync" }), { step: "path", path: "/home/u/Sync/" });
  assert.deepEqual(R.reduce(R.initial(), { type: "open", folder: "" }), { step: "path", path: "" });
  const done = { step: "done", path: "/x/b.tachibk", progress: { state: "SUCCESS", mangaProgress: 0, totalManga: 0 } };
  assert.deepEqual(R.reduce(done, { type: "open", folder: "/home/u/Sync" }), { step: "path", path: "/x/b.tachibk" });
  const running = { step: "running", path: "/x/b.tachibk", progress: null };
  assert.equal(R.reduce(running, { type: "open", folder: "/y" }), running);
});

test("Undo the last sync opens on the file it names, over the last file and the sync folder", () => {
  const done = { step: "done", path: "/x/b.tachibk", progress: { state: "SUCCESS", mangaProgress: 0, totalManga: 0 } };
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
  const s = R.reduce(checking, { type: "checked", text: job("WARNING: a JVM note\n" + JSON.stringify({ missingSources: ["MangaDex"], missingTrackers: ["MyAnimeList"] }), 0) });
  assert.equal(s.step, "confirm");
  assert.deepEqual(R.lines(s).slice(1), [
    "", "Missing sources:", "- MangaDex",
    "", "Trackers not logged in:", "- MyAnimeList",
    "", "Install the missing extensions and log in to the trackers afterwards to use them."
  ]);
  const clean = R.reduce(checking, { type: "checked", text: job(JSON.stringify({ missingSources: [], missingTrackers: [] }), 0) });
  assert.equal(R.lines(clean).length, 1);
  assert.equal(R.hint(clean), "enter restore   esc cancel");
});

test("a file that is not a backup fails with the helper's message", () => {
  const s = R.reduce(checking, { type: "checked", text: job("/etc/hostname is not a Mihon backup: Not in GZIP format", 1) });
  assert.deepEqual(R.lines(s), ["/etc/hostname is not a Mihon backup: Not in GZIP format"]);
  assert.deepEqual(R.reduce(checking, { type: "checked", text: job("", 127) }).message, "The sync helper is not built. Build it in the window: press : and choose Setup.");
});

test("the restore shows each progress line, then the result", () => {
  let s = R.reduce({ step: "confirm", path: "/b.tachibk", missingSources: [], missingTrackers: [] }, { type: "start" });
  assert.deepEqual(R.lines(s), ["Restoring /b.tachibk."]);
  s = R.reduce(s, { type: "line", text: "WARNING: a JVM note" });
  assert.equal(s.progress, null);
  s = R.reduce(s, { type: "line", text: JSON.stringify({ state: "RESTORING_MANGA", mangaProgress: 3, totalManga: 216 }) });
  assert.deepEqual(R.lines(s), ["Restoring manga: 3 of 216 manga."]);
  s = R.reduce(s, { type: "line", text: "0" });
  assert.equal(s.progress.mangaProgress, 3);
  const out = [{ state: "RESTORING_MANGA", mangaProgress: 3, totalManga: 216 }, { state: "SUCCESS", mangaProgress: 216, totalManga: 216 }].map((p) => JSON.stringify(p)).join("\n");
  const done = R.reduce(s, { type: "finish", text: job(out, 0) });
  assert.equal(done.step, "done");
  assert.deepEqual(R.lines(done), ["Restored /b.tachibk."]);
});

test("a restore refused or failed shows why", () => {
  const running = { step: "running", path: "/b.tachibk", progress: null };
  assert.deepEqual(R.reduce(running, { type: "finish", text: job("A sync is already running.", 1) }).message, "A sync is already running.");
  const s = R.reduce(running, { type: "finish", text: job(JSON.stringify({ state: "RESTORING_MANGA", mangaProgress: 1, totalManga: 2 }) + "\nSuwayomi could not restore the backup.", 1) });
  assert.deepEqual(R.lines(s), ["Suwayomi could not restore the backup."]);
});

test("the real command hands the path to the helper as one argument", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "restore-"));
  const helper = path.join(dir, "miharchy-sync");
  fs.writeFileSync(helper, "#!/bin/sh\nprintf '%s|' \"$@\"\n", { mode: 0o755 });
  const argv = R.command(helper, "check", "/a b/$(touch x)'.tachibk");
  const { stdout } = await execFile(argv[0], argv.slice(1), { env: { ...process.env, HOME: path.join(dir, "home") } });
  assert.equal(stdout, "check|/a b/$(touch x)'.tachibk|\n0\n");
});
