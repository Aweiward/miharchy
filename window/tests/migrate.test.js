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

test("a merge keeps the higher read state on both sides: the kept copy's own read chapters never go down", () => {
  const other = [ch(1, { isRead: true }), ch(2, { isRead: true }), ch(3, { isRead: true }), ch(4), ch(5)];
  const ahead = [ch(1), ch(2), ch(3), ch(4), ch(5, { isRead: true })];
  const p = Mi.plan(other, ahead);
  assert.deepEqual(p.read, ids(ahead.slice(0, 3)), "the other copy's 1 to 3 are added; the kept copy's 5 is not touched");
  assert.doesNotMatch(Mi.targetPayload({ id: 7, categories: { nodes: [] }, meta: [] }, 40, p, false, { meta: [] }).query, /isRead: false/, "nothing is ever marked unread");
  const behind = [ch(1, { isRead: true }), ch(2), ch(3), ch(4), ch(5)];
  assert.deepEqual(Mi.plan(other, behind).read, ids(behind.slice(1, 3)), "a kept copy behind the other catches up to 3");
});

test("a merge adds the other copy's categories to the kept copy's own: no clear, so the result is the union", () => {
  const old = { id: 7, categories: { nodes: [{ id: 2 }] }, meta: [] };
  const merge = Mi.targetPayload(old, 40, { read: [], bookmark: [] }, false, { meta: [], trackRecords: { nodes: [] } });
  assert.doesNotMatch(merge.query, /clearCategories/);
  assert.match(merge.query, /addToCategories: \$categories/);
  assert.deepEqual(merge.variables.categories, [2]);
  assert.match(Mi.targetPayload(old, 40, { read: [], bookmark: [] }, false).query, /clearCategories: true/, "plain Migrate still sets exactly the old categories");
});

