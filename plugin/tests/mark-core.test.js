// The mark on miharchy-core (#386): miharchy-core's routes, ids and sync.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const load = require("../../window/tests/load");
const Mark = load("../plugin/Mark.js");
const M = load("Model.js");
const Sync = load("Sync.js");

const config = { url: "http://127.0.0.1:4591", secret: "s", backend: "core" };
const now = new Date(2026, 9, 4, 15).getTime();
const sec = (h) => Math.floor(new Date(2026, 9, 4, h).getTime() / 1000);
const ok = (data) => M.coreReply(200, JSON.stringify(data));
const LIB = { mangas: [{ id: 7, title: "Maid to Skate", thumbnailUrl: null, inLibraryAt: sec(1), categories: [], source: { id: "1", displayName: "Fixture" } }], categories: [] };
const chapter = (id, h) => ({ id, mangaId: 7, name: "Ch." + id, uploadDate: now, fetchedAt: sec(h), sourceOrder: id, isRead: false });

// A fake core: each route answers from routes, and every request is kept.
function fakeCore(routes) {
  const sent = [];
  const send = (payload, done) => {
    sent.push(payload);
    const r = routes[payload.route];
    done(typeof r === "function" ? r(payload.body) : r);
  };
  return { sent, send };
}

const poll = (routes, mark) => {
  const core = fakeCore(routes);
  let reply;
  Mark.load(core.send, now, (r) => { reply = r; });
  return { sent: core.sent, reply, mark: Mark.reduce(mark || Mark.initial(), { type: "reply", reply, config, now }) };
};

const ROUTES = (chapters, metas) => ({
  "library.list": ok(LIB),
  "chapter.list": ok({ chapters }),
  "meta.get": ok({ metas: metas || [] })
});

test("on core a poll reads the library's recent unread chapters and the three Settings rows, never Suwayomi", () => {
  const { sent, mark } = poll(ROUTES([chapter(1, 3), chapter(2, 4)], [
    { scope: "global", owner: 0, key: "miharchy.notifyNewChapters", value: "false" },
    { scope: "global", owner: 0, key: "miharchy.autoSync", value: "true" },
    { scope: "global", owner: 0, key: "miharchy.syncFolder", value: "/phone" }
  ]));
  assert.ok(sent.every((p) => p.route && !p.query), "core routes only");
  assert.deepEqual(sent.map((p) => p.route), ["library.list", "chapter.list", "meta.get"]);
  const list = sent[1].body;
  assert.deepEqual(list.mangaIds, [7]);
  assert.equal(list.unread, true);
  assert.equal(list.since, new Date(2026, 6, 4, 15).getTime(), "three months back, as Updates");
  assert.deepEqual(sent[2].body.keys, ["miharchy.notifyNewChapters", "miharchy.autoSync", "miharchy.syncFolder"]);
  assert.equal(mark.state, "ok");
  assert.equal(Mark.label(mark), "2");
  assert.equal(mark.rows[0].id, 2);
  assert.equal(mark.notify, false);
  assert.equal(mark.autoSync, true);
  assert.equal(mark.syncFolder, "/phone");
});

test("on core an empty library asks for no chapters, and unset rows keep their defaults", () => {
  const { sent, mark } = poll({ "library.list": ok({ mangas: [], categories: [] }), "meta.get": ok({ metas: [] }) });
  assert.deepEqual(sent.map((p) => p.route), ["library.list", "meta.get"]);
  assert.equal(Mark.label(mark), "");
  assert.equal(mark.notify, true);
  assert.equal(mark.autoSync, false);
  assert.equal(mark.syncFolder, "");
});

test("on core a new chapter after the first poll notifies, and a failure shows the dot in core's words", () => {
  const first = poll(ROUTES([chapter(1, 3)])).mark;
  assert.equal(Mark.notification(first), null, "the first answer only sets the top");
  const second = poll(ROUTES([chapter(1, 3), chapter(5, 5)]), first).mark;
  assert.deepEqual(Mark.notification(second), { key: "5", title: "1 new chapter", body: "Maid to Skate" });
  for (const [route, reply] of [["library.list", M.coreReply(0, "")], ["chapter.list", M.coreReply(0, "")], ["meta.get", M.coreReply(401, JSON.stringify({ error: { kind: "unauthorized", message: "no" } }))]]) {
    const down = poll({ ...ROUTES([chapter(1, 3)]), [route]: reply }, second).mark;
    assert.equal(Mark.down(down), true, route);
    assert.equal(Mark.label(down), "", "no stale count");
  }
  const down = poll({ ...ROUTES([]), "library.list": M.coreReply(0, "") }).mark;
  assert.equal(Mark.tooltip(down), "Miharchy: miharchy-core is not running");
  assert.equal(Mark.notice(down, "/c/core.json").title, "miharchy-core is not running");
});

