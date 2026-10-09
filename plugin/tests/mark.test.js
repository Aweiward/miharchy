const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("../../window/tests/load");
const Mark = load("../plugin/Mark.js");
const M = load("Model.js");

const config = { url: "http://127.0.0.1:4590", username: "u", password: "p" };
const now = new Date(2026, 9, 4, 15).getTime();
const sec = (h) => String(Math.floor(new Date(2026, 9, 4, h).getTime() / 1000));
const manga = { id: 7, title: "Maid to Skate", thumbnailUrl: null, inLibraryAt: sec(1) };
const chapter = (id, h) => ({ id, name: "Ch." + id, uploadDate: String(now), fetchedAt: sec(h), sourceOrder: id, isRead: false, manga });
const reply = (nodes) => M.reply(200, JSON.stringify({ data: { chapters: { nodes } } }));
const after = (r) => Mark.reduce(Mark.initial(), { type: "reply", reply: r, config, now });

test("the mark shows the unread update count, the popup the newest few", () => {
  const nodes = [];
  for (let i = 1; i <= Mark.LIMIT + 2; i++) nodes.push(chapter(i, 2 + i % 10));
  const m = after(reply(nodes));
  assert.equal(Mark.label(m), String(Mark.LIMIT + 2));
  assert.equal(Mark.down(m), false);
  assert.equal(m.rows.length, Mark.LIMIT);
  assert.equal(m.rows[0].id, 9, "newest fetched first");
  assert.equal(m.rows[0].mangaId, 7);
  assert.equal(m.rows[0].title, "Maid to Skate");
  assert.equal(m.rows[0].chapter, "Ch.9");
  assert.equal(m.rows[0].date, "2026-10-04");
  assert.equal(Mark.tooltip(m), "Miharchy: " + (Mark.LIMIT + 2) + " new chapters");
  assert.equal(Mark.notice(m, "/c"), null);
});

test("no updates: the mark shows no count", () => {
  const m = after(reply([]));
  assert.equal(Mark.label(m), "");
  assert.equal(Mark.down(m), false);
  assert.equal(Mark.tooltip(m), "Miharchy: no new chapters");
  assert.equal(Mark.notice(m, "/c").title, "No new chapters");
});

test("a server that does not answer shows the dot, never a stale count", () => {
  const up = after(reply([chapter(1, 3)]));
  const m = Mark.reduce(up, { type: "reply", reply: M.reply(0, ""), config, now });
  assert.equal(Mark.down(m), true);
  assert.equal(Mark.label(m), "");
  assert.deepEqual(m.rows, []);
  assert.equal(Mark.tooltip(m), "Miharchy: The server is not running");
  assert.equal(Mark.notice(m, "/c").title, "The server is not running");
});

test("any failure to reach the updates is the dot; loading is not", () => {
  assert.equal(Mark.down(Mark.initial()), false);
  assert.equal(Mark.label(Mark.initial()), "");
  assert.equal(Mark.down(Mark.reduce(Mark.initial(), { type: "config-missing" })), true);
  assert.equal(Mark.down(after(M.reply(401, ""))), true);
  const broken = after(M.reply(500, ""));
  assert.equal(Mark.down(broken), true);
  assert.match(Mark.notice(broken, "/c").detail, /HTTP 500/);
});

const other = { id: 8, title: "Normal Girl", thumbnailUrl: null, inLibraryAt: sec(1) };
const withNotify = (nodes, value) => M.reply(200, JSON.stringify({ data: { chapters: { nodes }, notify: { nodes: value === undefined ? [] : [{ value }] } } }));
const poll = (m, r) => Mark.reduce(m, { type: "reply", reply: r, config, now });

test("the poll asks for the notification and sync settings and the server's version in the same query", () => {
  const q = Mark.listPayload().query;
  assert.match(q, /chapters\(filter:/);
  assert.match(q, /notify: metas\(condition: \{ key: "miharchy.notifyNewChapters" \}\) \{ nodes \{ value \} \} /);
  assert.match(q, /autoSync: metas\(condition: \{ key: "miharchy.autoSync" \}\) \{ nodes \{ value \} \} /);
  assert.match(q, /syncFolder: metas\(condition: \{ key: "miharchy.syncFolder" \}\) \{ nodes \{ value \} \} aboutServer \{ version \} \}$/);
  assert.equal(q.split("{").length, q.split("}").length, "braces balance");
});

const withVersion = (version) => M.reply(200, JSON.stringify({ data: { chapters: { nodes: [chapter(1, 3)] }, aboutServer: { version } } }));

