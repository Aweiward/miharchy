const { test } = require("node:test");
const assert = require("node:assert/strict");
const U = require("./load")("Updates.js");
const M = require("./load")("Model.js");

const config = { url: "http://127.0.0.1:4590", username: "u", password: "p" };
const ok = (data) => M.reply(200, JSON.stringify({ data }));
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi || 0).getTime();
const now = at(2026, 10, 4, 15);
const sec = (ms) => String(Math.floor(ms / 1000));

const manga = { id: 7, title: "Maid to Skate", thumbnailUrl: "/api/v1/manga/7/thumbnail", inLibraryAt: sec(at(2026, 9, 1, 12)) };
const other = { id: 8, title: "Normal Girl", thumbnailUrl: "/api/v1/manga/8/thumbnail", inLibraryAt: sec(at(2026, 10, 4, 9)) };
const chapter = (id, m, fetched, o) => Object.assign({ id, name: "Ch." + id, uploadDate: String(at(2026, 9, 30, 8)), fetchedAt: sec(fetched), sourceOrder: id, isRead: false, manga: m }, o);
const status = (o) => ({ jobsInfo: Object.assign({ isRunning: false, finishedJobs: 0, totalJobs: 0, skippedMangasCount: 0 }, o) });
const list = (nodes, s, checked) => ok({ chapters: { nodes }, libraryUpdateStatus: s || status(), lastUpdateTimestamp: { timestamp: String(checked || 0) } });
const loaded = (nodes, s, checked) => U.reduce(U.initial(), { type: "list", reply: list(nodes, s, checked), config, now });

test("an update is an unread chapter fetched after its manga joined the library", () => {
  const data = list([
    chapter(1, manga, at(2026, 10, 3, 20)),
    chapter(2, manga, at(2026, 8, 31, 12), { name: "fetched before the manga joined" }),
    chapter(3, other, at(2026, 10, 4, 9), { name: "fetched in the second it joined: the backlog" }),
    chapter(4, other, at(2026, 10, 4, 10), { isRead: true })
  ]).data;
  assert.deepEqual(U.updates(data).map((c) => c.id), [1]);
  assert.equal(U.count(data), 1, "the mark's count is the list's length");
  assert.equal(U.count({}), 0, "a reply with no chapters counts none");
});

test("updates run newest fetched first, a manga's chapters newest first within one fetch", () => {
  const u = loaded([
    chapter(1, manga, at(2026, 10, 2, 10)),
    chapter(2, other, at(2026, 10, 4, 14)),
    chapter(5, manga, at(2026, 10, 4, 11)),
    chapter(6, manga, at(2026, 10, 4, 11))
  ]);
  assert.equal(u.state, "ok");
  assert.deepEqual(u.rows.map((r) => r.id), [2, 6, 5, 1]);
});

test("rows group by fetch day: Today, Yesterday, then the date", () => {
  const u = loaded([
    chapter(1, manga, at(2026, 10, 4, 14)),
    chapter(2, manga, at(2026, 10, 4, 1)),
    chapter(3, manga, at(2026, 10, 3, 23)),
    chapter(4, manga, at(2026, 9, 28, 12))
  ]);
  assert.deepEqual(u.rows.map((r) => r.header), ["Today", "", "Yesterday", "2026-09-28"]);
  assert.deepEqual(u.rows[0], {
    id: 1, mangaId: 7, title: "Maid to Skate", chapter: "Ch.1", date: "2026-09-30", header: "Today",
    cover: "http://u:p@127.0.0.1:4590/api/v1/manga/7/thumbnail"
  });
});

test("a reload keeps the rows shown; a failure says why and keeps them", () => {
  const u = loaded([chapter(1, manga, at(2026, 10, 4, 14))]);
  const r = U.reduce(u, { type: "request" });
  assert.equal(r.state, "loading");
  assert.equal(r.rows.length, 1);
  const down = U.reduce(r, { type: "list", reply: M.reply(0, ""), config, now });
  assert.equal(down.state, "down");
  assert.equal(down.rows.length, 1);
});

