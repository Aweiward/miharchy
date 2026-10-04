const { test } = require("node:test");
const assert = require("node:assert/strict");
const execFile = require("node:util").promisify(require("node:child_process").execFile);
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const S = require("./load")("Sync.js");

const helper = "/repo/sync/build/install/miharchy-sync/bin/miharchy-sync";
const summary = {
  server: "http://127.0.0.1:4590",
  folder: "/home/u/Sync",
  backup: "/home/u/Sync/app.mihon_2026-10-04_09-06.tachibk",
  dryRun: false,
  changes: [
    { type: "createCategory", name: "A" },
    { type: "importManga", manga: { source: "1", url: "/m" }, title: "M" },
    { type: "markRead", manga: { source: "1", url: "/m" }, chapterUrl: "/c1" },
    { type: "markRead", manga: { source: "1", url: "/m" }, chapterUrl: "/c2" }
  ],
  export: "/home/u/Sync/miharchy-2026-10-04_07-06-05.tachibk",
  unreachable: [
    { change: "removedFromLibrary", manga: "Gone" },
    { change: "markedUnread", manga: "Kept", chapter: "Ch 3" }
  ]
};
const finish = (output, code) => S.reduce({ state: "running" }, { type: "finish", text: output + "\n" + code + "\n", helper });

// Runs the real command with a stand-in helper script.
async function run(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
  const file = path.join(dir, "miharchy-sync");
  if (script !== null) fs.writeFileSync(file, "#!/bin/sh\n" + script, { mode: 0o755 });
  const argv = S.command(file);
  const { stdout } = await execFile(argv[0], argv.slice(1));
  return S.reduce({ state: "running" }, { type: "finish", text: stdout, helper: file });
}

test("a sync reports what came from the phone, the file for Mihon and what Mihon cannot apply", () => {
  const s = finish("WARNING: a JVM note\n" + JSON.stringify(summary), 0);
  assert.equal(s.state, "done");
  assert.deepEqual(s.changes, ["imported 1 manga", "created 1 categories", "marked 2 chapters read"]);
  assert.deepEqual(s.unreachable, [
    { manga: "Gone", chapter: "", change: "removed from the library" },
    { manga: "Kept", chapter: "Ch 3", change: "marked unread" }
  ]);
  assert.deepEqual(S.report(s), [
    "Merged the phone backup app.mihon_2026-10-04_09-06.tachibk:",
    "  imported 1 manga", "  created 1 categories", "  marked 2 chapters read",
    "Wrote miharchy-2026-10-04_07-06-05.tachibk. Restore it in Mihon to bring the desktop's changes to the phone.",
    "A restore in Mihon cannot apply these. Repeat them on the phone:"
  ]);
  assert.equal(S.oneLine(s), "Synced. Restore the newest miharchy backup in Mihon. 2 changes to repeat on the phone; s in the window lists them.");
});

test("with no phone backup yet the sync still writes one for Mihon", () => {
  const s = finish(JSON.stringify({ ...summary, backup: null, changes: [], unreachable: [] }), 0);
  assert.deepEqual(S.report(s), ["No phone backup in the sync folder yet.", "Wrote miharchy-2026-10-04_07-06-05.tachibk. Restore it in Mihon to bring the desktop's changes to the phone."]);
  assert.equal(S.oneLine(s), "Synced. Restore the newest miharchy backup in Mihon.");
});

test("a failed sync shows the helper's own message", () => {
  const s = finish("A sync is already running.", 1);
  assert.deepEqual(s, { state: "failed", message: "A sync is already running." });
  assert.equal(S.oneLine(s), "A sync is already running.");
});

test("the real command passes --json and the helper's output through", async () => {
  const s = await run("[ \"$1 $2\" = 'sync --json' ] || exit 2\necho 'stderr noise' >&2\necho '" + JSON.stringify(summary) + "'");
  assert.equal(s.state, "done");
  assert.equal(s.export, "miharchy-2026-10-04_07-06-05.tachibk");
  const failed = await run("echo 'No sync folder is set. Choose one in Setup or Settings.' >&2\nexit 1");
  assert.deepEqual(failed, { state: "failed", message: "No sync folder is set. Choose one in Setup or Settings." });
});

test("a helper that is not built says how to build it", async () => {
  const s = await run(null);
  assert.equal(s.state, "failed");
  assert.match(s.message, /^The sync helper is not built\. Build it with: cd \/.+ && \.\/gradlew installDist$/);
  assert.equal(S.buildCommand(helper), "cd /repo/sync && ./gradlew installDist");
});
