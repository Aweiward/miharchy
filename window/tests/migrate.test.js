const { test } = require("node:test");
const assert = require("node:assert/strict");
const Mi = require("./load")("Migrate.js");
const G = require("./load")("GlobalSearch.js");
const M = require("./load")("Model.js");

const config = { url: "http://127.0.0.1:4590", username: "u", password: "p" };
const ok = (data) => M.reply(200, JSON.stringify({ data }));
let nextId = 1;
const ch = (chapterNumber, o) => Object.assign({ id: nextId++, chapterNumber, isRead: false, isBookmarked: false, isDownloaded: false }, o);
const ids = (list) => list.map((c) => c.id);

test("every target chapter up to the highest read number is read, as in Mihon, even one the old source lacked", () => {
  const old = [ch(1, { isRead: true }), ch(2, { isRead: true }), ch(4, { isRead: true }), ch(5)];
  const target = [ch(1), ch(2), ch(3), ch(4), ch(5)];
  assert.deepEqual(Mi.plan(old, target).read, ids(target.slice(0, 4)));
});

test("decimal chapters match by number: 10.5 read reads 10.5 and below, not 11", () => {
  const old = [ch(10), ch(10.5, { isRead: true }), ch(11)];
  const target = [ch(10), ch(10.5), ch(11)];
  assert.deepEqual(Mi.plan(old, target).read, ids(target.slice(0, 2)));
});

test("a bookmark moves to the target chapter with the same number, and only there", () => {
  const old = [ch(3, { isBookmarked: true }), ch(7.5, { isBookmarked: true }), ch(9, { isBookmarked: true })];
  const target = [ch(3), ch(7), ch(7.5), ch(8)];
  assert.deepEqual(Mi.plan(old, target).bookmark, [target[0].id, target[2].id], "9 is missing on the target, so its bookmark has nowhere to go");
});

test("scanlator variants share a number: any bookmarked variant bookmarks every target chapter with it", () => {
  const old = [ch(5, { scanlator: "A" }), ch(5, { scanlator: "B", isBookmarked: true, isRead: true })];
  const target = [ch(5, { scanlator: "C" }), ch(5, { scanlator: "D" })];
  const p = Mi.plan(old, target);
  assert.deepEqual(p.bookmark, ids(target));
  assert.deepEqual(p.read, ids(target));
});

test("unknown numbers (-1) neither set the highest read nor take read state", () => {
  const old = [ch(-1, { isRead: true, isBookmarked: true }), ch(2, { isRead: true })];
  const target = [ch(-1), ch(1), ch(2), ch(3)];
  const p = Mi.plan(old, target);
  assert.deepEqual(p.read, [target[1].id, target[2].id]);
  assert.deepEqual(p.bookmark, []);
});

test("nothing read on the old manga reads nothing; what the target already has is left alone", () => {
  assert.deepEqual(Mi.plan([ch(1), ch(2)], [ch(1), ch(2)]), { read: [], bookmark: [] });
  const target = [ch(1, { isRead: true, isBookmarked: true }), ch(2)];
  assert.deepEqual(Mi.plan([ch(1, { isRead: true, isBookmarked: true }), ch(2, { isRead: true })], target), { read: [target[1].id], bookmark: [] });
});

test("the target write puts it in the library, replaces its categories with the old ones, marks chapters and keeps the reading mode", () => {
  const old = { id: 7, categories: { nodes: [{ id: 2 }, { id: 5 }] }, meta: [{ key: "miharchy.readingMode", value: "webtoon" }, { key: "other", value: "x" }] };
  const p = Mi.targetPayload(old, 40, { read: [1, 2], bookmark: [2] });
  assert.deepEqual(p.variables, { target: 40, categories: [2, 5], read: [1, 2], bookmark: [2], mode: { mangaId: 40, key: "miharchy.readingMode", value: "webtoon" } });
  assert.ok(p.query.indexOf("inLibrary: true") < p.query.indexOf("clearCategories: true"), "in the library before categories, so Suwayomi's default categories are cleared too");
  const plain = Mi.targetPayload({ id: 7, categories: { nodes: [] }, meta: [] }, 40, { read: [], bookmark: [] });
  assert.equal(plain.variables.mode, undefined);
  assert.doesNotMatch(plain.query, /setMangaMeta/);
});

test("Migrate takes the old manga out of the library, Copy keeps it; deleting downloads names the downloaded chapters", () => {
  const old = { id: 7, chapters: { nodes: [ch(1, { isDownloaded: true }), ch(2), ch(3, { isDownloaded: true })] } };
  const both = Mi.oldPayload(old, true, true);
  assert.equal(both.variables.id, 7);
  assert.deepEqual(both.variables.downloads, ids(old.chapters.nodes.filter((c) => c.isDownloaded)));
  assert.match(both.query, /inLibrary: false/);
  assert.doesNotMatch(Mi.oldPayload(old, false, true).query, /updateManga/);
  assert.doesNotMatch(Mi.oldPayload(old, true, false).query, /deleteDownloaded/);
  assert.equal(Mi.oldPayload(old, false, false), null, "a copy that keeps downloads leaves the old manga untouched");
  assert.equal(Mi.oldPayload({ id: 7, chapters: { nodes: [ch(1)] } }, false, true), null);
});

