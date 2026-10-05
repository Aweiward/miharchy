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
  assert.deepEqual(U.updates(data, now).map((c) => c.id), [1]);
  assert.equal(U.count(data, now), 1, "the mark's count is the list's length");
  assert.equal(U.count({}, now), 0, "a reply with no chapters counts none");
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

test("downloaded only lists only the downloaded updates, with each day's header on its first shown row", () => {
  const nodes = [
    chapter(2, other, at(2026, 10, 4, 14)),
    chapter(5, manga, at(2026, 10, 4, 11), { isDownloaded: true }),
    chapter(1, manga, at(2026, 10, 2, 10), { isDownloaded: true })
  ];
  const all = U.reduce(U.initial(), { type: "list", reply: list(nodes), config, now });
  assert.deepEqual(all.rows.map((r) => r.id), [2, 5, 1]);
  const Pr = require("./load")("Prefs.js");
  const forced = Pr.force(Pr.defaults(U.PREFS), "updatesFilterDownloaded", "include", true);
  const only = U.reduce(U.initial(), { type: "list", reply: list(nodes), config, now, prefs: forced });
  assert.deepEqual(only.rows.map((r) => [r.id, r.header]), [[5, "Today"], [1, all.rows[2].header]]);
  assert.equal(U.count(list(nodes).data, now), 3, "the bar mark still counts every update");
  const withRead = [nodes[0], nodes[1], { ...nodes[2], isRead: true }];
  const both = Pr.force({ ...Pr.defaults(U.PREFS), updatesFilterUnread: "off", updatesFilterDownloaded: "exclude" }, "updatesFilterDownloaded", "include", true);
  assert.deepEqual(U.reduce(U.initial(), { type: "list", reply: list(withRead), config, now, prefs: both }).rows.map((r) => r.id), [5, 1],
    "the forced filter wins over the stored one and works with the user's other filters");
  assert.equal(U.count(list(withRead).data, now), 2, "the mark counts unread updates, unfiltered");
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
    cover: "http://127.0.0.1:4590/api/v1/manga/7/thumbnail",
    read: false, lastPage: 0, bookmarked: false, downloaded: false
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
  assert.match(U.checkPayload().query, /updateLibrary\(input: \{ categories: \$categories \}\)/);
  assert.deepEqual(U.checkPayload().variables, { categories: null }, "no categories: the whole library, without the excluded ones");
  assert.deepEqual(U.checkPayload([4]).variables, { categories: [4] });
  const asked = U.reduce(idle, { type: "checking" });
  assert.equal(U.progress(asked, now), "Checking for new chapters");
  const running = U.reduce(asked, { type: "status", reply: ok({ libraryUpdateStatus: status({ isRunning: true, finishedJobs: 1, totalJobs: 4 }), lastUpdateTimestamp: { timestamp: String(at(2026, 10, 4, 14, 59)) } }) });
  assert.equal(U.finished(asked, running), false);
  assert.equal(U.progress(running, now), "Checking for new chapters 1 / 4");
  const done = U.reduce(running, { type: "status", reply: ok({ libraryUpdateStatus: status({ finishedJobs: 4, totalJobs: 4 }), lastUpdateTimestamp: { timestamp: String(at(2026, 10, 4, 14, 59)) } }) });
  assert.equal(U.finished(running, done), true, "the list reloads once the run ends");
  assert.equal(U.progress(done, now), "Last checked Today 14:59");
});

