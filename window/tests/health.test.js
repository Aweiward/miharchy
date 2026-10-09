const { test } = require("node:test");
const assert = require("node:assert/strict");
const S = require("./load")("Sync.js");

// One line of `miharchy-sync health`, as the helper prints it.
const healthy = {
  phoneBackup: "/home/u/Sync/app.mihon_2026-10-09_05-31.tachibk",
  phoneBackupAt: "2026-10-09T09:31:00Z",
  desktopBackup: "/home/u/Sync/miharchy-2026-10-09_09-28-12.tachibk",
  restored: "miharchy-2026-10-09_09-28-12.tachibk",
  markerMissing: false,
  restorable: [],
  byHand: [],
  pendingSince: null,
  behind: false
};
// The job text Setup.parseJob reads: the output, then the exit status.
const job = (output, code) => output + "\n" + code + "\n";

test("health reads the helper's last line, after any JVM warning", () => {
  const text = job("OpenJDK 64-Bit Server VM warning: Sharing is only supported for boot loader classes\n" + JSON.stringify(healthy), 0);
  assert.deepEqual(S.parseHealth(text), { state: "ready", health: healthy });
});

test("health fails with the helper's words, or says to build it", () => {
  assert.deepEqual(S.parseHealth(job("No sync folder is set. Choose one in Setup or Settings.", 1)),
    { state: "failed", message: "No sync folder is set. Choose one in Setup or Settings." });
  assert.equal(S.parseHealth(job("", S.NOT_BUILT)).message, "The sync helper is not built. Build it in the window: press : and choose Setup.");
  assert.equal(S.parseHealth(job("", 3)).message, "The sync helper stopped with status 3.");
});

const NOW = Date.parse("2026-10-09T15:31:00Z");
const row = (change, manga, chapter) => ({ change: change, manga: manga, chapter: chapter || null, tracker: null });

test("the Settings row sums up the phone's side in one short line", () => {
  assert.equal(S.healthSummary(healthy, NOW), "Phone backup 6 h ago · restored the newest backup");
  assert.equal(S.healthSummary(Object.assign({}, healthy, {
    restored: "miharchy-2026-10-08_09-00-00.tachibk",
    restorable: [row("markedRead", "M", "Ch 1"), row("addedToLibrary", "N")],
    byHand: [row("markedUnread", "M", "Ch 2")]
  }), NOW), "Phone backup 6 h ago · restored an older backup · 2 to restore, 1 by hand");
  assert.equal(S.healthSummary(Object.assign({}, healthy, { phoneBackupAt: "2026-10-09T15:20:00Z", restored: null }), NOW),
    "Phone backup 11 min ago · no restore yet");
});

test("the row says when the phone is behind, cannot show restores, or has no backup yet", () => {
  assert.equal(S.healthSummary(Object.assign({}, healthy, {
    phoneBackupAt: "2026-10-05T09:31:00Z", restored: "miharchy-2026-10-01_09-00-00.tachibk", behind: true, restorable: [row("markedRead", "M", "Ch 1")]
  }), NOW), "Phone backup 4 days ago · restored an older backup · behind: 1 to restore");
  assert.equal(S.healthSummary(Object.assign({}, healthy, { restored: null, markerMissing: true }), NOW),
    "Phone backup 6 h ago · app settings off");
  assert.equal(S.healthSummary(Object.assign({}, healthy, { phoneBackup: null, phoneBackupAt: null, restored: null }), NOW),
    "No phone backup in the sync folder yet.");
});

test("the popup speaks up only when the phone is behind or has gone quiet for over 3 days", () => {
  assert.equal(S.healthPopupLine(healthy, NOW), "");
  assert.equal(S.healthPopupLine(Object.assign({}, healthy, { behind: true, restorable: [row("markedRead", "M", "Ch 1")] }), NOW),
    "Phone is behind: restore the newest miharchy backup in Mihon.");
  assert.equal(S.healthPopupLine(Object.assign({}, healthy, { phoneBackupAt: "2026-10-06T16:00:00Z" }), NOW), "");
  assert.equal(S.healthPopupLine(Object.assign({}, healthy, { phoneBackupAt: "2026-10-04T09:31:00Z", behind: true }), NOW),
    "No phone backup for 5 days. Check Mihon's automatic backups and the folder share.");
  assert.equal(S.healthPopupLine(Object.assign({}, healthy, { phoneBackup: null, phoneBackupAt: null }), NOW), "");
});

test("Enter on the row lists what a restore brings and what to repeat by hand, each under what to do", () => {
  const h = Object.assign({}, healthy, {
    restorable: [row("markedRead", "M", "Ch 1"), row("addedToLibrary", "N"), { change: "trackBound", manga: "M", chapter: null, tracker: "AniList" }],
    byHand: [row("markedUnread", "M", "Ch 2")]
  });
  assert.deepEqual(S.healthLines(h), [
    { text: "In Mihon, restore miharchy-2026-10-09_09-28-12.tachibk. It brings:", urgent: false },
    { text: "  M, Ch 1: marked read", urgent: false },
    { text: "  N: added to the library", urgent: false },
    { text: "  M, AniList: track added", urgent: false },
    { text: "A restore cannot apply these. Repeat them in Mihon:", urgent: false },
    { text: "  M, Ch 2: marked unread", urgent: true }
  ]);
  assert.deepEqual(S.healthLines(healthy), [{ text: "Nothing to do on the phone.", urgent: false }]);
  assert.deepEqual(S.healthLines(Object.assign({}, healthy, { restored: null, markerMissing: true })), [
    { text: "Mihon's backups leave out app settings, so Miharchy cannot see restores. Turn on App settings in Mihon's backup options.", urgent: false },
    { text: "Nothing to do on the phone.", urgent: false }
  ]);
});
