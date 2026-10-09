const { test } = require("node:test");
const assert = require("node:assert/strict");
const L = require("./load")("LibraryCheck.js");

const DAY = 24 * 3600 * 1000;
// 2026-10-09 12:00 UTC, in ms as Date.now() gives it.
const NOW = Date.UTC(2026, 9, 9, 12);
const secs = (ms) => String(Math.floor(ms / 1000));

const MANGADEX = { id: "2499283573021220255", displayName: "MangaDex (EN)", extension: { pkgName: "eu.kanade.tachiyomi.extension.all.mangadex", name: "MangaDex", hasUpdate: false } };

// A healthy library manga as QUERY returns it: timestamps in the server's
// units, seconds for fetch times and ms for upload dates.
function node(id, over) {
  return {
    id, title: "Manga " + id, status: "ONGOING", updateStrategy: "ALWAYS_UPDATE",
    sourceId: MANGADEX.id, source: MANGADEX, unreadCount: 0, lastReadChapter: { id: 1 },
    chaptersLastFetchedAt: secs(NOW - DAY), chapters: { totalCount: 10 },
    latestUploadedChapter: { uploadDate: String(NOW - 2 * DAY) }, latestFetchedChapter: { fetchedAt: secs(NOW - DAY) },
    meta: [],
    ...over
  };
}

function data(nodes, over) {
  return {
    mangas: { nodes },
    metas: { nodes: [] },
    lastUpdateTimestamp: { timestamp: String(NOW - 3600 * 1000) },
    settings: { excludeUnreadChapters: false, excludeNotStarted: false, excludeCompleted: false },
    libraryUpdateStatus: { mangaUpdates: [] },
    ...over
  };
}

const kinds = (d) => L.problems(d, NOW).map((p) => p.kind + ":" + p.mangaId);

test("a healthy library has no problems", () => {
  assert.deepEqual(kinds(data([node(1), node(2, { title: "Other" })])), []);
});

test("the query asks for what each kind needs, the skip settings and the update run", () => {
  for (const f of ["chaptersLastFetchedAt", "updateStrategy", "unreadCount", "lastReadChapter", "extension { pkgName name hasUpdate }", "meta { key value }", "excludeNotStarted", "mangaUpdates { status manga { id } }", "lastUpdateTimestamp { timestamp }", "miharchy.sourceNames"]) assert.ok(L.QUERY.includes(f), f);
});

test("source missing: the source is null, named from the phone's source names", () => {
  const d = data([node(1, { source: null, sourceId: "77" })], { metas: { nodes: [{ value: JSON.stringify({ 77: "Asura Scans" }) }] } });
  const [p] = L.problems(d, NOW);
  assert.equal(p.kind, "missing");
  assert.equal(p.source, "Asura Scans");
  assert.equal(L.problems(data([node(1, { source: null, sourceId: "78" })]), NOW)[0].source, "Unknown source 78");
});

test("update failed: no chapter fetch for over 14 days while library updates ran since", () => {
  const old = { chaptersLastFetchedAt: secs(NOW - 15 * DAY) };
  assert.deepEqual(kinds(data([node(1, old)])), ["failed:1"]);
  assert.deepEqual(kinds(data([node(1, { chaptersLastFetchedAt: secs(NOW - 13 * DAY) })])), [], "13 days is not yet");
  assert.deepEqual(kinds(data([node(1, old)], { lastUpdateTimestamp: { timestamp: String(NOW - 16 * DAY) } })), [], "no update ran since");
  assert.deepEqual(kinds(data([node(1, old)], { lastUpdateTimestamp: { timestamp: "0" } })), [], "never updated");
});

test("update failed leaves out what the update skips by design", () => {
  const old = { chaptersLastFetchedAt: secs(NOW - 30 * DAY) };
  const on = (key) => ({ settings: { excludeUnreadChapters: false, excludeNotStarted: false, excludeCompleted: false, [key]: true } });
  assert.deepEqual(kinds(data([node(1, { ...old, unreadCount: 3 })], on("excludeUnreadChapters"))), []);
  assert.deepEqual(kinds(data([node(1, { ...old, unreadCount: 3 })])), ["failed:1"], "the filter off");
  assert.deepEqual(kinds(data([node(1, { ...old, lastReadChapter: null })], on("excludeNotStarted"))), []);
  assert.deepEqual(kinds(data([node(1, { ...old, status: "COMPLETED" })], on("excludeCompleted"))), []);
  assert.deepEqual(kinds(data([node(1, { ...old, updateStrategy: "ONLY_FETCH_ONCE" })])), []);
  assert.deepEqual(kinds(data([node(1, { ...old, source: null })])), ["missing:1"], "a missing source is its own problem");
});

