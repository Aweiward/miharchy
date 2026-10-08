const { test } = require("node:test");
const assert = require("node:assert/strict");
const execFile = require("node:util").promisify(require("node:child_process").execFile);
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const S = require("./load")("Sync.js");

const summary = {
  server: "http://127.0.0.1:4590",
  folder: "/home/u/Sync",
  backup: "/home/u/Sync/app.mihon_2026-10-04_09-06.tachibk",
  dryRun: false,
  changes: [
    { type: "createCategory", name: "A" },
    { type: "importManga", manga: { source: "1", url: "/m" }, title: "M" },
    { type: "markRead", manga: { source: "1", url: "/m" }, chapterUrl: "/c1" },
    { type: "markRead", manga: { source: "1", url: "/m" }, chapterUrl: "/c2" },
    { type: "bindTrack", manga: { source: "1", url: "/m" }, tracker: 2, track: { remoteId: 30013 } }
  ],
  export: "/home/u/Sync/miharchy-2026-10-04_07-06-05.tachibk",
  unreachable: [
    { change: "removedFromLibrary", manga: "Gone" },
    { change: "markedUnread", manga: "Kept", chapter: "Ch 3" },
    { change: "trackRemoved", manga: "Kept", tracker: "AniList" }
  ]
};
const finish = (output, code) => S.reduce({ state: "running" }, { type: "finish", text: output + "\n" + code + "\n" });

function stub(file, script) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "#!/bin/sh\n" + script, { mode: 0o755 });
}

// Runs the real command with stand-in helper scripts: dev is the one in a
// checkout's sync/build, installed the one Setup builds under HOME.
async function run(dev, installed, apply) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
  const file = path.join(dir, "miharchy-sync");
  if (dev !== null) stub(file, dev);
  if (installed) stub(path.join(dir, "home", S.HELPER_DIR, "bin", "miharchy-sync"), installed);
  const argv = S.command(file, apply);
  const { stdout } = await execFile(argv[0], argv.slice(1), { env: { ...process.env, HOME: path.join(dir, "home") } });
  return S.reduce({ state: "running" }, { type: "finish", text: stdout });
}

test("a sync reports what came from the phone, the file for Mihon and what Mihon cannot apply", () => {
  const s = finish("WARNING: a JVM note\n" + JSON.stringify(summary), 0);
  assert.equal(s.state, "done");
  assert.deepEqual(s.changes, ["imported 1 manga", "created 1 categories", "marked 2 chapters read", "bound 1 tracks"]);
  assert.deepEqual(s.unreachable, [
    { manga: "Gone", chapter: "", change: "removed from the library" },
    { manga: "Kept", chapter: "Ch 3", change: "marked unread" },
    { manga: "Kept", chapter: "AniList", change: "track removed" }
  ]);
  assert.deepEqual(S.report(s), [
    "Merged the phone backup app.mihon_2026-10-04_09-06.tachibk:",
    "  imported 1 manga", "  created 1 categories", "  marked 2 chapters read", "  bound 1 tracks",
    "Wrote miharchy-2026-10-04_07-06-05.tachibk. Restore it in Mihon to bring the desktop's changes to the phone.",
    "A restore in Mihon cannot apply these. Repeat them on the phone:"
  ]);
  assert.equal(S.oneLine(s), "Synced. Restore the newest miharchy backup in Mihon. 3 changes to repeat on the phone; s in the window lists them.");
});

test("notes from the phone count, and notes a Mihon restore keeps are listed", () => {
  const s = finish(JSON.stringify({
    ...summary,
    changes: [{ type: "setNotes", manga: { source: "1", url: "/m" }, notes: "Dropped" }],
    unreachable: [{ change: "notesChanged", manga: "Kept" }]
  }), 0);
  assert.deepEqual(s.changes, ["set notes on 1 manga"]);
  assert.deepEqual(s.unreachable, [{ manga: "Kept", chapter: "", change: "notes changed" }]);
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

test("the helper Setup installed runs before a checkout's build", async () => {
  const s = await run("echo 'dev build'; exit 1", "echo '" + JSON.stringify(summary) + "'");
  assert.equal(s.state, "done");
  assert.deepEqual(await run("echo 'dev build'; exit 1"), { state: "failed", message: "dev build" });
});

const removals = Array.from({ length: 6 }, (_, i) => ({ type: "removeFromLibrary", manga: { source: "1", url: "/m" + i }, title: "M" + i }));
const heldSummary = { ...summary, changes: removals, export: null, unreachable: [], held: true };

test("a held sync lists what it would change, applies only on y, and the popup only points at the window", () => {
  const s = finish(JSON.stringify(heldSummary), 0);
  assert.deepEqual(s, { state: "held", backup: "app.mihon_2026-10-04_09-06.tachibk", changes: ["removed 6 manga from the library"] });
  assert.deepEqual(S.report(s), [
    "The phone backup app.mihon_2026-10-04_09-06.tachibk would change much, so the sync stopped before it changed anything:",
    "  removed 6 manga from the library",
    "y applies it. Esc keeps the library as it is."
  ]);
  assert.equal(S.oneLine(s), "Sync held: it would remove much. Press s in the window to review it.");
  assert.deepEqual(S.reduce(s, { type: "apply" }), { state: "running", apply: true });
  const done = finish(JSON.stringify(summary), 0);
  assert.equal(S.reduce(done, { type: "apply" }), done, "apply does nothing unless a sync is held");
});

test("only an applied sync passes --apply to the helper", async () => {
  const echo = "[ \"$*\" = 'sync --json --apply' ] && echo '" + JSON.stringify(summary) + "' || echo '" + JSON.stringify(heldSummary) + "'";
  assert.equal((await run(echo, null, true)).state, "done");
  assert.equal((await run(echo)).state, "held");
});

test("a helper that is not built points at Setup, never at a build in the plugin folder", async () => {
  const s = await run(null);
  assert.deepEqual(s, { state: "failed", message: "The sync helper is not built. Build it in the window: press : and choose Setup." });
});
