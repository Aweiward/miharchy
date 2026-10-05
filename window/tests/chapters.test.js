const { test } = require("node:test");
const assert = require("node:assert/strict");
const Ch = require("./load")("Chapters.js");

// Newest first, as Browse.detail holds them.
const chapters = [
  { id: 14, read: false, lastPage: 0 },
  { id: 13, read: false, lastPage: 6 },
  { id: 12, read: true, lastPage: 0 },
  { id: 11, read: true, lastPage: 19 }
];

test("marking read sends isRead to the unread chapters only, and leaves lastPageRead alone", () => {
  const p = Ch.markPayload(chapters, true);
  assert.match(p.query, /updateChapters/);
  assert.deepEqual(p.variables, { ids: [14, 13], started: [], read: true });
});

test("marking unread sends isRead false and resets lastPageRead only where a page was read", () => {
  const p = Ch.markPayload(chapters, false);
  assert.match(p.query, /ids: \$started, patch: \{ isRead: false, lastPageRead: 0 \}/);
  assert.deepEqual(p.variables, { ids: [12], started: [13, 11], read: false }, "a started unread chapter goes back to page 1, as in Mihon");
});

test("nothing to change sends nothing", () => {
  assert.equal(Ch.markPayload([chapters[2], chapters[3]], true), null);
  assert.equal(Ch.markPayload([chapters[0]], false), null);
  assert.equal(Ch.markPayload([], true), null);
});

test("the tracker push asks for each manga's progress once", () => {
  const one = Ch.trackPayload([5]);
  assert.match(one.query, /trackProgress\(input: \{ mangaId: 5 \}\)/);
  const two = Ch.trackPayload([5, 9, 5]);
  assert.equal(two.query.match(/trackProgress/g).length, 2);
  assert.match(two.query, /m9: trackProgress\(input: \{ mangaId: 9 \}\)/);
  assert.equal(Ch.trackPayload([]), null, "no manga, no empty mutation");
});

test("a manual mark read pushes, asks or leaves the trackers, by the setting", () => {
  assert.equal(Ch.afterMarkRead("always"), "push");
  assert.equal(Ch.afterMarkRead("ask"), "check");
  assert.equal(Ch.afterMarkRead("never"), null);
});

