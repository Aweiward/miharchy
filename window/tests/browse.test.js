const { test } = require("node:test");
const assert = require("node:assert/strict");
const B = require("./load")("Browse.js");
const M = require("./load")("Model.js");

const config = { url: "http://127.0.0.1:4590", username: "u", password: "p" };
const ok = (data) => M.reply(200, JSON.stringify({ data }));
const fail = (message) => M.reply(200, JSON.stringify({ errors: [{ message }] }));

const src = (o) => Object.assign({ id: "1", name: "S", displayName: "S (EN)", lang: "en", iconUrl: "/api/v1/extension/icon/s", contentWarning: "SAFE", supportsLatest: true }, o);

test("sources skip the local source, hide NSFW unless asked, and sort by name", () => {
  const data = { sources: { nodes: [
    src({ id: "0", displayName: "Local source" }),
    src({ id: "2", displayName: "Weeb Central", contentWarning: "MIXED" }),
    src({ id: "3", displayName: "Adult", contentWarning: "NSFW" }),
    src({ id: "4", displayName: "Asura Scans" })
  ] } };
  const s = B.sources(ok(data), config, false);
  assert.equal(s.state, "ok");
  assert.deepEqual(s.sources.map((x) => x.name), ["Asura Scans", "Weeb Central"]);
  assert.equal(s.sources[0].icon, "http://127.0.0.1:4590/api/v1/extension/icon/s");
  assert.deepEqual(B.sources(ok(data), config, true).sources.map((x) => x.id), ["3", "4", "2"]);
});

test("a failed sources reply keeps the connection state for Model.problem", () => {
  assert.equal(B.sources(M.reply(0, ""), config, false).state, "down");
});

const page = (ids, hasNextPage) => ok({ fetchSourceManga: { hasNextPage, mangas: ids.map((id) => ({ id, title: "M" + id, thumbnailUrl: "/api/v1/manga/" + id + "/thumbnail", inLibrary: id === 2 })) } });

test("a listing asks for page 1, then the next page, and appends without duplicates", () => {
  let l = B.listing({ id: "99", name: "S", supportsLatest: true }, "popular", "");
  const p1 = B.listingPayload(l);
  assert.deepEqual(p1.variables, { source: "99", type: "POPULAR", page: 1, query: null, filters: null });
  l = B.reduceListing(l, { type: "request" });
  assert.equal(B.listingPayload(l), null, "no second request while one is in flight");
  l = B.reduceListing(l, { type: "reply", reply: page([1, 2], true), config });
  assert.deepEqual(l.items.map((m) => m.id), [1, 2]);
  assert.equal(l.items[1].inLibrary, true);
  assert.equal(l.items[0].cover, "http://127.0.0.1:4590/api/v1/manga/1/thumbnail");
  assert.equal(B.listingPayload(l).variables.page, 2);
  l = B.reduceListing(B.reduceListing(l, { type: "request" }), { type: "reply", reply: page([2, 3], false), config });
  assert.deepEqual(l.items.map((m) => m.id), [1, 2, 3]);
  assert.equal(B.listingPayload(l), null, "the last page ends the scroll");
});

test("latest and search map to their fetch types; search sends the query", () => {
  const s = { id: "9", name: "S", supportsLatest: true };
  assert.equal(B.listingPayload(B.listing(s, "latest", "")).variables.type, "LATEST");
  assert.deepEqual(B.listingPayload(B.listing(s, "search", "one piece")).variables, { source: "9", type: "SEARCH", page: 1, query: "one piece", filters: [] });
});

test("filters reach the source only in a search, as Suwayomi applies them only there", () => {
  const s = { id: "9", name: "S", supportsLatest: true };
  const filters = [{ position: 0, selectState: 3 }];
  assert.deepEqual(B.listingPayload(B.listing(s, "search", "", filters)).variables, { source: "9", type: "SEARCH", page: 1, query: "", filters });
  assert.equal(B.listingPayload(B.listing(s, "popular", "", filters)).variables.filters, null);
  assert.equal(B.listing(s, "popular", "", filters).filters.length, 0, "popular and latest drop them");
});

