const { test } = require("node:test");
const assert = require("node:assert/strict");
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
const finish = (data) => S.reduce({ state: "running" }, { type: "reply", reply: { state: "ok", data } });

test("a sync reports what came from the phone, the file for Mihon and what Mihon cannot apply", () => {
  const s = finish(summary);
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
  const s = finish({
    ...summary,
    changes: [{ type: "setNotes", manga: { source: "1", url: "/m" }, notes: "Dropped" }],
    unreachable: [{ change: "notesChanged", manga: "Kept" }]
  });
  assert.deepEqual(s.changes, ["set notes on 1 manga"]);
  assert.deepEqual(s.unreachable, [{ manga: "Kept", chapter: "", change: "notes changed" }]);
});

test("with no phone backup yet the sync still writes one for Mihon", () => {
  const s = finish({ ...summary, backup: null, changes: [], unreachable: [] });
  assert.deepEqual(S.report(s), ["No phone backup in the sync folder yet.", "Wrote miharchy-2026-10-04_07-06-05.tachibk. Restore it in Mihon to bring the desktop's changes to the phone."]);
  assert.equal(S.oneLine(s), "Synced. Restore the newest miharchy backup in Mihon.");
});

const removals = Array.from({ length: 6 }, (_, i) => ({ type: "removeFromLibrary", manga: { source: "1", url: "/m" + i }, title: "M" + i }));
const heldSummary = { ...summary, changes: removals, export: null, unreachable: [], held: true };

test("a held sync lists what it would change, applies only on y, and the popup only points at the window", () => {
  const s = finish(heldSummary);
  assert.deepEqual(s, { state: "held", backup: "app.mihon_2026-10-04_09-06.tachibk", changes: ["removed 6 manga from the library"] });
  assert.deepEqual(S.report(s), [
    "The phone backup app.mihon_2026-10-04_09-06.tachibk would change much, so the sync stopped before it changed anything:",
    "  removed 6 manga from the library",
    "y applies it. Esc keeps the library as it is."
  ]);
  assert.equal(S.oneLine(s), "Sync held: it would remove much. Press s in the window to review it.");
  assert.deepEqual(S.reduce(s, { type: "apply" }), { state: "running", apply: true });
  const done = finish(summary);
  assert.equal(S.reduce(done, { type: "apply" }), done, "apply does nothing unless a sync is held");
});

test("the sync is a route, and apply runs a held one", () => {
  assert.deepEqual(S.corePayload(false), { route: "sync.run", body: {} });
  assert.deepEqual(S.corePayload(true), { route: "sync.run", body: { apply: true } });
  const ok = { state: "ok", data: { ...summary, export: "/home/u/Sync/miharchy-2026-10-04_09-07-00.tachibk", unreachable: [] } };
  assert.equal(S.reduce({ state: "running" }, { type: "reply", reply: ok }).export, "miharchy-2026-10-04_09-07-00.tachibk");
  assert.equal(S.reduce({ state: "running" }, { type: "reply", reply: { state: "ok", data: { ...ok.data, held: true } } }).state, "held");
});

test("a failed core sync says core's message, or why core did not answer", () => {
  const failed = (reply) => S.reduce({ state: "running" }, { type: "reply", reply });
  assert.deepEqual(failed({ state: "error", message: "A sync is already running." }), { state: "failed", message: "A sync is already running." });
  assert.match(failed({ state: "down" }).message, /miharchy-core is not running/);
  assert.match(failed({ state: "unauthorized" }).message, /secret in core.json/);
  assert.match(failed({ state: "no-config" }).message, /No miharchy-core config/);
});

test("core's sync health is a route, and its reply reads as health", () => {
  assert.deepEqual(S.HEALTH_PAYLOAD, { route: "sync.health", body: {} });
  const h = { phoneBackup: null, phoneBackupAt: null, desktopBackup: null, restored: null, markerMissing: false, restorable: [], byHand: [], pendingSince: null, behind: false };
  assert.deepEqual(S.healthReply({ state: "ok", data: h }), { state: "ready", health: h });
  assert.deepEqual(S.healthReply({ state: "error", message: "/s is not a folder." }), { state: "failed", message: "/s is not a folder." });
});