test("a stopped run says where it stopped until the next run starts", () => {
  const poll = (o) => ({ type: "status", reply: ok({ libraryUpdateStatus: status(o), lastUpdateTimestamp: { timestamp: String(at(2026, 10, 4, 14, 59)) } }) });
  assert.match(U.stopPayload().query, /updateStop\(input: \{\}\)/);
  const running = U.reduce(U.reduce(loaded([]), { type: "checking" }), poll({ isRunning: true, finishedJobs: 3, totalJobs: 10 }));
  const stopped = U.reduce(running, { type: "stopped" });
  assert.equal(U.finished(running, stopped), true, "the list reloads with what the run found");
  assert.equal(U.progress(stopped, now), "Stopped checking for new chapters at 3 / 10");
  const after = U.reduce(stopped, poll({}));
  assert.equal(U.progress(after, now), "Stopped checking for new chapters at 3 / 10", "the server forgets the counts; the line keeps them");
  assert.equal(U.reduce(U.initial(), { type: "stopped" }).stopped, null, "nothing running, nothing stopped");
  assert.equal(U.progress(U.reduce(U.reduce(loaded([]), { type: "checking" }), { type: "stopped" }), now), "Stopped checking for new chapters", "stopped before the first poll");
  assert.equal(U.progress(U.reduce(after, { type: "checking" }), now), "Checking for new chapters", "u starts over");
  assert.equal(U.progress(U.reduce(after, poll({ isRunning: true, finishedJobs: 0, totalJobs: 5 })), now), "Checking for new chapters 0 / 5", "so does a scheduled run");
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

test("only chapters uploaded in the last 3 months are updates, as in Mihon", () => {
  const data = list([
    chapter(1, manga, at(2026, 10, 3, 20), { uploadDate: String(at(2026, 7, 5, 15)) }),
    chapter(2, manga, at(2026, 10, 3, 20), { uploadDate: String(at(2026, 7, 3, 15)), name: "uploaded more than 3 months ago" }),
    chapter(3, manga, at(2026, 10, 3, 20), { uploadDate: "0", name: "no upload date" })
  ]).data;
  assert.deepEqual(U.updates(data, now).map((c) => c.id), [1]);
  assert.equal(U.count(data, now), 1);
  assert.deepEqual(U.rows(data, config, now).map((r) => r.id), [1], "the list and the bar mark use the same rule");
});

const Ch = require("./load")("Chapters.js");
const D = require("./load")("Downloads.js");

test("the selection: toggle, invert, and a reload drops what left the list", () => {
  const rows = loaded([chapter(1, manga, at(2026, 10, 4, 14)), chapter(2, other, at(2026, 10, 4, 13)), chapter(3, manga, at(2026, 10, 4, 12))]).rows;
  assert.deepEqual(U.toggle([], 2), [2]);
  assert.deepEqual(U.toggle([2, 3], 2), [3]);
  assert.deepEqual(U.invert([2], rows), [1, 3]);
  assert.deepEqual(U.invert([], rows), [1, 2, 3], "invert of nothing selects all, as Mihon's select all");
  assert.deepEqual(U.keep([1, 2, 9], rows), [1, 2]);
});

test("an action takes the selection, or the row under the cursor when none is selected", () => {
  const rows = loaded([chapter(1, manga, at(2026, 10, 4, 14)), chapter(2, other, at(2026, 10, 4, 13)), chapter(3, manga, at(2026, 10, 4, 12))]).rows;
  assert.deepEqual(U.chosen(rows, [], 1).map((r) => r.id), [2]);
  assert.deepEqual(U.chosen(rows, [3, 1], 1).map((r) => r.id), [1, 3], "list order, whatever the order chosen");
  assert.deepEqual(U.chosen([], [], 0), []);
  assert.deepEqual(U.mangaIds(U.chosen(rows, [1, 2, 3], 0)), [7, 8], "each manga once, for the tracker push");
});

test("rows carry what the shared chapter actions need, across manga", () => {
  const rows = loaded([
    chapter(1, manga, at(2026, 10, 4, 14), { lastPageRead: 4, isDownloaded: true }),
    chapter(2, other, at(2026, 10, 4, 13), { isBookmarked: true }),
    chapter(3, manga, at(2026, 10, 4, 12))
  ]).rows;
  assert.match(U.UPDATES_QUERY, /lastPageRead isBookmarked isDownloaded/);
  assert.deepEqual(Ch.markPayload(rows, true).variables, { ids: [1, 2, 3], started: [], read: true });
  assert.deepEqual(Ch.markPayload(rows, false).variables, { ids: [], started: [1], read: false }, "unread only sends a started update back to page 1");
  assert.deepEqual(Ch.bookmarkPayload(rows).variables, { ids: [1, 3], bookmarked: true });
  assert.deepEqual(Ch.bookmarkPayload([rows[1]]).variables, { ids: [2], bookmarked: false });
  assert.deepEqual(D.enqueuePayload(rows).variables, { ids: [2, 3] });
  assert.deepEqual(D.removePayload(rows, []).variables, { ids: [1] });
  assert.equal(D.removePayload([rows[1]], []), null, "nothing on disk, nothing to confirm");
});

const P = require("./load")("Prefs.js");
const prefs = (extra) => ({ ...P.defaults(U.PREFS), ...extra });
const filtered = (nodes, extra) => U.reduce(U.initial(), { type: "list", reply: list(nodes), config, now, prefs: prefs(extra) });
const ids = (u) => u.rows.map((r) => r.id);

test("the view starts on unread updates, the bar mark's list, and shows read ones with unread off", () => {
  const nodes = [
    chapter(1, manga, at(2026, 10, 4, 14), { isRead: true }),
    chapter(2, manga, at(2026, 10, 4, 13))
  ];
  assert.deepEqual(ids(filtered(nodes)), [2]);
  const all = filtered(nodes, { updatesFilterUnread: "off" });
  assert.deepEqual(ids(all), [1, 2]);
  assert.equal(all.rows[0].read, true, "a read update says so, for the dim row and the actions");
  assert.deepEqual(ids(filtered(nodes, { updatesFilterUnread: "exclude" })), [1]);
  assert.equal(U.count(list(nodes).data, now), 1, "the mark still counts unread updates only");
});

test("downloaded, started and bookmarked filter as Mihon's updatesView.sq does", () => {
  const nodes = [
    chapter(1, manga, at(2026, 10, 4, 14), { isDownloaded: true }),
    chapter(2, manga, at(2026, 10, 4, 13), { lastPageRead: 3 }),
    chapter(3, manga, at(2026, 10, 4, 12), { isBookmarked: true, isRead: true, lastPageRead: 9 }),
    chapter(4, manga, at(2026, 10, 4, 11))
  ];
  const off = { updatesFilterUnread: "off" };
  assert.deepEqual(ids(filtered(nodes, { ...off, updatesFilterDownloaded: "include" })), [1]);
  assert.deepEqual(ids(filtered(nodes, { ...off, updatesFilterDownloaded: "exclude" })), [2, 3, 4]);
  assert.deepEqual(ids(filtered(nodes, { ...off, updatesFilterStarted: "include" })), [2], "started: some progress and not read");
  assert.deepEqual(ids(filtered(nodes, { ...off, updatesFilterStarted: "exclude" })), [1, 4], "not started drops read chapters too, as in Mihon");
  assert.deepEqual(ids(filtered(nodes, { ...off, updatesFilterBookmarked: "include" })), [3]);
  assert.deepEqual(ids(filtered(nodes, { ...off, updatesFilterBookmarked: "exclude" })), [1, 2, 4]);
});

test("categories include or exclude manga, 0 standing for manga in no category", () => {
  const inCat = (m, cats) => ({ ...m, categories: { nodes: cats.map((id) => ({ id })) } });
  const nodes = [
    chapter(1, inCat(manga, [3]), at(2026, 10, 4, 14)),
    chapter(2, inCat(other, []), at(2026, 10, 4, 13)),
    chapter(3, inCat({ ...manga, id: 9 }, [4]), at(2026, 10, 4, 12))
  ];
  assert.deepEqual(ids(filtered(nodes, { updatesIncludedCategories: "[3]" })), [1]);
  assert.deepEqual(ids(filtered(nodes, { updatesIncludedCategories: "[0,4]" })), [2, 3]);
  assert.deepEqual(ids(filtered(nodes, { updatesExcludedCategories: "[3]" })), [2, 3]);
  assert.deepEqual(ids(filtered(nodes, { updatesExcludedCategories: "[0]" })), [1, 3]);
  assert.deepEqual(ids(filtered(nodes, { updatesIncludedCategories: "not json" })), [1, 2, 3], "a broken value filters nothing");
});

test("hiding excluded scanlators drops the chapters a manga's own filter excludes", () => {
  const meta = [{ key: "miharchy.excludedScanlators", value: JSON.stringify(["Bad Scans"]) }];
  const nodes = [
    chapter(1, { ...manga, meta }, at(2026, 10, 4, 14), { scanlator: "Bad Scans" }),
    chapter(2, { ...manga, meta }, at(2026, 10, 4, 13), { scanlator: "Good Scans" }),
    chapter(3, other, at(2026, 10, 4, 12), { scanlator: "Bad Scans" })
  ];
  assert.deepEqual(ids(filtered(nodes)), [1, 2, 3], "off by default, as in Mihon");
  assert.deepEqual(ids(filtered(nodes, { updatesHideExcludedScanlators: "on" })), [2, 3]);
});

test("the filter panel cycles a filter and a category, and a change filters the loaded list again", () => {
  const cats = [{ id: 3, name: "Action" }];
  let p = prefs();
  const rows = U.filterRows(p, cats);
  assert.deepEqual(rows.map((r) => r.label), ["Unread", "Downloaded", "Started", "Bookmarked", "Hide excluded scanlators", "Categories", "Default", "Action"]);
  assert.deepEqual(rows.map((r) => r.mark), ["[+]", "[ ]", "[ ]", "[ ]", "[ ]", "", "[ ]", "[ ]"]);
  assert.equal(U.filterRows(p, []).length, 5, "no categories, no category rows");
  const apply = (changes) => { changes.forEach((c) => { p = { ...p, [c.key]: c.value }; }); };
  apply(U.choose(p, rows[0]));
  assert.equal(p.updatesFilterUnread, "exclude");
  apply(U.choose(p, U.filterRows(p, cats)[0]));
  assert.equal(p.updatesFilterUnread, "off");
  apply(U.choose(p, U.filterRows(p, cats)[4]));
  assert.equal(p.updatesHideExcludedScanlators, "on");
  assert.deepEqual(U.choose(p, U.filterRows(p, cats)[5]), [], "the header changes nothing");
  apply(U.choose(p, U.filterRows(p, cats)[7]));
  assert.deepEqual([p.updatesIncludedCategories, p.updatesExcludedCategories], ["[3]", "[]"]);
  apply(U.choose(p, U.filterRows(p, cats)[7]));
  assert.deepEqual([p.updatesIncludedCategories, p.updatesExcludedCategories], ["[]", "[3]"]);
  apply(U.choose(p, U.filterRows(p, cats)[7]));
  assert.deepEqual([p.updatesIncludedCategories, p.updatesExcludedCategories], ["[]", "[]"]);

  const nodes = [chapter(1, manga, at(2026, 10, 4, 14), { isRead: true }), chapter(2, manga, at(2026, 10, 4, 13))];
  const u = filtered(nodes);
  assert.deepEqual(ids(u), [2]);
  const again = U.reduce(u, { type: "filter", config, now, prefs: prefs({ updatesFilterUnread: "off" }) });
  assert.deepEqual(ids(again), [1, 2]);
  const none = U.reduce(u, { type: "filter", config, now, prefs: prefs({ updatesFilterBookmarked: "include" }) });
  assert.deepEqual(U.notice(none, ""), { title: "No updates match the filters", detail: "Press F to change the filters." });
});

test("the view's query cuts at 3 months on the server and asks for what the filters test", () => {
  const p = U.viewPayload(now);
  assert.equal(p.variables.since, String(new Date(2026, 6, 4, 15).getTime()));
  assert.match(U.VIEW_QUERY, /uploadDate: \{ greaterThan: \$since \}/);
  assert.match(U.VIEW_QUERY, /scanlator manga \{ id title thumbnailUrl inLibraryAt categories \{ nodes \{ id \} \} meta \{ key value \} \}/);
  assert.doesNotMatch(U.VIEW_QUERY, /isRead: \{/, "read updates come too");
});
