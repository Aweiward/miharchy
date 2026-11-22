// Migrate on miharchy-core: the loads and writes build their data from core's routes.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Mi = require("./load")("Migrate.js");
const M = require("./load")("Model.js");

const ok = (data) => M.coreReply(200, JSON.stringify(data));
const fail = (kind, message) => M.coreReply(400, JSON.stringify({ error: { kind, message } }));

// A fake core: each route answers from routes (a reply or a function of the body); every request is kept.
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

const chapter = (id, mangaId, chapterNumber, o) => Object.assign({ id, mangaId, chapterNumber, isRead: false, isBookmarked: false, isDownloaded: false }, o);
const OLD = { id: 1, title: "Eleceed", inLibrary: true, sourceId: "10", categories: [3, 5], meta: [{ key: "miharchy.readingMode", value: "WEBTOON" }],
  chapters: [chapter(11, 1, 1, { isRead: true }), chapter(12, 1, 2, { isRead: true, isBookmarked: true, isDownloaded: true }), chapter(13, 1, 3)] };
const TRACKERS = ok({ trackers: [{ id: 2, name: "AniList" }, { id: 3, name: "Kitsu" }] });

test("on core the old manga comes from manga.get with its tracks, in OLD_QUERY's shape", () => {
  const core = fakeCore({ "manga.get": ok({ manga: OLD }), "track.list": ok({ tracks: [{ id: 70, mangaId: 1, trackerId: 2 }] }), "tracker.list": TRACKERS });
  const [failed, node] = run(Mi.oldLoad, core.send, true, 1);
  assert.equal(failed, null);
  assert.deepEqual(core.routes(), ["manga.get", "track.list", "tracker.list"]);
  assert.deepEqual(core.sent[0].body, { id: 1 });
  assert.deepEqual(node.categories.nodes, [{ id: 3 }, { id: 5 }]);
  assert.deepEqual(node.trackRecords.nodes, [{ id: 70, trackerId: 2, tracker: { name: "AniList" } }]);
  assert.deepEqual(Mi.downloaded(node), [12]);
});

test("on core the target is fetched with manga.refresh, and a library target merges", () => {
  const target = { id: 40, title: "Eleceed", inLibrary: true, categories: [], meta: [], chapters: [] };
  const chapters = [chapter(41, 40, 1), chapter(42, 40, 2), chapter(43, 40, 3)];
  const core = fakeCore({ "manga.refresh": ok({ manga: target, chapters }), "track.list": ok({ tracks: [{ id: 71, mangaId: 40, trackerId: 3 }] }), "tracker.list": TRACKERS });
  const [failed, fetched] = run(Mi.targetLoad, core.send, true, 40);
  assert.equal(failed, null);
  assert.deepEqual(core.sent[0], { route: "manga.refresh", body: { id: 40 } });
  assert.deepEqual(fetched.chapters.map((c) => c.id), [41, 42, 43]);
  assert.deepEqual(Mi.mergeInto(fetched.manga).trackRecords.nodes.map((t) => t.tracker.name), ["Kitsu"]);
  // An empty chapter list is the source's error on core; it stops the pick.
  const empty = fakeCore({ "manga.refresh": fail("source", "The source returned no chapters for Eleceed.") });
  assert.equal(run(Mi.targetLoad, empty.send, true, 40)[0].message, "The source returned no chapters for Eleceed.");
});

const coreOld = () => run(Mi.oldLoad, fakeCore({ "manga.get": ok({ manga: OLD }), "track.list": ok({ tracks: [{ id: 70, mangaId: 1, trackerId: 2 }] }), "tracker.list": TRACKERS }).send, true, 1)[1];

test("the plan from the old manga's chapters marks what the target lacks", () => {
  const target = [chapter(41, 40, 1), chapter(42, 40, 2), chapter(43, 40, 3)];
  assert.deepEqual(Mi.plan(coreOld().chapters.nodes, target), { read: [41, 42], bookmark: [42] });
});

const everything = () => ({ "chapter.update": ok({ chapters: [] }), "meta.set": ok({ metas: [] }), "track.bind": ok({ track: {} }), "manga.update": ok({ mangas: [] }), "download.delete": ok({ chapters: [] }) });

test("on core the target's write marks, sets the mode, copies the tracks, and joins the library last", () => {
  const core = fakeCore(everything());
  const [reply] = run(Mi.writeTarget, core.send, true, coreOld(), 40, { read: [41, 42], bookmark: [42] }, true, null);
  assert.equal(reply.state, "ok");
  assert.deepEqual(core.sent, [
    { route: "chapter.update", body: { ids: [41, 42], isRead: true } },
    { route: "chapter.update", body: { ids: [42], isBookmarked: true } },
    { route: "meta.set", body: { metas: [{ scope: "manga", owner: 40, key: "miharchy.readingMode", value: "WEBTOON" }] } },
    { route: "track.bind", body: { mangaId: 40, recordId: 70 } },
    { route: "manga.update", body: { ids: [40], inLibrary: true, addToCategories: [3, 5], clearCategories: true } }
  ]);
});