test("the notice: loading, a failed connection, or no updates", () => {
  assert.equal(U.notice(U.initial(), "/s.json").title, "Loading updates");
  assert.equal(U.notice(U.reduce(U.initial(), { type: "list", reply: M.reply(401, ""), config, now }), "/s.json").title, "The server rejected the credentials");
  assert.equal(U.notice(loaded([]), "/s.json").title, "No new chapters");
  assert.equal(U.notice(loaded([chapter(1, manga, at(2026, 10, 4, 14))]), "/s.json"), null);
});

test("a check runs until a status poll says the server finished it", () => {
  const idle = loaded([], status({ finishedJobs: 2, totalJobs: 2 }), at(2026, 10, 4, 3));
  assert.equal(idle.running, false);
  assert.equal(U.checkPayload().query.includes("updateLibrary"), true);
  const asked = U.reduce(idle, { type: "checking" });
  assert.equal(U.progress(asked, now), "Checking for new chapters");
  const running = U.reduce(asked, { type: "status", reply: ok({ libraryUpdateStatus: status({ isRunning: true, finishedJobs: 1, totalJobs: 4 }), lastUpdateTimestamp: { timestamp: String(at(2026, 10, 4, 14, 59)) } }) });
  assert.equal(U.finished(asked, running), false);
  assert.equal(U.progress(running, now), "Checking for new chapters 1 / 4");
  const done = U.reduce(running, { type: "status", reply: ok({ libraryUpdateStatus: status({ finishedJobs: 4, totalJobs: 4 }), lastUpdateTimestamp: { timestamp: String(at(2026, 10, 4, 14, 59)) } }) });
  assert.equal(U.finished(running, done), true, "the list reloads once the run ends");
  assert.equal(U.progress(done, now), "Last checked Today 14:59");
});

test("a check the server skips entirely still ends, and says what it skipped", () => {
  const asked = U.reduce(loaded([]), { type: "checking" });
  const skipped = U.reduce(asked, { type: "status", reply: ok({ libraryUpdateStatus: status({ skippedMangasCount: 3 }), lastUpdateTimestamp: { timestamp: String(at(2026, 10, 3, 9, 5)) } }) });
  assert.equal(U.finished(asked, skipped), true);
  assert.equal(U.progress(skipped, now), "Last checked Yesterday 09:05, 3 manga skipped");
  assert.equal(U.finished(skipped, skipped), false, "an idle poll reloads nothing");
});

test("skipped manga name the skip filters that are on", () => {
  const poll = (settings) => U.reduce(loaded([]), { type: "status", reply: ok({ libraryUpdateStatus: status({ skippedMangasCount: 4 }), lastUpdateTimestamp: { timestamp: String(at(2026, 10, 4, 9, 5)) }, settings }) });
  assert.match(U.statusPayload().query, /settings \{ excludeUnreadChapters excludeNotStarted excludeCompleted \}/);
  assert.equal(U.progress(poll({ excludeUnreadChapters: true, excludeNotStarted: false, excludeCompleted: true }), now),
    "Last checked Today 09:05, 4 skipped: unread chapters, completed (change in Settings)");
  assert.equal(U.progress(poll({ excludeUnreadChapters: false, excludeNotStarted: true, excludeCompleted: false }), now),
    "Last checked Today 09:05, 4 skipped: not started (change in Settings)");
  assert.equal(U.progress(poll({ excludeUnreadChapters: false, excludeNotStarted: false, excludeCompleted: false }), now),
    "Last checked Today 09:05, 4 manga skipped", "with every filter off, an excluded category or the source skipped them");
});

test("a failed poll ends the check and keeps the last known status", () => {
  const asked = U.reduce(loaded([], status(), at(2026, 10, 1, 8)), { type: "checking" });
  const lost = U.reduce(asked, { type: "status", reply: M.reply(0, "") });
  assert.equal(lost.running, false);
  assert.equal(lost.checking, false);
  assert.equal(U.progress(lost, now), "Last checked 2026-10-01 08:00");
  assert.equal(U.progress(U.initial(), now), "Never checked");
});
