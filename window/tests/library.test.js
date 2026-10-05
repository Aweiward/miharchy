const { test } = require("node:test");
const assert = require("node:assert/strict");
const L = require("./load")("Library.js");
const P = require("./load")("Prefs.js");

const manga = (id, title, extra) => ({
  id, title, author: "", artist: "", genre: [], unread: 0, read: 0, total: 0, downloads: 0, bookmarks: 0,
  status: "ONGOING", tracks: 0, lastRead: 0, latestUpload: 0, lastUpdate: 0, added: 0, ...extra
});
const ids = (list) => list.map((m) => m.id);
const prefs = (extra) => ({ ...P.defaults(L.PREFS), ...extra });

const shelf = [
  manga(1, "Berserk", { author: "Kentaro Miura", genre: ["Action", "Dark Fantasy"], unread: 5, read: 2, total: 7, downloads: 3, status: "COMPLETED", added: 30, lastRead: 100, latestUpload: 5, lastUpdate: 50 }),
  manga(2, "ajin", { author: "Gamon Sakurai", genre: ["Horror"], read: 4, total: 4, bookmarks: 1, tracks: 1, added: 10, lastRead: 300, latestUpload: 9, lastUpdate: 70 }),
  manga(3, "Chainsaw Man", { artist: "Tatsuki Fujimoto", genre: ["Action"], unread: 12, total: 12, added: 20, latestUpload: 20, lastUpdate: 10 }),
  manga(4, "Dorohedoro", { unread: 5, read: 1, total: 6, downloads: 1, added: 40, lastRead: 200, latestUpload: 1, lastUpdate: 90 })
];

test("the defaults sort by title ascending with every filter off", () => {
  assert.deepEqual(P.defaults(L.PREFS), {
    librarySort: "title", librarySortDirection: "asc", libraryDisplay: "grid",
    libraryFilterDownloaded: "off", libraryFilterUnread: "off", libraryFilterStarted: "off",
    libraryFilterBookmarked: "off", libraryFilterCompleted: "off", libraryFilterTracked: "off",
    libraryBadgeDownloads: "off", libraryBadgeLanguage: "off", libraryTabCounts: "off"
  });
  assert.deepEqual(ids(L.apply(shelf, prefs(), "")), [2, 1, 3, 4], "title ignores case");
});

test("search keeps manga whose title, author, artist or genre holds every word, ignoring case", () => {
  assert.deepEqual(ids(L.apply(shelf, prefs(), "BERS")), [1]);
  assert.deepEqual(ids(L.apply(shelf, prefs(), "miura")), [1], "author");
  assert.deepEqual(ids(L.apply(shelf, prefs(), "fujimoto")), [3], "artist");
  assert.deepEqual(ids(L.apply(shelf, prefs(), "action")), [1, 3], "genre");
  assert.deepEqual(ids(L.apply(shelf, prefs(), "  action   dark ")), [1], "each word must match");
  assert.deepEqual(ids(L.apply(shelf, prefs(), "")), [2, 1, 3, 4]);
  assert.deepEqual(L.apply(shelf, prefs(), "zzz"), []);
});

test("each filter includes or excludes manga by its test", () => {
  const only = (key, state) => ids(L.apply(shelf, prefs({ [key]: state }), ""));
  assert.deepEqual(only("libraryFilterDownloaded", "include"), [1, 4]);
  assert.deepEqual(only("libraryFilterDownloaded", "exclude"), [2, 3]);
  assert.deepEqual(only("libraryFilterUnread", "include"), [1, 3, 4]);
  assert.deepEqual(only("libraryFilterStarted", "include"), [2, 1, 4]);
  assert.deepEqual(only("libraryFilterStarted", "exclude"), [3]);
  assert.deepEqual(only("libraryFilterBookmarked", "include"), [2]);
  assert.deepEqual(only("libraryFilterCompleted", "include"), [1]);
  assert.deepEqual(only("libraryFilterTracked", "exclude"), [1, 3, 4]);
});

test("active filters and the search all apply together", () => {
  const p = prefs({ libraryFilterUnread: "include", libraryFilterDownloaded: "exclude" });
  assert.deepEqual(ids(L.apply(shelf, p, "")), [3]);
  assert.deepEqual(L.apply(shelf, p, "berserk"), []);
});

test("each sort orders by its value, and descending reverses it", () => {
  const order = (sort, dir) => ids(L.apply(shelf, prefs({ librarySort: sort, librarySortDirection: dir }), ""));
  assert.deepEqual(order("title", "desc"), [4, 3, 1, 2]);
  assert.deepEqual(order("total", "asc"), [2, 4, 1, 3]);
  assert.deepEqual(order("lastRead", "desc"), [2, 4, 1, 3]);
  assert.deepEqual(order("lastUpdate", "desc"), [4, 2, 1, 3]);
  assert.deepEqual(order("latestChapter", "asc"), [4, 1, 2, 3]);
  assert.deepEqual(order("added", "asc"), [2, 3, 1, 4]);
});

test("unread count keeps manga with nothing unread last in both directions, as Mihon does", () => {
  const order = (dir) => ids(L.apply(shelf, prefs({ librarySort: "unread", librarySortDirection: dir }), ""));
  assert.deepEqual(order("asc"), [1, 4, 3, 2]);
  assert.deepEqual(order("desc"), [3, 1, 4, 2]);
});