test("a server newer than the checked version adds a warning, and the mark keeps working", () => {
  const m = poll(Mark.initial(), withVersion("v2.4.2400"));
  assert.equal(Mark.warning(m), "Suwayomi-Server v2.4.2400 is newer than the version Miharchy has checked (v2.4.2366). It should work, but report problems.");
  assert.equal(Mark.tooltip(m), "Miharchy: 1 new chapter\n" + Mark.warning(m));
  assert.equal(Mark.down(m), false);
  assert.equal(Mark.label(m), "1");
  assert.equal(m.rows.length, 1);
});

test("an older or equal server, or none answering, shows no warning", () => {
  for (const v of ["v2.3.2243", "v2.4.2366"]) {
    const m = poll(Mark.initial(), withVersion(v));
    assert.equal(Mark.warning(m), "", v);
    assert.equal(Mark.tooltip(m), "Miharchy: 1 new chapter", v);
  }
  assert.equal(Mark.warning(poll(poll(Mark.initial(), withVersion("v9.0.0")), M.reply(0, ""))), "");
});

test("the first poll after a start notifies nothing, however many updates wait", () => {
  const first = poll(Mark.initial(), withNotify([chapter(1, 3), chapter(2, 4)]));
  assert.equal(first.count, 2);
  assert.equal(Mark.notification(first), null);
});

test("chapters above the newest seen notify once, naming each manga once", () => {
  const first = poll(Mark.initial(), withNotify([chapter(1, 3), chapter(2, 4)]));
  const second = poll(first, withNotify([chapter(1, 3), chapter(2, 4), chapter(5, 9), chapter(6, 9), Object.assign(chapter(7, 9), { manga: other })]));
  assert.deepEqual(Mark.notification(second), { key: "7", title: "3 new chapters", body: "Normal Girl\nMaid to Skate" }, "newest first");
  assert.equal(Mark.notification(poll(second, withNotify([chapter(5, 9), chapter(6, 9), chapter(7, 9)]))), null, "the same updates again notify nothing");
});

test("a chapter marked unread again, or one back after a failed poll, is no new chapter", () => {
  const seen = poll(Mark.initial(), withNotify([chapter(3, 3), chapter(9, 4)]));
  const readThen = poll(seen, withNotify([chapter(9, 4)]));
  assert.equal(Mark.notification(poll(readThen, withNotify([chapter(3, 3), chapter(9, 4)]))), null, "3 is below the top");
  const down = poll(seen, M.reply(0, ""));
  assert.equal(down.top, 9, "a failure keeps the top");
  assert.equal(Mark.notification(poll(down, withNotify([chapter(3, 3), chapter(9, 4)]))), null);
  assert.equal(Mark.notification(poll(down, withNotify([chapter(9, 4), chapter(10, 5)]))).title, "1 new chapter");
});

test("the Settings row turns notifications off", () => {
  const first = poll(Mark.initial(), withNotify([chapter(1, 3)], "false"));
  assert.equal(Mark.notification(poll(first, withNotify([chapter(1, 3), chapter(2, 4)], "false"))), null);
  assert.notEqual(Mark.notification(poll(first, withNotify([chapter(1, 3), chapter(2, 4)], "true"))), null);
});

test("more than five manga: five names, then how many more", () => {
  const many = [1, 2, 3, 4, 5, 6, 7].map((i) => Object.assign(chapter(10 + i, 9), { manga: Object.assign({}, manga, { id: i, title: "M" + i }) }));
  const n = Mark.notification(poll(poll(Mark.initial(), withNotify([chapter(1, 3)])), withNotify(many)));
  assert.equal(n.body, "M7\nM6\nM5\nM4\nM3\nand 2 more", "newest first, as the popup lists them");
});

test("the notification goes out once across bars, and a click opens Updates", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { execFileSync } = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mark-notify-"));
  const log = path.join(dir, "log");
  fs.writeFileSync(path.join(dir, "notify-send"), "#!/bin/sh\necho \"notify-send $*\" >> " + log + "\necho default\n", { mode: 0o755 });
  const launcher = path.join(dir, "launcher");
  fs.writeFileSync(launcher, "echo \"launcher $*\" >> " + log + "\n");
  const n = { key: "7", title: "3 new chapters", body: "Maid to Skate\nNormal Girl" };
  const [cmd, ...args] = Mark.notifyCommand(n, launcher, "/icons/miharchy.svg");
  const env = { PATH: dir + ":" + process.env.PATH, XDG_RUNTIME_DIR: dir };
  execFileSync(cmd, args, { env });
  execFileSync(cmd, args, { env });
  assert.deepEqual(fs.readFileSync(log, "utf8").trim().split("\n"), [
    "notify-send -a Miharchy -i /icons/miharchy.svg -A default=Open -- 3 new chapters Maid to Skate\nNormal Girl".split("\n")[0],
    "Normal Girl",
    "launcher open-updates"
  ]);
});

