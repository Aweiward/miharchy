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
  assert.equal(s.sources[0].icon, "http://u:p@127.0.0.1:4590/api/v1/extension/icon/s");
  assert.deepEqual(B.sources(ok(data), config, true).sources.map((x) => x.id), ["3", "4", "2"]);
});

test("a failed sources reply keeps the connection state for Model.problem", () => {
  assert.equal(B.sources(M.reply(0, ""), config, false).state, "down");
});

const page = (ids, hasNextPage) => ok({ fetchSourceManga: { hasNextPage, mangas: ids.map((id) => ({ id, title: "M" + id, thumbnailUrl: "/api/v1/manga/" + id + "/thumbnail", inLibrary: id === 2 })) } });

test("a listing asks for page 1, then the next page, and appends without duplicates", () => {
  let l = B.listing({ id: "99", name: "S", supportsLatest: true }, "popular", "");
  const p1 = B.listingPayload(l);
  assert.deepEqual(p1.variables, { source: "99", type: "POPULAR", page: 1, query: null });
  l = B.reduceListing(l, { type: "request" });
  assert.equal(B.listingPayload(l), null, "no second request while one is in flight");
  l = B.reduceListing(l, { type: "reply", reply: page([1, 2], true), config });
  assert.deepEqual(l.items.map((m) => m.id), [1, 2]);
  assert.equal(l.items[1].inLibrary, true);
  assert.equal(l.items[0].cover, "http://u:p@127.0.0.1:4590/api/v1/manga/1/thumbnail");
  assert.equal(B.listingPayload(l).variables.page, 2);
  l = B.reduceListing(B.reduceListing(l, { type: "request" }), { type: "reply", reply: page([2, 3], false), config });
  assert.deepEqual(l.items.map((m) => m.id), [1, 2, 3]);
  assert.equal(B.listingPayload(l), null, "the last page ends the scroll");
});

test("latest and search map to their fetch types; search sends the query", () => {
  const s = { id: "9", name: "S", supportsLatest: true };
  assert.equal(B.listingPayload(B.listing(s, "latest", "")).variables.type, "LATEST");
  assert.deepEqual(B.listingPayload(B.listing(s, "search", "one piece")).variables, { source: "9", type: "SEARCH", page: 1, query: "one piece" });
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
  id: 5, title: "Berserk", author: "Miura", artist: "Miura", description: "Dark.", genre: ["Action", "Seinen"],
  status: "ONGOING", thumbnailUrl: "/api/v1/manga/5/thumbnail", inLibrary: false, initialized: true,
  source: { displayName: "MangaDex (EN)" },
  chapters: { nodes: [
    { id: 11, name: "Ch. 1", chapterNumber: 1, uploadDate: "1700000000000", isRead: true, scanlator: "G", sourceOrder: 0 },
    { id: 12, name: "Ch. 2", chapterNumber: 2, uploadDate: "1700049600000", isRead: false, scanlator: null, sourceOrder: 1 }
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
  assert.equal(d.chapters[0].date, "2023-11-15");
  assert.equal(B.detailPayload(d), null, "an initialized manga with chapters needs no source fetch");
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

test("a library change shows on the source grid without a reload", () => {
  let l = B.reduceListing(B.reduceListing(B.listing({ id: "9", name: "S" }, "popular", ""), { type: "request" }), { type: "reply", reply: page([1, 2], false), config });
  l = B.markInLibrary(l, 1, true);
  assert.deepEqual(l.items.map((m) => m.inLibrary), [true, true]);
  assert.deepEqual(B.markInLibrary(l, 2, false).items.map((m) => m.inLibrary), [true, false]);
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