test("update failed: a FAILED job in the last run is the reason", () => {
  const n = node(1, { chaptersLastFetchedAt: secs(NOW - 20 * DAY) });
  assert.match(L.problems(data([n]), NOW)[0].reason, /20 days/);
  const failed = L.problems(data([n], { libraryUpdateStatus: { mangaUpdates: [{ status: "FAILED", manga: { id: 1 } }] } }), NOW)[0];
  assert.match(failed.reason, /last library update failed/);
});

test("no chapters", () => {
  assert.deepEqual(kinds(data([node(1, { chapters: { totalCount: 0 }, latestUploadedChapter: null, latestFetchedChapter: null })])), ["empty:1"]);
});

test("extension update: the extension serving the source has one", () => {
  const src = { ...MANGADEX, extension: { ...MANGADEX.extension, hasUpdate: true } };
  const [p] = L.problems(data([node(1, { source: src })]), NOW);
  assert.equal(p.kind, "extension");
  assert.equal(p.pkgName, "eu.kanade.tachiyomi.extension.all.mangadex");
});

test("duplicate: titles equal after case, punctuation and a trailing (…) suffix, from any sources", () => {
  const d = data([node(1, { title: "Eleceed" }), node(2, { title: "ELECEED! (Official)", sourceId: "9", source: { id: "9", displayName: "Weeb Central", extension: null } }), node(3, { title: "Solo Leveling" })]);
  assert.deepEqual(kinds(d), ["duplicate:1", "duplicate:2"]);
  assert.match(L.problems(d, NOW)[0].reason, /Weeb Central/);
  assert.deepEqual(L.problems(d, NOW)[0].others, [2]);
});

test("duplicate: similarity at 0.9 counts, below it does not", () => {
  // 10 letters, one changed: similarity 0.9.
  assert.deepEqual(kinds(data([node(1, { title: "Abcdefghij" }), node(2, { title: "Abcdefghiz" })])), ["duplicate:1", "duplicate:2"]);
  // 9 letters, one changed: similarity 0.89.
  assert.deepEqual(kinds(data([node(1, { title: "Abcdefghi" }), node(2, { title: "Abcdefghz" })])), []);
});

test("duplicate: titles with no Latin letters still compare as written", () => {
  assert.deepEqual(kinds(data([node(1, { title: "俺だけレベルアップな件" }), node(2, { title: "나 혼자만 레벨업" })])), []);
  assert.deepEqual(kinds(data([node(1, { title: "俺だけレベルアップな件" }), node(2, { title: "俺だけレベルアップな件" })])), ["duplicate:1", "duplicate:2"]);
});

test("stalled: ongoing with no new chapter for 6 months by upload date", () => {
  const up = (ago) => ({ latestUploadedChapter: { uploadDate: String(NOW - ago * DAY) } });
  assert.deepEqual(kinds(data([node(1, up(200))])), ["stalled:1"]);
  assert.deepEqual(kinds(data([node(1, up(170))])), []);
  assert.deepEqual(kinds(data([node(1, { ...up(200), status: "COMPLETED" })])), [], "only ongoing");
});

test("stalled falls back to the fetch time when the source gives no upload date", () => {
  const n = (ago) => node(1, { latestUploadedChapter: { uploadDate: "0" }, latestFetchedChapter: { fetchedAt: secs(NOW - ago * DAY) } });
  assert.deepEqual(kinds(data([n(200)])), ["stalled:1"]);
  assert.deepEqual(kinds(data([n(20)])), []);
});

const dismissed = (map) => [{ key: "miharchy.checkDismissed", value: JSON.stringify(map) }];

test("a dismissed problem is marked, and others of the manga are not", () => {
  const d = data([node(1, { source: null, chapters: { totalCount: 0 }, latestUploadedChapter: null, latestFetchedChapter: null, meta: dismissed({ missing: NOW - DAY }) })]);
  const ps = L.problems(d, NOW);
  assert.deepEqual(ps.map((p) => [p.kind, p.dismissed]), [["missing", true], ["empty", false]]);
  assert.equal(L.count(ps), 1);
});