const withSync = (autoSync, syncFolder) => M.reply(200, JSON.stringify({ data: {
  chapters: { nodes: [] },
  autoSync: { nodes: autoSync === undefined ? [] : [{ value: autoSync }] },
  syncFolder: { nodes: syncFolder === undefined ? [] : [{ value: syncFolder }] }
} }));

test("the poll reads the sync Settings rows; a failure keeps them", () => {
  const on = poll(Mark.initial(), withSync("true", "/home/u/Sync"));
  assert.equal(on.autoSync, true);
  assert.equal(on.syncFolder, "/home/u/Sync");
  assert.equal(poll(on, withSync("false", "/home/u/Sync")).autoSync, false);
  const unset = poll(on, withSync());
  assert.equal(unset.autoSync, false, "off unless set");
  assert.equal(unset.syncFolder, "");
  assert.deepEqual([Mark.initial().autoSync, Mark.initial().syncFolder], [false, ""]);
  const down = poll(on, M.reply(0, ""));
  assert.deepEqual([down.autoSync, down.syncFolder], [true, "/home/u/Sync"]);
  const missing = Mark.reduce(on, { type: "config-missing" });
  assert.deepEqual([missing.autoSync, missing.syncFolder], [true, "/home/u/Sync"]);
});

test("the phone check finds the newest phone backup the sync has not merged", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { execFileSync } = require("node:child_process");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mark-home-"));
  const folder = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mark-sync-")), "Phone sync");
  fs.mkdirSync(folder);
  const t = Math.floor(Date.now() / 1000);
  const file = (dir, name, age) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, "");
    fs.utimesSync(p, t - age, t - age);
    return p;
  };
  const [cmd, ...args] = Mark.phoneCheckCommand(folder);
  const check = () => execFileSync(cmd, args, { env: { ...process.env, HOME: home }, encoding: "utf8" }).trim();

  assert.equal(check(), "", "an empty folder");
  file(folder, "older.tachibk", 3600);
  const newest = file(folder, "com.mihon_2026-10-08.tachibk", 600);
  file(folder, "miharchy-2026-10-08.tachibk", 60);
  file(folder, "arriving.tachibk", 5);
  file(folder, "notes.txt", 60);
  assert.equal(check(), (t - 600) + ".0000000000 " + newest, "no baseline: the newest phone backup old enough, never an export");

  const state = path.join(home, ".local/share/miharchy/sync");
  fs.mkdirSync(state, { recursive: true });
  file(state, "phone-baseline.tachibk", 300);
  assert.equal(check(), "", "a baseline newer than every phone backup");
  const later = file(folder, "later.tachibk", 120);
  assert.equal(check(), (t - 120) + ".0000000000 " + later, "a phone backup after the baseline");
});

const done = (changes) => ({ state: "done", backup: "b.tachibk", changes, export: "miharchy-x.tachibk", unreachable: [] });

test("a sync on a phone backup notifies its result, and stays quiet when it changed nothing or lost the race", () => {
  assert.deepEqual(Mark.syncNotification(done(["marked 3 chapters read", "bookmarked 1 chapters"]), "sync-1"),
    { key: "sync-1", title: "Synced from the phone", body: "marked 3 chapters read\nbookmarked 1 chapters" });
  assert.equal(Mark.syncNotification(done([]), "sync-1"), null);
  assert.deepEqual(Mark.syncNotification({ state: "held", backup: "b.tachibk", changes: ["removed 9 manga from the library"] }, "sync-1"),
    { key: "sync-1", title: "Sync held", body: "The phone backup would remove much. Press s in the window to review it." });
  assert.equal(Mark.syncNotification({ state: "failed", message: "A sync is already running." }, "sync-1"), null);
  assert.deepEqual(Mark.syncNotification({ state: "failed", message: "The sync folder is not set." }, "sync-1"),
    { key: "sync-1", title: "Sync failed", body: "The sync folder is not set." });
});

test("the health check names the newest phone backup, whatever the sync merged", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { execFileSync } = require("node:child_process");
  const folder = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mark-sync-")), "Phone sync");
  fs.mkdirSync(folder);
  const t = Math.floor(Date.now() / 1000);
  const file = (name, age) => {
    const p = path.join(folder, name);
    fs.writeFileSync(p, "");
    fs.utimesSync(p, t - age, t - age);
    return p;
  };
  const [cmd, ...args] = Mark.newestPhoneCommand(folder);
  const check = () => execFileSync(cmd, args, { encoding: "utf8" }).trim();

  assert.equal(check(), "", "an empty folder");
  file("app.mihon_2026-10-08_20-30.tachibk", 3600);
  const newest = file("app.mihon_2026-10-09_05-31.tachibk", 5);
  file("miharchy-2026-10-09_09-28-12.tachibk", 1);
  file("notes.txt", 1);
  assert.equal(check(), (t - 5) + ".0000000000 " + newest, "the newest phone backup, never a desktop backup");
});