test("ties fall back to title ascending, even when the sort is descending, then to id", () => {
  const tied = [manga(5, "b", { total: 3 }), manga(6, "A", { total: 3 }), manga(7, "a", { total: 3 }), manga(8, "z", { total: 9 })];
  assert.deepEqual(ids(L.apply(tied, prefs({ librarySort: "total", librarySortDirection: "desc" }), "")), [8, 6, 7, 5]);
  assert.deepEqual(ids(L.apply(tied, prefs({ librarySort: "total", librarySortDirection: "asc" }), "")), [6, 7, 5, 8]);
});

test("the panel lists the filters, then the sorts, then the display modes, with their states", () => {
  const rows = L.rows(prefs({ libraryFilterUnread: "exclude", librarySort: "added", librarySortDirection: "desc" }));
  assert.deepEqual(rows.map((r) => r.label), ["Downloaded", "Unread", "Started", "Bookmarked", "Completed", "Tracked",
    "Title", "Total chapters", "Last read", "Last update", "Unread count", "Latest chapter", "Date added", "Cover grid", "List",
    "Downloaded chapters", "Language", "Number of items"]);
  assert.deepEqual(rows.filter((r) => r.kind === "display").map((r) => r.state), ["picked", "unpicked"]);
  assert.deepEqual(rows.filter((r) => r.kind === "filter").map((r) => r.state), ["off", "exclude", "off", "off", "off", "off"]);
  assert.deepEqual(rows.filter((r) => r.kind === "sort").map((r) => r.state), ["", "", "", "", "", "", "desc"]);
});

test("choosing a filter cycles off, include, exclude, off", () => {
  let p = prefs();
  const unread = () => L.rows(p).find((r) => r.id === "unread" && r.kind === "filter");
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const c = L.choose(p, unread());
    assert.equal(c.key, "libraryFilterUnread");
    p = { ...p, [c.key]: c.value };
    seen.push(p.libraryFilterUnread);
  }
  assert.deepEqual(seen, ["include", "exclude", "off"]);
});

test("choosing another sort keeps the direction; choosing the same sort again flips it", () => {
  const p = prefs({ librarySortDirection: "desc" });
  const row = (id) => L.rows(p).find((r) => r.kind === "sort" && r.id === id);
  assert.deepEqual(L.choose(p, row("unread")), { key: "librarySort", value: "unread" });
  assert.deepEqual(L.choose(p, row("title")), { key: "librarySortDirection", value: "asc" });
  const title = L.rows(prefs()).find((r) => r.kind === "sort" && r.id === "title");
  assert.deepEqual(L.choose(prefs(), title), { key: "librarySortDirection", value: "desc" });
});

test("a display row picks its mode, and the toggle key switches between grid and list", () => {
  const list = L.rows(prefs()).find((r) => r.kind === "display" && r.id === "list");
  assert.deepEqual(L.choose(prefs(), list), { key: "libraryDisplay", value: "list" });
  assert.deepEqual(L.toggleDisplay(prefs()), { key: "libraryDisplay", value: "list" });
  assert.deepEqual(L.toggleDisplay(prefs({ libraryDisplay: "list" })), { key: "libraryDisplay", value: "grid" });
  assert.deepEqual(L.apply(shelf, prefs({ libraryDisplay: "list" }), ""), L.apply(shelf, prefs(), ""), "the display mode hides nothing");
});

test("a badge or the tab count row turns it on and off", () => {
  const row = (p, id) => L.rows(p).find((r) => r.id === id);
  assert.deepEqual(L.choose(prefs(), row(prefs(), "libraryBadgeDownloads")), { key: "libraryBadgeDownloads", value: "on" });
  const on = prefs({ libraryTabCounts: "on" });
  assert.equal(row(on, "libraryTabCounts").state, "on");
  assert.deepEqual(L.choose(on, row(on, "libraryTabCounts")), { key: "libraryTabCounts", value: "off" });
});

test("the cover shows unread always, downloads and the language only with their badge on", () => {
  const m = manga(1, "x", { unread: 4, downloads: 2, lang: "en" });
  assert.deepEqual(L.badges(m, prefs()), { unread: 4, downloads: 0, lang: "" });
  assert.deepEqual(L.badges(m, prefs({ libraryBadgeDownloads: "on", libraryBadgeLanguage: "on" })), { unread: 4, downloads: 2, lang: "EN" });
  assert.deepEqual(L.badges(manga(2, "y", { lang: "" }), prefs({ libraryBadgeLanguage: "on" })).lang, "", "a missing source has no language");
});

test("a tab shows its manga count when the count is on or a search runs, as Mihon", () => {
  const entry = { name: "Action", manga: [shelf[0], shelf[2]] };
  assert.equal(L.tabLabel(entry, prefs(), ""), "Action");
  assert.equal(L.tabLabel(entry, prefs({ libraryTabCounts: "on" }), ""), "Action (2)");
  assert.equal(L.tabLabel(entry, prefs(), " ber "), "Action (2)");
});

test("the header names the search, the active filters and a sort other than the default", () => {
  assert.equal(L.summary(prefs(), ""), "");
  assert.equal(L.narrowed(prefs(), ""), false);
  const p = prefs({ libraryFilterUnread: "include", libraryFilterDownloaded: "exclude", librarySort: "unread", librarySortDirection: "desc" });
  assert.equal(L.summary(p, " ber "), "/ ber   not downloaded, unread   unread count ↓");
  assert.equal(L.narrowed(p, ""), true);
  assert.equal(L.narrowed(prefs(), "x"), true);
  assert.equal(L.narrowed(prefs({ librarySort: "added" }), ""), false, "a sort hides nothing");
  assert.equal(L.summary(prefs({ librarySortDirection: "desc" }), ""), "title ↓");
});