test("an empty filtered search points at the filters", () => {
  const l = B.reduceListing(B.reduceListing(B.listing({ id: "9", name: "S" }, "search", "", [{ position: 0, checkBoxState: true }]), { type: "request" }), { type: "reply", reply: page([], false), config });
  assert.deepEqual(B.notice(l, "/c"), { title: "No manga found", detail: "Try other filters: F." });
});

test("a source says whether it has settings", () => {
  const s = B.sources(ok({ sources: { nodes: [src({ id: "2", isConfigurable: true }), src({ id: "3", displayName: "T" })] } }), config, false).sources;
  assert.deepEqual(s.map((x) => x.configurable), [true, false]);
});

test("a source without latest falls back to popular", () => {
  assert.equal(B.listing({ id: "9", name: "S", supportsLatest: false }, "latest", "").mode, "popular");
});

test("Cloudflare without FlareSolverr is a 'needs FlareSolverr' notice, not the raw error", () => {
  let l = B.reduceListing(B.listing({ id: "9", name: "S" }, "popular", ""), { type: "request" });
  l = B.reduceListing(l, { type: "reply", reply: fail("Exception while fetching data (/fetchSourceManga) : Cloudflare bypass currently disabled\n\tat x"), config });
  const n = B.notice(l, "/c");
  assert.equal(n.title, "This source needs FlareSolverr");
  assert.doesNotMatch(n.detail, /Exception|bypass/);
  assert.equal(B.listingPayload(l), null, "a failed page does not retry by itself");
});

test("another listing error uses the shared problem text and r retries the same page", () => {
  let l = B.reduceListing(B.reduceListing(B.listing({ id: "9", name: "S" }, "popular", ""), { type: "request" }), { type: "reply", reply: fail("HTTP error 500"), config });
  assert.equal(B.notice(l, "/c").title, "The server sent an error");
  l = B.reduceListing(l, { type: "retry" });
  assert.equal(B.listingPayload(l).variables.page, 1);
});

test("an empty first page says so", () => {
  const l = B.reduceListing(B.reduceListing(B.listing({ id: "9", name: "S" }, "search", "zzz"), { type: "request" }), { type: "reply", reply: page([], false), config });
  assert.equal(B.notice(l, "/c").title, "No manga found");
});

const mangaNode = (o) => Object.assign({
  id: 5, title: "Berserk", realUrl: "https://example.org/berserk", author: "Miura", artist: "Miura", description: "Dark.", genre: ["Action", "Seinen"],
  status: "ONGOING", thumbnailUrl: "/api/v1/manga/5/thumbnail", inLibrary: false, initialized: true,
  source: { displayName: "MangaDex (EN)" },
  chapters: { nodes: [
    { id: 11, name: "Ch. 1", realUrl: "https://example.org/berserk/1", chapterNumber: 1, uploadDate: "1700000000000", isRead: true, isDownloaded: true, scanlator: "G", sourceOrder: 0 },
    { id: 12, name: "Ch. 2", chapterNumber: 2, uploadDate: "1700049600000", isRead: false, isBookmarked: true, lastPageRead: 4, scanlator: null, sourceOrder: 1 }
  ] }
}, o);

test("a detail reads the cached manga and shows chapters newest first", () => {
  let d = B.detail(5);
  assert.match(B.detailPayload(d).query, /manga\(id: \$id\)/);
  d = B.reduceDetail(d, { type: "reply", reply: ok({ manga: mangaNode() }), config });
  assert.equal(d.state, "ok");
  assert.equal(d.manga.title, "Berserk");
  assert.equal(d.manga.genres, "Action, Seinen");
  assert.equal(d.manga.status, "Ongoing");
  assert.equal(d.manga.source, "MangaDex (EN)");
  assert.deepEqual(d.chapters.map((c) => c.id), [12, 11]);
  assert.equal(d.chapters[1].read, true);
  assert.deepEqual(d.chapters.map((c) => c.lastPage), [4, 0], "the page read, for a mark unread to reset");
  assert.equal(d.chapters[0].date, "2023-11-15");
  assert.equal(d.manga.url, "https://example.org/berserk");
  assert.deepEqual(d.chapters.map((c) => c.url), ["", "https://example.org/berserk/1"], "o and y open or copy these; a missing one is empty");
  assert.deepEqual(d.chapters.map((c) => [c.bookmarked, c.uploadDate, c.sourceOrder]), [[true, 1700049600000, 1], [false, 1700000000000, 0]], "what the chapter list filters and sorts by");
  assert.equal(B.detailPayload(d), null, "an initialized manga with chapters needs no source fetch");
});