test("a target already in the library merges whatever the entry path: it keeps its categories, mode and tracks; a new target takes exactly the old ones", () => {
  const old = { id: 7, categories: { nodes: [{ id: 3 }] }, meta: [{ key: "miharchy.readingMode", value: "webtoon" }], trackRecords: { nodes: [] } };
  const fetched = (inLibrary) => ok({ fetchMangaAndChapters: { manga: { id: 40, title: "E", inLibrary, meta: [{ key: "miharchy.readingMode", value: "pager" }], trackRecords: { nodes: [] } }, chapters: [] } });
  assert.match(Mi.TARGET_MUTATION, /manga \{ id title inLibrary meta \{ key value \} trackRecords/);
  const inLib = Mi.targetPayload(old, 40, { read: [], bookmark: [] }, true, Mi.mergeInto(fetched(true).data.fetchMangaAndChapters.manga));
  assert.doesNotMatch(inLib.query, /clearCategories/, "its own categories stay, the old ones are added");
  assert.deepEqual(inLib.variables.categories, [3]);
  assert.doesNotMatch(inLib.query, /setMangaMeta/, "its own reading mode stays");
  assert.equal(Mi.mergeInto(fetched(false).data.fetchMangaAndChapters.manga), null);
  const fresh = Mi.targetPayload(old, 40, { read: [], bookmark: [] }, true, null);
  assert.match(fresh.query, /clearCategories: true/);
  assert.equal(fresh.variables.mode.value, "webtoon");
});

test("a merge keeps the kept copy's reading mode and tracks; the other's fill only what it lacks", () => {
  const mode = (value) => [{ key: "miharchy.readingMode", value }];
  const track = (id, name) => ({ id, trackerId: id, tracker: { name } });
  const old = { id: 7, categories: { nodes: [] }, meta: mode("webtoon"), trackRecords: { nodes: [track(11, "AniList"), track(12, "MyAnimeList")] } };
  const kept = { meta: mode("pager"), trackRecords: { nodes: [{ tracker: { name: "AniList" } }] } };
  assert.deepEqual(Mi.movingTracks(old, kept), [{ id: 12, tracker: "MyAnimeList" }]);
  const p = Mi.targetPayload(old, 40, { read: [], bookmark: [] }, true, kept);
  assert.doesNotMatch(p.query, /setMangaMeta/, "the kept copy's own mode stays");
  assert.equal(p.variables.track0, 12);
  assert.equal(p.variables.track1, undefined, "AniList is already tracked on the kept copy");
  const bare = Mi.targetPayload(old, 40, { read: [], bookmark: [] }, true, { meta: [], trackRecords: { nodes: [] } });
  assert.equal(bare.variables.mode.value, "webtoon", "a kept copy with no mode takes the other's");
  assert.deepEqual([bare.variables.track0, bare.variables.track1], [11, 12]);
  assert.deepEqual(Mi.movingTracks(old, null).map((t) => t.id), [11, 12], "plain Migrate takes every track");
});

test("the old manga's tracks go to the target in the same write, unless left out", () => {
  const old = { id: 7, categories: { nodes: [] }, meta: [], trackRecords: { nodes: [{ id: 11, trackerId: 2, tracker: { name: "AniList" } }, { id: 12, trackerId: 1, tracker: { name: "MyAnimeList" } }] } };
  assert.deepEqual(Mi.trackRecords(old), [{ id: 11, tracker: "AniList" }, { id: 12, tracker: "MyAnimeList" }]);
  const p = Mi.targetPayload(old, 40, { read: [], bookmark: [] }, true);
  assert.equal(p.variables.track0, 11);
  assert.equal(p.variables.track1, 12);
  assert.match(p.query, /track0: bindTrackRecord\(input: \{ mangaId: \$target, trackRecordId: \$track0 \}\)/);
  assert.match(p.query, /\$track1: Int!/);
  assert.ok(p.query.indexOf("inLibrary: true") < p.query.indexOf("bindTrackRecord"), "one write: the old manga leaves only after it all succeeds");
  assert.doesNotMatch(p.query, /bindTrack\(/, "never bindTrack, which calls the tracker");
  const without = Mi.targetPayload(old, 40, { read: [], bookmark: [] }, false);
  assert.doesNotMatch(without.query, /bindTrackRecord/);
  assert.equal(without.variables.track0, undefined);
  assert.deepEqual(Mi.trackRecords({ id: 7 }), [], "a manga read before tracks were asked for has none");
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

test("pinned sources follow the same-named one, in pin order; the old source never shows", () => {
  assert.deepEqual(Mi.targets(sources, "99", "Asura Scans", ["3", "2"]).map((s) => s.id), ["1", "4", "3", "2"]);
  assert.deepEqual(Mi.targets(sources, "3", "Weeb Central", ["3", "2", "77"]).map((s) => s.id), ["2", "1", "4"], "the old source stays out though pinned; an unknown pin is ignored");
});

test("a batch searches each manga's same-named source, then its pinned ones; none of either falls back to one picked source", () => {
  const manga = [
    { id: 1, title: "Eleceed", sourceId: "1", sourceName: "Asura Scans" },
    { id: 2, title: "Berserk", sourceId: "3", sourceName: "Weeb Central" }
  ];
  const each = Mi.withTargets(manga, sources, ["2", "3"]);
  assert.deepEqual(each.map((m) => m.targets.map((s) => s.id)), [["4", "2", "3"], ["2"]]);
  assert.equal(Mi.withTargets(manga.slice(1), sources, []), null, "nothing pinned, no same-named source");
  const langs = [{ id: "en", name: "MangaDex (EN)", lang: "en" }, { id: "fr", name: "MangaDex (FR)", lang: "fr" }];
  assert.equal(Mi.withTargets([{ id: 3, title: "Eleceed", sourceId: "en", sourceName: "MangaDex (EN)" }], langs, []), null, "an installed source's other languages are not the same source");
  const one = Mi.withTarget(manga, sources[2]);
  assert.deepEqual(one.map((m) => m.targets.map((s) => s.id)), [["3"], []], "the picked source, never a manga's own");
});

const reply = (...titles) => ok({ fetchSourceManga: { hasNextPage: false, mangas: titles.map((title, i) => ({ id: 100 + i, title })) } });
const answer = (b, i, r) => {
  const sent = Mi.reduceBatch(b, i, { type: "request", now: 0 });
  return Mi.reduceBatch(sent, i, { type: "reply", attempt: sent.search.groups[i].attempt, reply: r, config });
};

test("each manga searches its sources one at a time and stops at the first match", () => {
  let b = Mi.batch([{ id: 1, title: "Eleceed", targets: [sources[1], sources[2], sources[3]] }, { id: 2, title: "Berserk", targets: [sources[2]] }]);
  assert.deepEqual(Mi.due(b), [0]);
  b = answer(b, 0, reply("zzzzzzzzzzzz", "qqqqqqqqqqqqq"));
  assert.equal(Mi.chosen(b, 0), null);
  assert.deepEqual(Mi.due(b), [0], "no match: the same row searches its next source");
  assert.equal(G.payload(b.search.groups[0]).variables.source, "3");
  b = answer(b, 0, reply("Eleceed"));
  assert.equal(Mi.chosen(b, 0).id, 100);
  assert.deepEqual(Mi.due(b), [1], "a match stops that manga's search: source 4 is never searched");
  assert.deepEqual(Mi.jobs(b).map((j) => [j.old.id, j.target.id, j.target.source]), [[1, 100, "Weeb Central (EN)"]]);
  assert.match(Mi.matchStatus(b, 0, "/c"), /^Eleceed   1 of 1   Weeb Central \(EN\)$/);
});

test("a failed search moves on to the next source; the last one's failure stays for r", () => {
  let b = Mi.batch([{ id: 1, title: "Eleceed", targets: [sources[1], sources[2]] }]);
  b = answer(b, 0, M.reply(500, "boom"));
  assert.equal(G.payload(b.search.groups[0]).variables.source, "3");
  b = answer(b, 0, M.reply(500, "boom"));
  assert.notEqual(b.search.groups[0].state, "ok");
  assert.deepEqual(Mi.due(b), []);
});

test("a late reply to a timed-out search never answers the next source's search", () => {
  let b = Mi.batch([{ id: 1, title: "Eleceed", targets: [sources[1], sources[2]] }]);
  b = Mi.reduceBatch(Mi.reduceBatch(b, 0, { type: "request", now: 0 }), 0, { type: "timeout" });
  b = Mi.reduceBatch(b, 0, { type: "request", now: 0 });
  const after = Mi.reduceBatch(b, 0, { type: "reply", attempt: 1, reply: M.reply(0, ""), config });
  assert.equal(after, b, "the first search's attempt is dropped");
  assert.equal(after.search.groups[0].state, "loading");
});

test("a stalled manga takes a match only when its newest chapter number is higher", () => {
  let b = Mi.batch([{ id: 1, title: "Eleceed", stalled: true, highest: 300, targets: [sources[1], sources[2]] }, { id: 2, title: "X", targets: [sources[2]] }]);
  b = answer(b, 0, reply("Eleceed"));
  assert.equal(Mi.chosen(b, 0), null, "held until its chapters are read");
  assert.deepEqual(Mi.checks(b), [0]);
  assert.deepEqual(Mi.checkPayload(b, 0).variables, { id: 100 });
  b = Mi.reduceBatch(b, 0, { type: "check" });
  assert.deepEqual(Mi.due(b), [], "one request at a time");
  assert.deepEqual(Mi.checks(b), []);
  const chapters = (...n) => ok({ fetchMangaAndChapters: { manga: { id: 100 }, chapters: n.map((c) => ch(c)) } });
  b = Mi.reduceBatch(b, 0, { type: "checked", reply: chapters(1, 300, -1) });
  assert.equal(Mi.chosen(b, 0), null);
  assert.equal(G.payload(b.search.groups[0]).variables.source, "3", "not more chapters: on to the next source");
  b = answer(b, 0, reply("Eleceed"));
  b = Mi.reduceBatch(Mi.reduceBatch(b, 0, { type: "check" }), 0, { type: "checked", reply: chapters(300, 301.5) });
  assert.equal(Mi.chosen(b, 0).id, 100);
  assert.equal(Mi.jobs(b)[0].target.source, "Weeb Central (EN)");
});

test("a stalled manga's highest chapter number comes from the server; one with no chapters has none", () => {
  const data = { mangas: { nodes: [{ id: 1, highestNumberedChapter: { chapterNumber: 120.5 } }, { id: 2, highestNumberedChapter: null }] } };
  assert.deepEqual(Mi.withHighest([{ id: 2 }, { id: 1 }], data).map((m) => m.highest), [-1, 120.5]);
});

test("a stalled manga no source has more chapters for says so", () => {
  let b = Mi.batch([{ id: 1, title: "Eleceed", stalled: true, highest: 300, targets: [sources[1]] }]);
  b = answer(b, 0, reply("Eleceed"));
  b = Mi.reduceBatch(Mi.reduceBatch(b, 0, { type: "check" }), 0, { type: "checked", reply: ok({ fetchMangaAndChapters: { manga: { id: 100 }, chapters: [ch(300)] } }) });
  assert.equal(Mi.chosen(b, 0), null);
  assert.equal(Mi.matchStatus(b, 0, "/c"), "No source has more chapters.");
  assert.deepEqual(Mi.jobs(b), []);
});

test("a failed chapter check on the last source waits for r, not a verdict", () => {
  let b = Mi.batch([{ id: 1, title: "Eleceed", stalled: true, highest: 300, targets: [sources[1]] }]);
  b = answer(b, 0, reply("Eleceed"));
  b = Mi.reduceBatch(Mi.reduceBatch(b, 0, { type: "check" }), 0, { type: "checked", reply: M.reply(500, "boom") });
  assert.equal(Mi.matchStatus(b, 0, "/c"), "chapter check failed. Press r to retry.   Mangago (EN)");
  assert.deepEqual(Mi.checks(b), []);
  assert.deepEqual(Mi.checks(Mi.retry(b)), [0]);
});

test("a chapter check times out as a search does: on to the next source, or on the last one wait for r", () => {
  let b = Mi.batch([{ id: 1, title: "Eleceed", stalled: true, highest: 300, targets: [sources[1], sources[2]] }]);
  b = answer(b, 0, reply("Eleceed"));
  b = Mi.reduceBatch(b, 0, { type: "check", now: 1000 });
  assert.deepEqual(Mi.expired(b, 1000 + G.TIMEOUT - 1), []);
  assert.deepEqual(Mi.expired(b, 1000 + G.TIMEOUT), [0]);
  b = Mi.reduceBatch(b, 0, { type: "timeout" });
  assert.equal(G.payload(b.search.groups[0]).variables.source, "3", "on to the next source");
  assert.deepEqual(Mi.due(b), [0]);
  b = answer(b, 0, reply("Eleceed"));
  b = Mi.reduceBatch(Mi.reduceBatch(b, 0, { type: "check", now: 0 }), 0, { type: "timeout" });
  assert.match(Mi.matchStatus(b, 0, "/c"), /^chapter check failed\. Press r to retry\./);
  assert.equal(Mi.reduceBatch(b, 0, { type: "checked", reply: ok({ fetchMangaAndChapters: { chapters: [ch(400)] } }) }), b, "a late reply drops");
  assert.deepEqual(Mi.checks(Mi.retry(b)), [0]);
});

test("a manga with no source to search says so and migrates nothing", () => {
  const b = Mi.batch([{ id: 1, title: "Eleceed", targets: [] }]);
  assert.deepEqual(Mi.due(b), []);
  assert.equal(Mi.matchStatus(b, 0, "/c"), "No source to search");
  assert.deepEqual(Mi.jobs(b), []);
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
  let b = Mi.batch([{ id: 1, title: "Chainsaw Man", targets: [target] }, { id: 2, title: "Berserk", targets: [target] }]);
  assert.deepEqual(b.search.groups.map((g) => G.payload(g).variables), [
    { source: "8", type: "SEARCH", page: 1, query: "Chainsaw Man", filters: [] },
    { source: "8", type: "SEARCH", page: 1, query: "Berserk", filters: [] }
  ]);
  assert.deepEqual(Mi.due(b), [0]);
  b = Mi.reduceBatch(b, 0, { type: "request", now: 0 });
  assert.deepEqual(Mi.due(b), [], "one search at a time against one source");
  const reply = ok({ fetchSourceManga: { hasNextPage: false, mangas: [{ id: 11, title: "Chainsaw Man (Color)" }, { id: 12, title: "Chainsaw Man" }] } });
  b = Mi.reduceBatch(b, 0, { type: "reply", attempt: 1, reply, config });
  assert.equal(b.picks[0], 1);
  assert.equal(Mi.chosen(b, 0).id, 12);
  assert.deepEqual(Mi.due(b), [1]);
});

test("in a batch, h/l pick another result or skip, and only picked rows migrate", () => {
  const target = { id: "8", name: "S", supportsLatest: true };
  let b = Mi.batch([{ id: 1, title: "X", targets: [target] }, { id: 2, title: "Y", targets: [target] }]);
  b = Mi.reduceBatch(Mi.reduceBatch(b, 0, { type: "request", now: 0 }), 0, { type: "reply", attempt: 1, reply: ok({ fetchSourceManga: { hasNextPage: false, mangas: [{ id: 11, title: "X" }, { id: 12, title: "X2" }] } }), config });
  b = Mi.pick(b, 0, 1);
  assert.equal(Mi.chosen(b, 0).id, 12);
  assert.equal(Mi.reduceBatch(b, 0, { type: "reply", attempt: 1, reply: ok({ fetchSourceManga: { hasNextPage: false, mangas: [] } }), config }), b, "a dropped reply keeps the pick");
  assert.equal(Mi.matchStatus(b, 0, "/c"), "X2   2 of 2   S");
  b = Mi.pick(b, 0, 1);
  assert.equal(Mi.chosen(b, 0), null, "past the last result is skip");
  assert.equal(Mi.matchStatus(b, 0, "/c"), "skip   2 results   S");
  assert.equal(Mi.matchStatus(b, 1, "/c"), "waiting   S");
  b = Mi.pick(b, 0, -1);
  assert.equal(Mi.chosen(b, 0).id, 12);
  assert.deepEqual(Mi.jobs(b).map((j) => [j.old.id, j.target.id]), [[1, 12]], "the row still searching has nothing to migrate");
});
