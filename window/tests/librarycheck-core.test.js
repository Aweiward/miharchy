// The library check on miharchy-core (MIHARCHY_BACKEND=core, #394): QUERY's data from core's routes.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const L = require("./load")("LibraryCheck.js");
const M = require("./load")("Model.js");

const ok = (data) => M.coreReply(200, JSON.stringify(data));
const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 9, 9, 12);
const secs = (ms) => Math.floor(ms / 1000);
const MD = "2499283573021220255";

function fakeCore(routes) {
  const sent = [];
  const send = (payload, done) => {
    sent.push(payload);
    assert.ok(payload.route && !payload.query, "core routes only: " + JSON.stringify(payload));
    const r = routes[payload.route];
    assert.ok(r, "no answer for " + payload.route);
    done(typeof r === "function" ? r(payload.body) : r);
  };
  return { sent, send, routes: () => sent.map((p) => p.route) };
}
const run = (fn, ...args) => { let out; fn(...args, (...r) => { out = r; }); return out; };

// One library as core's library.list gives it, in core's units: seconds for fetch times, ms for uploads.
function coreManga(id, over) {
  return {
    id, title: "Manga " + id, status: "ONGOING", updateStrategy: "ALWAYS_UPDATE", sourceId: MD,
    source: { id: MD, displayName: "MangaDex (EN)", lang: "en" }, unreadCount: 0, chapterCount: 10,
    lastReadChapter: { lastReadAt: secs(NOW - DAY) }, chaptersLastFetchedAt: secs(NOW - DAY),
    latestUploadedChapter: { uploadDate: NOW - 2 * DAY }, latestFetchedChapter: { fetchedAt: secs(NOW - DAY) },
    categories: [], meta: [], ...over
  };
}
const LIB = [
  coreManga(1),
  coreManga(2, { title: "Gone", sourceId: "99", source: null }),
  coreManga(3, { chaptersLastFetchedAt: secs(NOW - 20 * DAY) }),
  coreManga(4, { chapterCount: 0, latestUploadedChapter: null, latestFetchedChapter: null }),
  coreManga(5, { title: "Manga 1 (Official)" }),
  coreManga(6, { latestUploadedChapter: { uploadDate: NOW - 200 * DAY }, meta: [{ key: L.DISMISSED_META, value: "{\"stalled\":" + (NOW - DAY) + "}" }] }),
  coreManga(7, { unreadCount: 3, chaptersLastFetchedAt: secs(NOW - 30 * DAY) })
];
const routes = (over) => ({
  "library.list": ok({ mangas: LIB, categories: [] }),
  "meta.get": ok({ metas: [{ scope: "global", owner: 0, key: M.SOURCE_NAMES_META, value: "{\"99\":\"Old Source\"}" }] }),
  "extension.list": ok({ extensions: [{ pkgName: "eu.kanade.tachiyomi.extension.all.mangadex", name: "MangaDex", hasUpdate: true, isInstalled: true, sources: [{ id: MD, displayName: "MangaDex (EN)" }] }] }),
  "update.status": ok({ isRunning: false, lastUpdateTimestamp: NOW - 3600 * 1000, failed: [{ mangaId: 7, kind: "source", message: "x" }] }),
  "settings.get": ok({ settings: { excludeUnreadChapters: false, excludeNotStarted: false, excludeCompleted: false, globalUpdateInterval: 12 }, unapplied: [] }),
  ...over
});

// The same library as Suwayomi's QUERY gives it.
function suwayomiData() {
  const ext = { pkgName: "eu.kanade.tachiyomi.extension.all.mangadex", name: "MangaDex", hasUpdate: true };
  return {
    mangas: { nodes: LIB.map((m) => ({
      id: m.id, title: m.title, status: m.status, updateStrategy: m.updateStrategy, sourceId: m.sourceId, unreadCount: m.unreadCount,
      chaptersLastFetchedAt: String(m.chaptersLastFetchedAt), source: m.source ? { id: m.source.id, displayName: m.source.displayName, extension: ext } : null,
      chapters: { totalCount: m.chapterCount }, lastReadChapter: m.lastReadChapter ? { id: 1 } : null,
      latestUploadedChapter: m.latestUploadedChapter && { uploadDate: String(m.latestUploadedChapter.uploadDate) },
      latestFetchedChapter: m.latestFetchedChapter && { fetchedAt: String(m.latestFetchedChapter.fetchedAt) }, meta: m.meta
    })) },
    metas: { nodes: [{ value: "{\"99\":\"Old Source\"}" }] },
    lastUpdateTimestamp: { timestamp: String(NOW - 3600 * 1000) },
    settings: { excludeUnreadChapters: false, excludeNotStarted: false, excludeCompleted: false },
    libraryUpdateStatus: { mangaUpdates: [{ status: "FAILED", manga: { id: 7 } }, { status: "COMPLETE", manga: { id: 1 } }] }
  };
}