test("a manga's meta gives its reading mode and its notes; without them both are empty", () => {
  const meta = [{ key: "miharchy.readingMode", value: "webtoon" }, { key: "miharchy.notes", value: "**Dropped** at ch. 40" }];
  const d = B.reduceDetail(B.detail(5), { type: "reply", reply: ok({ manga: mangaNode({ meta }) }), config });
  assert.equal(d.manga.readingMode, "webtoon");
  assert.equal(d.manga.notes, "**Dropped** at ch. 40");
  const bare = B.reduceDetail(B.detail(5), { type: "reply", reply: ok({ manga: mangaNode() }), config });
  assert.deepEqual([bare.manga.readingMode, bare.manga.notes], ["", ""]);
});

test("an uninitialized manga or one without chapters is fetched from the source once", () => {
  for (const node of [mangaNode({ initialized: false }), mangaNode({ chapters: { nodes: [] } })]) {
    let d = B.reduceDetail(B.detail(5), { type: "reply", reply: ok({ manga: node }), config });
    const p = B.detailPayload(d);
    assert.match(p.query, /fetchMangaAndChapters/);
    assert.deepEqual(p.variables, { id: 5 });
    d = B.reduceDetail(d, { type: "reply", reply: ok({ fetchMangaAndChapters: { manga: mangaNode({ chapters: undefined }), chapters: mangaNode().chapters.nodes } }), config });
    assert.equal(d.chapters.length, 2);
    assert.equal(B.detailPayload(d), null, "fetched once, never again by itself");
  }
});

test("refresh fetches from the source again", () => {
  let d = B.reduceDetail(B.detail(5), { type: "reply", reply: ok({ manga: mangaNode() }), config });
  d = B.reduceDetail(d, { type: "refresh" });
  assert.match(B.detailPayload(d).query, /fetchMangaAndChapters/);
});

test("a source fetch that fails keeps the cached manga and says why", () => {
  let d = B.reduceDetail(B.detail(5), { type: "reply", reply: ok({ manga: mangaNode({ initialized: false }) }), config });
  d = B.reduceDetail(d, { type: "reply", reply: fail("Cloudflare bypass currently disabled"), config });
  assert.equal(d.manga.title, "Berserk");
  assert.equal(B.notice(d, "/c").title, "This source needs FlareSolverr");
  assert.equal(B.detailPayload(d), null);
});

const ASURA = "6247824327199706550";
const missing = (o) => mangaNode(Object.assign({ sourceId: ASURA, source: null, initialized: false }, o));
const names = (map) => ({ metas: { nodes: [{ value: JSON.stringify(map) }] } });

test("a manga with a missing source shows its stored name, no cover and never fetches", () => {
  let d = B.reduceDetail(B.detail(5, true), { type: "reply", reply: ok(Object.assign({ manga: missing() }, names({ [ASURA]: "Asura Scans" }))), config });
  assert.equal(d.manga.source, "Asura Scans (not installed)");
  assert.equal(d.manga.cover, "", "the server fetches covers through the source, so it would only fail");
  const p = B.detailPayload(d);
  assert.doesNotMatch(p.query, /fetchMangaAndChapters/);
  assert.deepEqual(p.variables, { name: "Asura Scans" });
  d = B.reduceDetail(d, { type: "reply", reply: ok({ extensions: { nodes: [{ name: "Asura Scans", isInstalled: false }] } }), config });
  assert.equal(d.state, "ok");
  assert.deepEqual(d.extension, { installed: false });
  assert.equal(B.detailPayload(d), null);
});