test("on core a merge keeps the target's categories, mode and trackers, and skips what has nothing to send", () => {
  const core = fakeCore(everything());
  const merge = { meta: [{ key: "miharchy.readingMode", value: "PAGED" }], trackRecords: { nodes: [{ tracker: { name: "AniList" } }] } };
  run(Mi.writeTarget, core.send, true, coreOld(), 40, { read: [], bookmark: [] }, true, merge);
  assert.deepEqual(core.sent, [{ route: "manga.update", body: { ids: [40], inLibrary: true, addToCategories: [3, 5] } }]);
  const noTracks = fakeCore(everything());
  run(Mi.writeTarget, noTracks.send, true, coreOld(), 40, { read: [], bookmark: [] }, false, null);
  assert.deepEqual(noTracks.routes(), ["meta.set", "manga.update"], "t off: no track.bind");
});

test("on core a kept copy with no reading mode takes the old one, and a manga with no mode sets none", () => {
  const bare = fakeCore(everything());
  run(Mi.writeTarget, bare.send, true, coreOld(), 40, { read: [], bookmark: [] }, true, { meta: [], trackRecords: { nodes: [] } });
  assert.deepEqual(bare.routes(), ["meta.set", "track.bind", "manga.update"]);
  const noMode = fakeCore(everything());
  run(Mi.writeTarget, noMode.send, true, Object.assign({}, coreOld(), { meta: [] }), 40, { read: [], bookmark: [] }, false, null);
  assert.deepEqual(noMode.routes(), ["manga.update"]);
});

test("on core a failed step stops the chain before the target joins the library", () => {
  const routes = everything();
  routes["track.bind"] = fail("notFound", "There is no track 70.");
  const core = fakeCore(routes);
  const [reply] = run(Mi.writeTarget, core.send, true, coreOld(), 40, { read: [41], bookmark: [] }, true, null);
  assert.equal(reply.state, "error");
  assert.equal(reply.message, "There is no track 70.");
  assert.ok(!core.routes().includes("manga.update"), "the target never joins the library");
});

test("on core the old manga leaves the library, then loses its downloads; nothing to do sends nothing", () => {
  const core = fakeCore(everything());
  const [reply] = run(Mi.writeOld, core.send, true, coreOld(), true, true);
  assert.equal(reply.state, "ok");
  assert.deepEqual(core.sent, [{ route: "manga.update", body: { ids: [1], inLibrary: false } }, { route: "download.delete", body: { ids: [12] } }]);
  const none = fakeCore(everything());
  assert.deepEqual(run(Mi.writeOld, none.send, true, coreOld(), false, false), [null]);
  assert.deepEqual(none.sent, []);
  const copy = fakeCore(everything());
  run(Mi.writeOld, copy.send, true, coreOld(), false, true);
  assert.deepEqual(copy.routes(), ["download.delete"], "c with d: the old manga stays, its downloads go");
  const keep = fakeCore(everything());
  run(Mi.writeOld, keep.send, true, coreOld(), true, false);
  assert.deepEqual(keep.routes(), ["manga.update"], "m without d: the downloads stay");
  const bare = fakeCore(everything());
  const noDownloads = Object.assign({}, coreOld(), { chapters: { nodes: [chapter(11, 1, 1)] } });
  assert.deepEqual(run(Mi.writeOld, bare.send, true, noDownloads, false, true), [null], "c with d on a manga with nothing downloaded");
  assert.deepEqual(bare.sent, []);
});

test("on core the library, the source names and the highest chapters build the data the pure functions read", () => {
  const core = fakeCore({
    "library.list": ok({ mangas: [{ id: 1, title: "Eleceed", sourceId: "10", source: { displayName: "MangaDex (EN)" } }, { id: 2, title: "Gone", sourceId: "99", source: null }], categories: [] }),
    "meta.get": ok({ metas: [{ scope: "global", owner: 0, key: M.SOURCE_NAMES_META, value: "{\"99\":\"Old Source\"}" }] }),
    "chapter.list": ok({ chapters: [chapter(11, 1, 1), chapter(12, 1, 120.5), chapter(13, 1, -1)] })
  });
  const [lib] = run(Mi.libraryLoad, core.send, true);
  assert.deepEqual(core.sent[1].body, { scope: "global", keys: [M.SOURCE_NAMES_META] });
  assert.deepEqual(Mi.librarySources(lib.data).map((s) => [s.name, s.missing, s.manga.length]), [["MangaDex (EN)", false, 1], ["Old Source (not installed)", true, 1]]);
  const [high] = run(Mi.highestLoad, core.send, true, [2, 1]);
  assert.deepEqual(core.sent[2].body, { mangaIds: [2, 1] });
  assert.deepEqual(Mi.withHighest([{ id: 2 }, { id: 1 }], high.data).map((m) => m.highest), [-1, 120.5]);
});

test("on core a stalled manga's chapter check is one manga.refresh, and its reply decides", () => {
  const source = { id: "3", name: "Weeb Central (EN)", lang: "en", core: true };
  let b = Mi.batch([{ id: 1, title: "Eleceed", stalled: true, highest: 300, targets: [source] }]);
  b = Mi.reduceBatch(b, 0, { type: "request" });
  b = Mi.reduceBatch(b, 0, { type: "reply", attempt: b.search.groups[0].attempt, reply: ok({ mangas: [{ id: 100, title: "Eleceed", inLibrary: false }], hasNextPage: false }), config: { backend: "core" } });
  assert.deepEqual(Mi.checkPayload(b, 0, true), { route: "manga.refresh", body: { id: 100 } });
  b = Mi.reduceBatch(Mi.reduceBatch(b, 0, { type: "check" }), 0, { type: "checked", reply: ok({ manga: { id: 100 }, chapters: [chapter(1, 100, 300), chapter(2, 100, 301)] }) });
  assert.equal(Mi.chosen(b, 0).id, 100);
});