test("similarity is Mihon's normalized Levenshtein: 1 for equal titles, lower as they differ", () => {
  assert.equal(Mi.similarity("Berserk", "Berserk"), 1);
  assert.equal(Mi.similarity("", ""), 1);
  assert.equal(Mi.similarity("abcd", "abxd"), 0.75);
});

test("the proposed match is the most similar result at 0.4 or above, or none; a lone result counts as a match", () => {
  const items = [{ title: "Chainsaw Man (Color)" }, { title: "Chainsaw Man" }, { title: "Before Chainsaw Man" }];
  assert.equal(Mi.propose("Chainsaw Man", items), 1);
  assert.equal(Mi.propose("Chainsaw Man", [{ title: "zzzzzzzzzzzzzzzzzzzzzzzz" }, { title: "qqqqqqqqqqqqqqqqqqqq" }]), -1);
  assert.equal(Mi.propose("Chainsaw Man", [{ title: "Something else entirely" }]), 0);
  assert.equal(Mi.propose("Chainsaw Man", []), -1);
  assert.equal(Mi.propose("abcde", [{ title: "zzzzzzzzzz" }, { title: "abxyz" }]), 1, "exactly 0.4 is a match");
});

const sources = [
  { id: "1", name: "Asura Scans (EN)" },
  { id: "2", name: "Mangago (EN)" },
  { id: "3", name: "Weeb Central (EN)" },
  { id: "4", name: "AsuraScans (EN)" }
];

test("targets leave out the old source and put a source named like it first", () => {
  assert.deepEqual(Mi.targets(sources, "99", "Asura Scans").map((s) => s.id), ["1", "4", "2", "3"]);
  assert.deepEqual(Mi.targets(sources, "1", "Asura Scans (EN)").map((s) => s.id), ["4", "2", "3"]);
  assert.deepEqual(Mi.targets(sources, "99", "").map((s) => s.id), ["1", "2", "3", "4"]);
});

test("library sources group the library by source, name missing ones from the sync meta, and count their manga", () => {
  const data = {
    mangas: { nodes: [
      { id: 1, title: "B", sourceId: "10", source: { displayName: "Weeb Central (EN)" } },
      { id: 2, title: "A", sourceId: "20", source: null },
      { id: 3, title: "C", sourceId: "10", source: { displayName: "Weeb Central (EN)" } },
      { id: 4, title: "D", sourceId: "30", source: null }
    ] },
    metas: { nodes: [{ value: JSON.stringify({ 20: "Asura Scans" }) }] }
  };
  const list = Mi.librarySources(data);
  assert.deepEqual(list.map((s) => [s.id, s.name, s.missing, s.manga.map((m) => m.id)]), [
    ["20", "Asura Scans (not installed)", true, [2]],
    ["30", "Unknown source 30", true, [4]],
    ["10", "Weeb Central (EN)", false, [1, 3]]
  ]);
  assert.equal(list[0].sourceName, "Asura Scans");
});

test("a batch searches the target source once per manga, one at a time like Mihon, and proposes each match", () => {
  const target = { id: "8", name: "MangaPill (EN)", supportsLatest: true };
  let b = Mi.batch(target, [{ id: 1, title: "Chainsaw Man" }, { id: 2, title: "Berserk" }]);
  assert.deepEqual(b.search.groups.map((g) => G.payload(g).variables), [
    { source: "8", type: "SEARCH", page: 1, query: "Chainsaw Man" },
    { source: "8", type: "SEARCH", page: 1, query: "Berserk" }
  ]);
  assert.deepEqual(Mi.due(b), [0]);
  b = Mi.reduceBatch(b, 0, { type: "request" });
  assert.deepEqual(Mi.due(b), [], "one search at a time against one source");
  const reply = ok({ fetchSourceManga: { hasNextPage: false, mangas: [{ id: 11, title: "Chainsaw Man (Color)" }, { id: 12, title: "Chainsaw Man" }] } });
  b = Mi.reduceBatch(b, 0, { type: "reply", reply, config });
  assert.equal(b.picks[0], 1);
  assert.equal(Mi.chosen(b, 0).id, 12);
  assert.deepEqual(Mi.due(b), [1]);
});

test("in a batch, h/l pick another result or skip, and only picked rows migrate", () => {
  const target = { id: "8", name: "S", supportsLatest: true };
  let b = Mi.batch(target, [{ id: 1, title: "X" }, { id: 2, title: "Y" }]);
  b = Mi.reduceBatch(Mi.reduceBatch(b, 0, { type: "request" }), 0, { type: "reply", reply: ok({ fetchSourceManga: { hasNextPage: false, mangas: [{ id: 11, title: "X" }, { id: 12, title: "X2" }] } }), config });
  b = Mi.pick(b, 0, 1);
  assert.equal(Mi.chosen(b, 0).id, 12);
  b = Mi.pick(b, 0, 1);
  assert.equal(Mi.chosen(b, 0), null, "past the last result is skip");
  b = Mi.pick(b, 0, -1);
  assert.equal(Mi.chosen(b, 0).id, 12);
  assert.deepEqual(Mi.jobs(b).map((j) => [j.old.id, j.target.id]), [[1, 12]], "the row still searching has nothing to migrate");
});