test("an unknown missing source skips the extension lookup", () => {
  const d = B.reduceDetail(B.detail(5), { type: "reply", reply: ok({ manga: missing(), metas: { nodes: [] } }), config });
  assert.equal(d.manga.source, "Unknown source " + ASURA);
  assert.equal(B.detailPayload(d), null);
  assert.equal(d.state, "ok");
});

test("sourceHelp says what to do about a missing source", () => {
  const known = { missing: true, sourceName: "Asura Scans" };
  assert.equal(B.sourceHelp({ missing: false }, null), "");
  assert.match(B.sourceHelp(known, { installed: false }), /^Install the Asura Scans extension in Browse\. If .*migrate/);
  assert.match(B.sourceHelp(known, { installed: true }), /^The installed Asura Scans extension serves a different source.*Migrate/);
  assert.match(B.sourceHelp(known, null), /^No extension in your repos is named Asura Scans\. Migrate/);
  assert.match(B.sourceHelp({ missing: true, sourceName: "" }, null), /^Migrate/);
  assert.doesNotMatch(B.sourceHelp(known, null), /coming soon/);
  assert.match(B.sourceHelp(known, { installed: true }), /M\.$/, "names the key that migrates");
});

test("add to library flips inLibrary from the server's answer", () => {
  let d = B.reduceDetail(B.detail(5), { type: "reply", reply: ok({ manga: mangaNode() }), config });
  const p = B.libraryPayload(d);
  assert.deepEqual(p.variables, { id: 5, inLibrary: true });
  d = B.reduceDetail(d, { type: "library-request" });
  assert.equal(d.busy, true);
  assert.equal(B.libraryPayload(d), null, "no double toggle while one is in flight");
  d = B.reduceDetail(d, { type: "library-reply", reply: ok({ updateManga: { manga: { id: 5, inLibrary: true } } }) });
  assert.equal(d.manga.inLibrary, true);
  assert.equal(d.busy, false);
  assert.deepEqual(B.libraryPayload(d).variables, { id: 5, inLibrary: false });
});

test("a failed library toggle keeps the old flag and shows the error", () => {
  let d = B.reduceDetail(B.detail(5), { type: "reply", reply: ok({ manga: mangaNode() }), config });
  d = B.reduceDetail(B.reduceDetail(d, { type: "library-request" }), { type: "library-reply", reply: fail("boom") });
  assert.equal(d.manga.inLibrary, false);
  assert.equal(d.libraryError, "boom");
});

const inLibrary = (categories) => B.reduceDetail(B.detail(5), { type: "reply", reply: ok({ manga: mangaNode({ inLibrary: true, categories: { nodes: categories.map((id) => ({ id })) } }) }), config });
const categoriesReply = (ids) => ok({ updateMangaCategories: { manga: { id: 5, categories: { nodes: ids.map((id) => ({ id })) } } } });

test("the detail knows the manga's categories", () => {
  assert.deepEqual(inLibrary([4, 2]).manga.categories, [4, 2]);
  assert.deepEqual(B.reduceDetail(B.detail(5), { type: "reply", reply: ok({ manga: mangaNode() }), config }).manga.categories, []);
});

test("a category toggle adds the manga to a category it is not in and removes it from one it is in", () => {
  const d = inLibrary([4]);
  assert.deepEqual(B.categoryPayload(d, 2).variables, { id: 5, add: [2], remove: [] });
  assert.deepEqual(B.categoryPayload(d, 4).variables, { id: 5, add: [], remove: [4] });
  assert.match(B.categoryPayload(d, 2).query, /updateMangaCategories/);
});

