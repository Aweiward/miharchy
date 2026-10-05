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

test("the poll asks for the notification setting in the same query", () => {
  const q = Mark.listPayload().query;
  assert.match(q, /chapters\(filter:/);
  assert.match(q, /notify: metas\(condition: \{ key: "miharchy.notifyNewChapters" \}\) \{ nodes \{ value \} \} \}$/);
  assert.equal(q.split("{").length, q.split("}").length, "braces balance");
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