test("on core the check reads the library, source names, extensions, the last run and the skip filters", () => {
  const core = fakeCore(routes());
  const [reply] = run(L.load, core.send, true);
  assert.equal(reply.state, "ok");
  assert.deepEqual(core.routes(), ["library.list", "meta.get", "extension.list", "update.status", "settings.get"]);
  assert.deepEqual(core.sent[1].body, { scope: "global", keys: [M.SOURCE_NAMES_META] });
});

test("on core the check finds the same problems as on Suwayomi, every kind", () => {
  const [reply] = run(L.load, fakeCore(routes()).send, true);
  const strip = (list) => list.map(({ dismissals, ...p }) => p);
  const onCore = L.problems(reply.data, NOW);
  assert.deepEqual(strip(onCore), strip(L.problems(suwayomiData(), NOW)));
  const kinds = onCore.map((p) => p.kind + ":" + p.mangaId + (p.dismissed ? " dismissed" : ""));
  for (const k of ["missing:2", "failed:3", "empty:4", "extension:1", "duplicate:1", "duplicate:5", "stalled:6 dismissed", "failed:7"]) assert.ok(kinds.includes(k), k + " in " + kinds);
  assert.equal(onCore.find((p) => p.kind === "missing").source, "Old Source", "named from the source names meta");
  assert.equal(onCore.find((p) => p.mangaId === 7 && p.kind === "failed").reason, "The last library update failed for it.");
});

test("on core the skip filters come from settings.get and leave out what the update skips", () => {
  const over = { "settings.get": ok({ settings: { excludeUnreadChapters: true, excludeNotStarted: false, excludeCompleted: false }, unapplied: [] }) };
  const [reply] = run(L.load, fakeCore(routes(over)).send, true);
  const kinds = L.problems(reply.data, NOW).map((p) => p.kind + ":" + p.mangaId);
  assert.ok(!kinds.includes("failed:7"), "unread chapters: skipped by design");
  assert.ok(kinds.includes("failed:3"));
});

test("on core a failed route stops the load with core's reply", () => {
  const core = fakeCore(routes({ "extension.list": M.coreReply(0, "") }));
  const [reply] = run(L.load, core.send, true);
  assert.equal(reply.state, "down");
  assert.deepEqual(core.routes(), ["library.list", "meta.get", "extension.list"]);
  assert.equal(M.problem(reply, "/c/core.json", "core").title, "miharchy-core is not running");
});

test("on core a dismiss is one meta.set per batch, keeping each manga's other kinds", () => {
  const [reply] = run(L.load, fakeCore(routes()).send, true);
  const list = L.problems(reply.data, NOW).filter((p) => p.mangaId === 6 || p.mangaId === 2);
  const p = L.dismissPayload(list, NOW, false, true);
  assert.equal(p.route, "meta.set");
  assert.deepEqual(p.body.metas.map((m) => [m.scope, m.owner, m.key]), [["manga", 2, L.DISMISSED_META], ["manga", 6, L.DISMISSED_META]]);
  assert.deepEqual(JSON.parse(p.body.metas[1].value), { stalled: NOW, extension: NOW });
  assert.deepEqual(L.dismissPayload(list, NOW, false, false).variables.m0, { mangaId: 2, key: L.DISMISSED_META, value: p.body.metas[0].value }, "the same value as on Suwayomi");
});

test("on core the merge prompt reads both copies from the database, with category and tracker names", () => {
  const detail = (id, over) => ({ id, title: "Eleceed", sourceId: MD, source: { displayName: "MangaDex (EN)" }, categories: [1], chapters: [{ isRead: true }, { isRead: false }], ...over });
  const core = fakeCore({
    "manga.get": (b) => ok({ manga: b.id === 4 ? detail(4) : detail(6, { sourceId: "99", source: null, categories: [], chapters: [] }) }),
    "track.list": ok({ tracks: [{ id: 1, mangaId: 4, trackerId: 2 }] }),
    "tracker.list": ok({ trackers: [{ id: 2, name: "AniList" }] }),
    "category.list": ok({ categories: [{ id: 1, name: "Action" }] }),
    "meta.get": ok({ metas: [{ scope: "global", owner: 0, key: M.SOURCE_NAMES_META, value: "{\"99\":\"Old Source\"}" }] })
  });
  const [reply] = run(L.mergeLoad, core.send, true, { mangaId: 4, others: [6] });
  assert.deepEqual(core.sent.slice(0, 3).map((p) => [p.route, p.body]), [["manga.get", { id: 4 }], ["manga.get", { id: 6 }], ["track.list", { mangaIds: [4, 6] }]]);
  const copies = L.mergeCopies(reply.data);
  assert.deepEqual(copies.map((c) => [c.id, c.source, c.missing, c.read, c.total, c.categories, c.tracks]), [
    [4, "MangaDex (EN)", false, 1, 2, ["Action"], ["AniList"]],
    [6, "Old Source (not installed)", true, 0, 0, [], []]
  ]);
  assert.equal(L.mergeStart(copies), 0, "the copy with its source gone cannot be kept");
});