test("the server's answer sets the categories; one toggle at a time; a failure says why", () => {
  let d = B.reduceDetail(inLibrary([4]), { type: "library-request" });
  assert.equal(B.categoryPayload(d, 2), null, "no second toggle while one is in flight");
  d = B.reduceDetail(d, { type: "categories-reply", reply: categoriesReply([4, 2]) });
  assert.deepEqual(d.manga.categories, [4, 2]);
  assert.equal(d.busy, false);
  d = B.reduceDetail(B.reduceDetail(d, { type: "library-request" }), { type: "categories-reply", reply: fail("boom") });
  assert.deepEqual(d.manga.categories, [4, 2]);
  assert.equal(d.libraryError, "boom");
});

test("only a manga in the library goes into categories", () => {
  assert.equal(B.categoryPayload(B.reduceDetail(B.detail(5), { type: "reply", reply: ok({ manga: mangaNode() }), config }), 2), null);
  assert.equal(B.categoryPayload(B.detail(5), 2), null, "nor one still loading");
});

test("a library change shows on the source grid without a reload", () => {
  let l = B.reduceListing(B.reduceListing(B.listing({ id: "9", name: "S" }, "popular", ""), { type: "request" }), { type: "reply", reply: page([1, 2], false), config });
  l = B.markInLibrary(l, 1, true);
  assert.deepEqual(l.items.map((m) => m.inLibrary), [true, true]);
  assert.deepEqual(B.markInLibrary(l, 2, false).items.map((m) => m.inLibrary), [true, false]);
});

test("the grid keeps its place for a page more or a library mark, not for a new listing", () => {
  const first = B.reduceListing(B.reduceListing(B.listing({ id: "9", name: "S" }, "popular", ""), { type: "request" }), { type: "reply", reply: page([1, 2], true), config });
  const more = B.reduceListing(B.reduceListing(first, { type: "request" }), { type: "reply", reply: page([3, 4], false), config });
  assert.equal(B.continues(first.items, more.items), true, "a page more");
  assert.equal(B.continues(first.items, B.markInLibrary(first, 2, true).items), true, "a library mark");
  const search = B.reduceListing(B.reduceListing(B.listing({ id: "9", name: "S" }, "search", "x"), { type: "request" }), { type: "reply", reply: page([5, 6], false), config });
  assert.equal(B.continues(more.items, search.items), false, "a new search starts at the top");
  assert.equal(B.continues([], first.items), false, "the first page starts at the top");
  assert.equal(B.continues(more.items, first.items), false, "fewer items: a new listing");
});

test("sources show English and multi-language ones unless every language is asked for", () => {
  const data = { sources: { nodes: [src({ id: "5", displayName: "MangaDex (EN)", lang: "en" }), src({ id: "6", displayName: "MangaDex (JA)", lang: "ja" }), src({ id: "7", displayName: "Comick", lang: "all" })] } };
  assert.deepEqual(B.sources(ok(data), config, false).sources.map((x) => x.id), ["7", "5"]);
  assert.deepEqual(B.sources(ok(data), config, false, true).sources.map((x) => x.id), ["7", "5", "6"]);
});

test("a manga opened from a source shows the cache, then refreshes from the source once", () => {
  let d = B.reduceDetail(B.detail(5, true), { type: "reply", reply: ok({ manga: mangaNode() }), config });
  assert.equal(d.manga.title, "Berserk", "the cached manga shows while the fetch runs");
  assert.match(B.detailPayload(d).query, /fetchMangaAndChapters/);
  d = B.reduceDetail(d, { type: "reply", reply: ok({ fetchMangaAndChapters: { manga: mangaNode({ status: "COMPLETED", chapters: undefined }), chapters: mangaNode().chapters.nodes } }), config });
  assert.equal(d.manga.status, "Completed");
  assert.equal(B.detailPayload(d), null);
});

test("retry only restarts a failed list, so r during a load cannot skip a page", () => {
  let l = B.reduceListing(B.listing({ id: "9", name: "S" }, "popular", ""), { type: "request" });
  assert.equal(B.reduceListing(l, { type: "retry" }).state, "loading");
  l = B.reduceListing(l, { type: "reply", reply: page([1], true), config });
  assert.equal(B.reduceListing(l, { type: "retry" }), l, "a healthy list ignores retry");
});