test("ask only when a logged-in tracker is behind the highest read chapter", () => {
  const p = Ch.trackCheckPayload([5, 9, 5]);
  assert.equal(p.query.match(/manga\(id: /g).length, 2, "each manga once");
  assert.match(p.query, /r9: chapters\(condition: \{ mangaId: 9, isRead: true \}, order: \[\{ by: CHAPTER_NUMBER, byType: DESC \}\], first: 1\)/);
  assert.equal(Ch.trackCheckPayload([]), null);

  const track = (read, on) => ({ lastChapterRead: read, tracker: { isLoggedIn: on } });
  const manga = (id, tracks) => ({ id, trackRecords: { nodes: tracks } });
  const top = (n) => ({ nodes: n === null ? [] : [{ chapterNumber: n }] });
  const data = {
    m5: manga(5, [track(12, true), track(3, false)]), r5: top(14),
    m9: manga(9, [track(20, true)]), r9: top(14)
  };
  const ask = Ch.trackAsk(data);
  assert.deepEqual(ask, { mangaIds: [5], chapter: 14 });
  assert.equal(Ch.trackAskText(ask), "Update trackers to chapter 14?");
  assert.equal(Ch.trackAsk({ m9: data.m9, r9: data.r9 }), null, "the tracker is already there");
  assert.equal(Ch.trackAsk({ m5: manga(5, [track(1, false)]), r5: top(14) }), null, "a logged-out tracker is never asked about");
  assert.equal(Ch.trackAsk({ m5: manga(5, []), r5: top(14) }), null, "no tracks");
  assert.equal(Ch.trackAsk({ m5: manga(5, [track(0, true)]), r5: top(null) }), null, "nothing read");
  const many = Ch.trackAsk({ m5: data.m5, r5: data.r5, m7: manga(7, [track(0, true)]), r7: top(2.5) });
  assert.deepEqual(many, { mangaIds: [5, 7], chapter: null });
  assert.equal(Ch.trackAskText(many), "Update trackers for 2 manga?");
});

const P = require("./load")("Prefs.js");

// Newest first by source order; numbers and dates out of step with it, as
// a source that posts extras or reuploads makes them.
const list = [
  { id: 4, sourceOrder: 4, number: 3, uploadDate: 400, read: false, lastPage: 0, downloaded: false, bookmarked: false },
  { id: 3, sourceOrder: 3, number: 2.5, uploadDate: 100, read: false, lastPage: 7, downloaded: true, bookmarked: true },
  { id: 2, sourceOrder: 2, number: 2, uploadDate: 300, read: true, lastPage: 0, downloaded: true, bookmarked: false },
  { id: 1, sourceOrder: 1, number: 1, uploadDate: 300, read: true, lastPage: 0, downloaded: false, bookmarked: true }
];
const prefs = (changes) => Object.assign(P.defaults(Ch.PREFS), changes);
const ids = (cs) => cs.map((c) => c.id);

test("the default list is source order, newest first, with nothing hidden", () => {
  assert.deepEqual(ids(Ch.apply(list, prefs())), [4, 3, 2, 1]);
  assert.deepEqual(ids(Ch.apply(list.slice().reverse(), prefs())), [4, 3, 2, 1]);
});

test("each filter is off, keeps only matching chapters, or drops them", () => {
  assert.deepEqual(ids(Ch.apply(list, prefs({ chapterFilterUnread: "include" }))), [4, 3]);
  assert.deepEqual(ids(Ch.apply(list, prefs({ chapterFilterUnread: "exclude" }))), [2, 1]);
  assert.deepEqual(ids(Ch.apply(list, prefs({ chapterFilterDownloaded: "include" }))), [3, 2]);
  assert.deepEqual(ids(Ch.apply(list, prefs({ chapterFilterBookmarked: "exclude" }))), [4, 2]);
  assert.deepEqual(ids(Ch.apply(list, prefs({ chapterFilterBookmarked: "include", chapterFilterUnread: "include" }))), [3]);
});

test("sorts by number or upload date, newest first when descending, source order breaking ties", () => {
  assert.deepEqual(ids(Ch.apply(list, prefs({ chapterSort: "number" }))), [4, 3, 2, 1]);
  assert.deepEqual(ids(Ch.apply(list, prefs({ chapterSort: "uploadDate" }))), [4, 2, 1, 3]);
  assert.deepEqual(ids(Ch.apply(list, prefs({ chapterSort: "uploadDate", chapterSortDirection: "asc" }))), [3, 1, 2, 4]);
  assert.deepEqual(ids(Ch.apply(list, prefs({ chapterSortDirection: "asc" }))), [1, 2, 3, 4]);
});

test("apply never reorders the chapters it is given, which the reader reads in source order", () => {
  const before = ids(list);
  Ch.apply(list, prefs({ chapterSort: "uploadDate", chapterSortDirection: "asc" }));
  assert.deepEqual(ids(list), before);
});

test("choosing a filter row moves it to the next state; a new sort starts ascending, the same sort flips (Mihon)", () => {
  const rows = Ch.rows(prefs(), []);
  const row = (id) => rows.find((r) => r.id === id);
  assert.deepEqual(rows.map((r) => r.kind), ["filter", "filter", "filter", "sort", "sort", "sort", "default", "default"]);
  assert.equal(row("source").state, "desc");
  assert.equal(row("number").state, "");
  assert.deepEqual(Ch.choose(prefs(), row("unread")), [{ key: "chapterFilterUnread", value: "include" }]);
  const excluded = prefs({ chapterFilterUnread: "exclude" });
  assert.deepEqual(Ch.choose(excluded, Ch.rows(excluded, []).find((r) => r.id === "unread")), [{ key: "chapterFilterUnread", value: "off" }]);
  assert.deepEqual(Ch.choose(prefs(), row("number")), [{ key: "chapterSort", value: "number" }, { key: "chapterSortDirection", value: "asc" }]);
  assert.deepEqual(Ch.choose(prefs(), row("source")), [{ key: "chapterSortDirection", value: "asc" }]);
  assert.deepEqual(Ch.choose(prefs(), row("default")), []);
});

test("mark previous takes the chapters before the cursor in reading order, from the list as shown", () => {
  const desc = Ch.apply(list, prefs({ chapterFilterBookmarked: "exclude" }));
  assert.deepEqual(ids(Ch.previous(desc, 0, prefs())), [2], "the filtered-out chapter 1 stays unread");
  const asc = prefs({ chapterSortDirection: "asc" });
  assert.deepEqual(ids(Ch.previous(Ch.apply(list, asc), 2, asc)), [1, 2]);
  assert.deepEqual(Ch.previous(Ch.apply(list, asc), 0, asc), []);
});

test("the next chapter is the first unread one in reading order among those shown (Mihon's getNextUnread)", () => {
  assert.equal(Ch.nextUnread(Ch.apply(list, prefs()), prefs()).id, 3);
  const asc = prefs({ chapterSortDirection: "asc" });
  assert.equal(Ch.nextUnread(Ch.apply(list, asc), asc).id, 3);
  const noBookmarks = prefs({ chapterFilterBookmarked: "exclude" });
  assert.equal(Ch.nextUnread(Ch.apply(list, noBookmarks), noBookmarks).id, 4);
  assert.equal(Ch.nextUnread(Ch.apply(list, prefs({ chapterFilterUnread: "exclude" })), prefs()), null);
});

test("the resume label says Start until any chapter is read, then names the next chapter", () => {
  const unread = list.map((c) => Object.assign({}, c, { read: false }));
  assert.equal(Ch.resumeLabel(unread, unread[3]), "Start");
  assert.equal(Ch.resumeLabel(list, list[1]), "Resume chapter 2.5");
  assert.equal(Ch.resumeLabel(list, Object.assign({}, list[0], { number: -1, name: "Extra" })), "Resume Extra");
  assert.equal(Ch.resumeLabel(list, null), "");
});

test("a bookmark sets every chapter when any is unset, else clears them all, and skips those already there", () => {
  const on = Ch.bookmarkPayload([list[0], list[1]]);
  assert.match(on.query, /updateChapters\(input: \{ ids: \$ids, patch: \{ isBookmarked: \$bookmarked \} \}\)/);
  assert.deepEqual(on.variables, { ids: [4], bookmarked: true });
  assert.deepEqual(Ch.bookmarkPayload([list[1], list[3]]).variables, { ids: [3, 1], bookmarked: false });
  assert.equal(Ch.bookmarkPayload([]), null);
});

const noSkip = { read: false, filtered: false, dupe: false };

test("the reader reads in the manga's chosen sort, oldest first, like Mihon", () => {
  // The reader reverses its input, so readingOrder hands it newest first.
  assert.deepEqual(ids(Ch.readingOrder(list, prefs({ chapterFilterUnread: "include" }), 4, noSkip)), [4, 3, 2, 1], "without skip filtered, filters hide nothing");
  assert.deepEqual(ids(Ch.readingOrder(list, prefs({ chapterSort: "uploadDate", chapterSortDirection: "asc" }), 4, noSkip)), [4, 2, 1, 3], "upload date, ties on source order");
  assert.deepEqual(ids(Ch.readingOrder(list, prefs({ chapterSort: "uploadDate", chapterSortDirection: "desc" }), 4, noSkip)), [4, 2, 1, 3], "the list's direction does not change the reading order");
});

test("skip read drops read chapters, but never the chapter opened", () => {
  const skip = { read: true, filtered: false, dupe: false };
  assert.deepEqual(ids(Ch.readingOrder(list, prefs(), 3, skip)), [4, 3]);
  assert.deepEqual(ids(Ch.readingOrder(list, prefs(), 1, skip)), [4, 3, 1], "a read chapter opened stays, and the next one is the next unread");
});

test("skip filtered drops what the manga's chapter filter hides, but never the chapter opened", () => {
  const skip = { read: false, filtered: true, dupe: false };
  assert.deepEqual(ids(Ch.readingOrder(list, prefs({ chapterFilterDownloaded: "include" }), 3, skip)), [3, 2]);
  assert.deepEqual(ids(Ch.readingOrder(list, prefs({ chapterFilterBookmarked: "exclude" }), 1, skip)), [4, 2, 1]);
  assert.deepEqual(ids(Ch.readingOrder(list, prefs(), 1, skip)), [4, 3, 2, 1], "no filter on drops nothing");
});

test("skip duplicates keeps one chapter per number: the one opened, else its scanlator's, else the first", () => {
  const dupes = [
    { id: 25, sourceOrder: 5, number: 2, scanlator: "B" },
    { id: 24, sourceOrder: 4, number: 2, scanlator: "A" },
    { id: 23, sourceOrder: 3, number: 1, scanlator: "C" },
    { id: 22, sourceOrder: 2, number: 1, scanlator: "B" },
    { id: 21, sourceOrder: 1, number: 1, scanlator: "A" }
  ];
  const skip = { read: false, filtered: false, dupe: true };
  assert.deepEqual(ids(Ch.readingOrder(dupes, prefs(), 21, skip)), [24, 21], "scanlator A throughout");
  assert.deepEqual(ids(Ch.readingOrder(dupes, prefs(), 22, skip)), [25, 22], "scanlator B throughout");
  assert.deepEqual(ids(Ch.readingOrder(dupes, prefs(), 23, skip)), [24, 23], "no C for chapter 2: the first in reading order");
  assert.deepEqual(ids(Ch.readingOrder(dupes, prefs(), 23, noSkip)), [25, 24, 23, 22, 21], "off keeps every chapter");
});

const scanlated = [
  { id: 34, sourceOrder: 4, number: 3, scanlator: "beta", read: false },
  { id: 33, sourceOrder: 3, number: 3, scanlator: "Alpha", read: false },
  { id: 32, sourceOrder: 2, number: 2, scanlator: "", read: false },
  { id: 31, sourceOrder: 1, number: 1, scanlator: "beta", read: true }
];
const without = (names) => Object.assign(prefs(), P.read(Ch.SCANLATOR_PREFS, { manga: { meta: [{ key: "miharchy.excludedScanlators", value: JSON.stringify(names) }] } }, P.defaults(Ch.SCANLATOR_PREFS)));

test("the scanlators listed are the manga's, A to Z ignoring case, without a blank one", () => {
  assert.deepEqual(Ch.scanlators(scanlated), ["Alpha", "beta"]);
});

test("an excluded scanlator's chapters leave the list; a chapter with no scanlator stays", () => {
  assert.deepEqual(ids(Ch.apply(scanlated, without(["beta"]))), [33, 32]);
  assert.deepEqual(ids(Ch.apply(scanlated, without([]))), [34, 33, 32, 31]);
  assert.equal(Ch.nextUnread(Ch.apply(scanlated, without(["Alpha"])), prefs()).id, 32, "the next chapter skips them too");
});

test("the reader drops an excluded scanlator's chapters even without skip filtered, but keeps the one opened (Mihon)", () => {
  assert.deepEqual(ids(Ch.readingOrder(scanlated, without(["beta"]), 33, noSkip)), [33, 32]);
  assert.deepEqual(ids(Ch.readingOrder(scanlated, without(["beta"]), 31, noSkip)), [33, 32, 31]);
});

test("each scanlator is a panel row; choosing one excludes it, choosing it again lets it back", () => {
  const rows = Ch.rows(without(["beta"]), Ch.scanlators(scanlated));
  assert.deepEqual(rows.filter((r) => r.kind === "scanlator").map((r) => [r.label, r.state]), [["Alpha", "off"], ["beta", "exclude"]]);
  assert.deepEqual(rows.slice(2, 6).map((r) => r.kind), ["filter", "scanlator", "scanlator", "sort"], "between the filters and the sorts");
  assert.deepEqual(Ch.choose(without(["beta"]), rows.find((r) => r.id === "Alpha")), [{ key: "excludedScanlators", value: JSON.stringify(["beta", "Alpha"]) }]);
  assert.deepEqual(Ch.choose(without(["beta"]), rows.find((r) => r.id === "beta")), [{ key: "excludedScanlators", value: "[]" }]);
});

test("excluded scanlators are never a chapter default, and unreadable meta excludes nothing", () => {
  assert.ok(!Ch.PREFS.some((p) => p.key === "excludedScanlators"), "save as default must not copy or reset them");
  assert.deepEqual(ids(Ch.apply(scanlated, Object.assign(prefs(), { excludedScanlators: "not json" }))), [34, 33, 32, 31]);
});

const shelf = [
  { id: 46, sourceOrder: 6, number: 6, read: false, downloaded: false, bookmarked: false, scanlator: "A" },
  { id: 45, sourceOrder: 5, number: 5, read: false, downloaded: true, bookmarked: true, scanlator: "A" },
  { id: 44, sourceOrder: 4, number: 4, read: false, downloaded: false, bookmarked: true, scanlator: "B" },
  { id: 43, sourceOrder: 3, number: 3, read: false, downloaded: false, bookmarked: false, scanlator: "A" },
  { id: 42, sourceOrder: 2, number: 2, read: true, downloaded: false, bookmarked: true, scanlator: "A" },
  { id: 41, sourceOrder: 1, number: 1, read: false, downloaded: false, bookmarked: false, scanlator: "A" }
];
const row = (id, count) => Ch.DOWNLOADS.find((r) => r.id === id && (count === undefined || r.count === count));

test("the download menu offers Mihon's rows: next 1, 5, 10, 25, a typed number, unread, bookmarked", () => {
  assert.deepEqual(Ch.DOWNLOADS.map((r) => [r.id, r.count]), [["next", 1], ["next", 5], ["next", 10], ["next", 25], ["next", 0], ["unread", undefined], ["bookmarked", undefined]]);
});

test("next N takes the first unread chapters not on disk, in reading order, whatever the list's direction", () => {
  assert.deepEqual(ids(Ch.toDownload(shelf, prefs(), true, row("next", 1), 1)), [41]);
  assert.deepEqual(ids(Ch.toDownload(shelf, prefs(), true, row("next", 5), 5)), [41, 43, 44, 46], "a read or downloaded chapter is skipped, not counted");
  assert.deepEqual(ids(Ch.toDownload(shelf, prefs({ chapterSortDirection: "asc" }), true, row("next", 0), 2)), [41, 43]);
});

test("unread and bookmarked take every such chapter not on disk", () => {
  assert.deepEqual(ids(Ch.toDownload(shelf, prefs(), true, row("unread"))), [46, 44, 43, 41]);
  assert.deepEqual(ids(Ch.toDownload(shelf, prefs(), true, row("bookmarked"))), [44, 42]);
});

test("the menu never takes an excluded scanlator's chapters, and follows the filters only while skip filtered is on (Mihon)", () => {
  const noB = Object.assign(prefs(), { excludedScanlators: JSON.stringify(["B"]) });
  assert.deepEqual(ids(Ch.toDownload(shelf, noB, false, row("next", 5), 5)), [41, 43, 46]);
  const hideBookmarks = prefs({ chapterFilterBookmarked: "exclude" });
  assert.deepEqual(ids(Ch.toDownload(shelf, hideBookmarks, true, row("next", 5), 5)), [41, 43, 46]);
  assert.deepEqual(ids(Ch.toDownload(shelf, hideBookmarks, false, row("next", 5), 5)), [41, 43, 44, 46]);
});

test("the typed amount is a whole number above 0, or 0", () => {
  assert.equal(Ch.count("7"), 7);
  assert.equal(Ch.count(" 12 "), 12);
  for (const t of ["0", "-3", "2.5", "abc", ""]) assert.equal(Ch.count(t), 0, t);
});