test("a stalled dismiss lapses when a newer chapter arrives", () => {
  const at = NOW - 10 * DAY;
  const stalled = (uploaded) => L.problems(data([node(1, { latestUploadedChapter: { uploadDate: String(uploaded) }, meta: dismissed({ stalled: at }) })]), NOW)[0];
  assert.equal(stalled(NOW - 200 * DAY).dismissed, true);
  const lapsed = L.problems(data([node(1, { latestUploadedChapter: { uploadDate: "0" }, latestFetchedChapter: { fetchedAt: secs(NOW - 200 * DAY) }, meta: dismissed({ stalled: NOW - 300 * DAY }) })]), NOW)[0];
  assert.equal(lapsed.dismissed, false, "the newest chapter came after the dismiss");
});

test("an unreadable dismiss meta counts as none", () => {
  const d = data([node(1, { source: null, meta: [{ key: "miharchy.checkDismissed", value: "{oops" }] })]);
  assert.equal(L.problems(d, NOW)[0].dismissed, false);
});

test("dismissPayload writes each manga's kinds with the time, keeping the others; undo removes them", () => {
  const ps = L.problems(data([
    node(1, { source: null, chapters: { totalCount: 0 }, latestUploadedChapter: null, latestFetchedChapter: null, meta: dismissed({ stalled: 5 }) }),
    node(2, { source: null })
  ]), NOW);
  const p = L.dismissPayload(ps, NOW, false);
  assert.match(p.query, /setMangaMeta/);
  const metas = Object.values(p.variables);
  assert.deepEqual(metas.map((m) => [m.mangaId, m.key, JSON.parse(m.value)]), [
    [1, "miharchy.checkDismissed", { stalled: 5, missing: NOW, empty: NOW }],
    [2, "miharchy.checkDismissed", { missing: NOW }]
  ]);
  const undo = L.dismissPayload(ps.filter((x) => x.mangaId === 1 && x.kind === "missing"), NOW, true);
  assert.deepEqual(JSON.parse(Object.values(undo.variables)[0].value), { stalled: 5 });
  assert.equal(L.dismissPayload([], NOW, false), null);
});

test("rows group by kind in order, then by source, with counts; dismissed ones only when shown", () => {
  const ws = { id: "9", displayName: "Weeb Central", extension: null };
  const d = data([
    node(1, { title: "B", sourceId: "9", source: null }),
    node(2, { title: "A", sourceId: "7", source: null }),
    node(3, { title: "C", sourceId: "7", source: null }),
    node(4, { title: "D", chapters: { totalCount: 0 }, latestUploadedChapter: null, latestFetchedChapter: null, source: ws, sourceId: "9" }),
    node(5, { title: "E", sourceId: "9", source: null, meta: dismissed({ missing: 1 }) })
  ], { metas: { nodes: [{ value: JSON.stringify({ 7: "Asura Scans", 9: "Weeb Central" }) }] } });
  const ps = L.problems(d, NOW);
  const shape = (rows) => rows.map((r) => r.type === "group" ? r.label : "  " + r.title);
  assert.deepEqual(shape(L.rows(ps, false)), [
    "Source missing — Asura Scans (2)", "  A", "  C",
    "Source missing — Weeb Central (1)", "  B",
    "No chapters — Weeb Central (1)", "  D"
  ]);
  assert.deepEqual(shape(L.rows(ps, true)), ["Source missing — Weeb Central (1)", "  E"]);
  assert.equal(L.countText(0), "No problems");
  assert.equal(L.countText(1), "1 problem");
  assert.equal(L.countText(7), "7 problems");
});

test("space selects a row, or a whole group on its header; the selection names its manga", () => {
  const ps = L.problems(data([node(1, { source: null }), node(2, { source: null }), node(3, { chapters: { totalCount: 0 }, latestUploadedChapter: null, latestFetchedChapter: null })]), NOW);
  const rows = L.rows(ps, false);
  let sel = L.select({}, rows, 2);
  assert.deepEqual(L.selectedIds(sel, rows), [2]);
  sel = L.select(sel, rows, 0);
  assert.deepEqual(L.selectedIds(sel, rows), [1, 2], "the header selects the rest of its group");
  sel = L.select(sel, rows, 0);
  assert.deepEqual(L.selectedIds(sel, rows), [], "and deselects a fully selected group");
  sel = L.select(L.select({}, rows, 4), rows, 1);
  assert.deepEqual(L.targets(rows, sel, 0).map((p) => p.key), ["missing:1", "empty:3"], "x acts on the selection");
  assert.deepEqual(L.targets(rows, {}, 0).map((p) => p.key), ["missing:1", "missing:2"], "or on the group under the cursor");
  assert.deepEqual(L.targets(rows, {}, 4).map((p) => p.key), ["empty:3"], "or on the row");
});