test("a reread after reading shows the read flags from the cache, never refetching the source", () => {
  let d = B.reduceDetail(B.detail(5, true), { type: "reply", reply: ok({ manga: mangaNode() }), config });
  d = B.reduceDetail(d, { type: "reply", reply: ok({ fetchMangaAndChapters: { manga: mangaNode({ chapters: undefined }), chapters: mangaNode().chapters.nodes } }), config });
  d = B.reduceDetail(d, { type: "reread" });
  assert.match(B.detailPayload(d).query, /manga\(id: \$id\)/);
  const read = mangaNode().chapters.nodes.map((c) => Object.assign({}, c, { isRead: true }));
  d = B.reduceDetail(d, { type: "reply", reply: ok({ manga: mangaNode({ chapters: { nodes: read } }) }), config });
  assert.deepEqual(d.chapters.map((c) => c.read), [true, true]);
  assert.equal(d.state, "ok");
  assert.equal(B.detailPayload(d), null);
});

test("a manga reads as a long strip by its genre tags or a webtoon source", () => {
  const strip = (o) => B.reduceDetail(B.detail(5), { type: "reply", reply: ok({ manga: mangaNode(o) }), config }).manga.longStrip;
  assert.equal(strip(), false);
  for (const g of ["Long Strip", "Webtoon", "manhwa", "Manhua"]) assert.equal(strip({ genre: ["Action", g] }), true, g);
  assert.equal(strip({ genre: ["Web Comic", "Korean", "Full Color"] }), false, "language, color and web publication say nothing about the layout");
  assert.equal(strip({ genre: ["Romance"], source: { displayName: "Webtoons.com (EN)" } }), true);
});

test("a manga's own reading mode comes from its miharchy.readingMode meta", () => {
  const mode = (meta) => B.reduceDetail(B.detail(5), { type: "reply", reply: ok({ manga: mangaNode({ meta }) }), config }).manga.readingMode;
  assert.equal(mode(undefined), "");
  assert.equal(mode([{ key: "other", value: "x" }, { key: "miharchy.readingMode", value: "webtoon" }]), "webtoon");
  assert.match(B.detailPayload(B.detail(5)).query, /meta \{ key value \}/);
});

test("a chapter knows whether it is downloaded, and a delete reply updates it", () => {
  assert.match(B.detailPayload(B.detail(5)).query, /isDownloaded/);
  let d = B.reduceDetail(B.detail(5), { type: "reply", reply: ok({ manga: mangaNode() }), config });
  assert.deepEqual(d.chapters.map((c) => c.downloaded), [false, true]);
  d = B.reduceDetail(d, { type: "downloads-reply", reply: ok({ deleteDownloadedChapters: { chapters: [{ id: 11, isDownloaded: false }] } }) });
  assert.deepEqual(d.chapters.map((c) => c.downloaded), [false, false]);
  const failed = B.reduceDetail(d, { type: "downloads-reply", reply: fail("Timed out") });
  assert.equal(failed.libraryError, "Timed out");
  assert.deepEqual(failed.chapters, d.chapters);
  const queued = B.reduceDetail(d, { type: "downloads-reply", reply: ok({ enqueueChapterDownloads: { downloadStatus: { state: "STARTED", queue: [] } } }) });
  assert.deepEqual(queued.chapters, d.chapters, "a reply without deletes changes no chapter");
});

test("a failed mark read shows its error, and the next one clears it", () => {
  const d = B.reduceDetail(B.detail(5), { type: "reply", reply: ok({ manga: mangaNode() }), config });
  const failed = B.reduceDetail(d, { type: "mark-reply", reply: fail("Timed out") });
  assert.equal(failed.libraryError, "Timed out");
  assert.equal(B.reduceDetail(failed, { type: "mark-reply", reply: ok({ marked: { chapters: [] }, reset: { chapters: [] } }) }).libraryError, "");
});