test("on core Up next comes from core with Downloaded only, and every row opens on core", () => {
  const routes = {
    "library.list": ok(LIB),
    "chapter.list": ok({ chapters: [chapter(1, 3)] }),
    "meta.get": (body) => ok({ metas: body.keys.includes("miharchy.downloadedOnly") ? [{ scope: "global", owner: 0, key: "miharchy.downloadedOnly", value: "true" }] : [] })
  };
  const core = fakeCore(routes);
  let reply;
  Mark.loadUpNext(core.send, (r) => { reply = r; });
  assert.ok(core.sent.every((p) => p.route), "core routes only");
  assert.deepEqual(core.sent.at(-1).body.keys, ["miharchy.downloadedOnly"]);
  assert.deepEqual(Mark.upNext(reply, now), [], "Downloaded only hides a chapter not downloaded");
  routes["meta.get"] = ok({ metas: [] });
  Mark.loadUpNext(core.send, (r) => { reply = r; });
  const up = Mark.upNext(reply, now);
  assert.deepEqual(up.map((e) => e.open), [["peek-open", "7", "1", "core"]]);
  const mark = poll(ROUTES([chapter(1, 3)])).mark;
  const rows = Mark.entries(up, mark.rows);
  assert.deepEqual(rows.map((e) => e.open), [["peek-open", "7", "1", "core"], ["open-chapter", "7", "1", "core"]]);
});

test("on core the phone check reads core's baseline, not the helper's", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miharchy-mark-core-"));
  const home = path.join(dir, "home");
  const folder = path.join(dir, "phone");
  fs.mkdirSync(folder, { recursive: true });
  assert.equal(Mark.phoneBaseline({ HOME: home }), home + "/.local/share/miharchy/core/sync/phone-baseline.tachibk");
  assert.equal(Mark.phoneBaseline({ HOME: home, MIHARCHY_CORE_DATA: "/d" }), "/d/sync/phone-baseline.tachibk");
  const t = Math.floor(Date.now() / 1000);
  const file = (d, name, age) => {
    fs.mkdirSync(d, { recursive: true });
    const p = path.join(d, name);
    fs.writeFileSync(p, "x");
    fs.utimesSync(p, t - age, t - age);
    return p;
  };
  const backup = file(folder, "com.mihon.tachibk", 600);
  const baseline = Mark.phoneBaseline({ HOME: home });
  const [cmd, ...args] = Mark.phoneCheckCommand(folder, baseline);
  const check = () => execFileSync(cmd, args, { env: { ...process.env, HOME: home }, encoding: "utf8" }).trim();
  // The helper's baseline is newer, but core syncs: its own (none yet) decides.
  file(path.join(home, ".local/share/miharchy/sync"), "phone-baseline.tachibk", 60);
  assert.equal(check(), (t - 600) + ".0000000000 " + backup);
  file(path.dirname(baseline), "phone-baseline.tachibk", 300);
  assert.equal(check(), "", "core's baseline is newer");
});

test("on core a sync that lost the race stays silent, and other results notify", () => {
  const lost = Sync.reduce(Sync.reduce(Sync.initial(), { type: "start" }), { type: "reply", reply: M.coreReply(400, JSON.stringify({ error: { kind: "invalid", message: "A sync is already running." } })) });
  assert.equal(lost.state, "failed");
  assert.equal(Mark.syncNotification(lost, "sync-1"), null);
  const down = Sync.reduce(Sync.initial(), { type: "reply", reply: M.coreReply(0, "") });
  assert.equal(Mark.syncNotification(down, "sync-1").title, "Sync failed");
  assert.match(Mark.syncNotification(down, "sync-1").body, /miharchy-core is not running/);
});
