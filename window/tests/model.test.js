const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("./load")("Model.js");

const config = { url: "http://127.0.0.1:4590", username: "miharchy", password: "s3cret" };
const respond = (status, body) => ({ type: "response", status, body: typeof body === "string" ? body : JSON.stringify(body), config });

test("five views in glossary order, keyed 1-5", () => {
  assert.deepEqual(M.VIEWS.map((v) => v.title), ["Library", "Updates", "History", "Browse", "Settings"]);
  assert.deepEqual(M.VIEWS.map((v) => v.key), ["1", "2", "3", "4", "5"]);
  assert.equal(M.viewIndex("browse"), 3);
  assert.equal(M.viewIndex("nope"), -1);
});

test("parseConfig accepts server.json and drops a trailing slash", () => {
  assert.deepEqual(M.parseConfig(JSON.stringify({ ...config, url: "http://127.0.0.1:4590/" })), config);
});

test("parseConfig rejects missing, broken or incomplete config", () => {
  for (const text of ["", "{", "null", "[]", JSON.stringify({ url: "x", username: "u" }), JSON.stringify({ ...config, url: "" })]) {
    assert.equal(M.parseConfig(text), null, text);
  }
});

test("libraryRequest targets the GraphQL endpoint with user:password", () => {
  const r = M.libraryRequest(config);
  assert.equal(r.url, "http://127.0.0.1:4590/api/graphql");
  assert.equal(r.authorization, "Basic " + Buffer.from("miharchy:s3cret").toString("base64"));
  assert.match(JSON.parse(r.body).query, /inLibrary: true/);
});

test("base64 matches node's encoder for every padding length and UTF-8", () => {
  for (const s of ["", "a", "ab", "abc", "abcd", "miharchy:" + "f".repeat(48), "ünï:cødé"]) {
    assert.equal(M.base64(s), Buffer.from(s, "utf8").toString("base64"), s);
  }
});

test("the connection starts loading", () => {
  assert.equal(M.initial().state, "loading");
});

test("transitions: missing config, request, and each kind of answer", () => {
  const s0 = M.initial();
  assert.equal(M.reduce(s0, { type: "config-missing" }).state, "no-config");
  assert.equal(M.reduce(s0, respond(0, "")).state, "down");
  assert.equal(M.reduce(s0, respond(401, "Unauthorized")).state, "unauthorized");
  assert.equal(M.reduce(s0, respond(200, { data: { mangas: { nodes: [] } } })).state, "ok");

  const e500 = M.reduce(s0, respond(500, "boom"));
  assert.equal(e500.state, "error");
  assert.match(e500.message, /500/);
  assert.equal(M.reduce(s0, respond(200, "<html>")).state, "error");
  assert.equal(M.reduce(s0, respond(200, { data: {} })).state, "error");

  const gql = M.reduce(s0, respond(200, { errors: [{ message: "Bad field" }] }));
  assert.equal(gql.state, "error");
  assert.equal(gql.message, "Bad field");

  assert.equal(M.reduce(M.reduce(s0, respond(401, "")), { type: "request" }).state, "loading");
  assert.equal(M.reduce(s0, { type: "unknown" }), s0);
});

test("a Suwayomi exception reads as its message, without the wrapper or stack", () => {
  const body = { errors: [{ message: "Exception while fetching data (/addExtensionStore) : HTTP error 404\r\n\r\nHttpException: HTTP error 404\n\tat x.y(Z.kt:50)\n" }] };
  assert.equal(M.reply(200, JSON.stringify(body)).message, "HTTP error 404");
});

test("a reload keeps the shown library; a failed one drops it", () => {
  const ok = M.reduce(M.initial(), respond(200, { data: { mangas: { nodes: [{ id: 1, title: "A", thumbnailUrl: null }] } } }));
  const reloading = M.reduce(ok, { type: "request" });
  assert.equal(reloading.state, "loading");
  assert.equal(reloading.manga.length, 1);
  assert.equal(M.notice(reloading, "p"), null, "no loading notice over a shown library");
  assert.deepEqual(M.reduce(reloading, respond(0, "")).manga, []);
  assert.deepEqual(M.reduce(M.reduce(M.initial(), respond(401, "")), { type: "request" }).manga, []);
});

test("the library answer becomes manga with authenticated cover URLs", () => {
  const body = { data: { mangas: { nodes: [
    { id: 7, title: "Yotsuba&!", thumbnailUrl: "/api/v1/manga/7/thumbnail" },
    { id: 8, title: "No cover", thumbnailUrl: null },
    { id: 9, title: "Remote", thumbnailUrl: "https://cdn.example/9.jpg" }
  ] } } };
  assert.deepEqual(M.reduce(M.initial(), respond(200, body)).manga, [
    { id: 7, title: "Yotsuba&!", cover: "http://miharchy:s3cret@127.0.0.1:4590/api/v1/manga/7/thumbnail", categories: [] },
    { id: 8, title: "No cover", cover: "", categories: [] },
    { id: 9, title: "Remote", cover: "https://cdn.example/9.jpg", categories: [] }
  ]);
});

test("coverUrl gives credentials to the server's own origin only", () => {
  const creds = "miharchy:s3cret@";
  assert.equal(M.coverUrl(config, "http://127.0.0.1:4590/api/v1/manga/1/thumbnail"), "http://" + creds + "127.0.0.1:4590/api/v1/manga/1/thumbnail");
  for (const hostile of [
    "http://127.0.0.1:4590.evil.com/x",
    "http://127.0.0.1:45901/x",
    "http://127.0.0.1:4590@evil.com/x",
    "http://other:pw@127.0.0.1:4590/x",
    "https://cdn.example/9.jpg",
    "https://127.0.0.1:4590/x",
    "//evil.com/x",
    "evil.com/x",
    "javascript:alert(1)"
  ]) {
    const out = M.coverUrl(config, hostile);
    assert.equal(out, hostile, hostile);
    assert.ok(!out.includes("s3cret"), hostile);
  }
});

test("coverUrl percent-encodes credentials", () => {
  assert.equal(M.coverUrl({ ...config, password: "a@b:c" }, "/x"), "http://miharchy:a%40b%3Ac@127.0.0.1:4590/x");
});

test("notice: a clear message per state, none over a filled library", () => {
  const path = "~/.config/miharchy/server.json";
  const n = (c) => M.notice(c, path);
  assert.equal(n(M.initial()).title, "Loading the library");
  assert.equal(n(M.reduce(M.initial(), { type: "config-missing" })).title, "No server config");
  assert.match(n(M.reduce(M.initial(), { type: "config-missing" })).detail, /server\.json/);
  assert.equal(n(M.reduce(M.initial(), respond(0, ""))).title, "The server is not running");
  assert.equal(n(M.reduce(M.initial(), respond(401, ""))).title, "The server rejected the credentials");
  assert.match(n(M.reduce(M.initial(), respond(500, ""))).detail, /HTTP 500/);
  assert.equal(n(M.reduce(M.initial(), respond(200, { data: { mangas: { nodes: [] } } }))).title, "Your library is empty");
  assert.equal(n(M.reduce(M.initial(), respond(200, { data: { mangas: { nodes: [{ id: 1, title: "A" }] } } }))), null);
});

const library = (categories, manga) => M.reduce(M.initial(), respond(200, { data: {
  categories: { nodes: [{ id: 0, name: "Default", order: 0 }].concat(categories) },
  mangas: { nodes: manga.map(([id, cats]) => ({ id, title: "M" + id, thumbnailUrl: null, categories: { nodes: cats.map((c) => ({ id: c })) } })) }
} }));
const ids = (shown) => shown.manga.map((m) => m.id);

test("the library answer carries user categories, without Suwayomi's Default", () => {
  const c = library([{ id: 4, name: "Action", order: 1, includeInDownload: "INCLUDE" }, { id: 2, name: "Romance", order: 2, includeInDownload: "UNSET" }], [[7, [4, 2]]]);
  assert.match(M.LIBRARY_QUERY, /categories\(orderBy: ORDER\) \{ nodes \{ id name includeInDownload \} \}/);
  assert.deepEqual(c.categories, [{ id: 4, name: "Action", download: true }, { id: 2, name: "Romance", download: false }]);
  assert.deepEqual(c.manga[0].categories, [4, 2]);
});

test("without categories the switcher holds only All", () => {
  const switcher = M.switcher(library([], [[1, []], [2, []]]));
  assert.deepEqual(switcher.map((s) => s.name), ["All"]);
  assert.deepEqual(ids(switcher[0]), [1, 2]);
});

test("the switcher: All, Default for manga in no category, then each category; a manga shows under each of its categories", () => {
  const c = library([{ id: 4, name: "Action", order: 1 }, { id: 2, name: "Romance", order: 2 }], [[1, []], [2, [4]], [3, [4, 2]]]);
  const switcher = M.switcher(c);
  assert.deepEqual(switcher.map((s) => [s.id, s.name]), [[-1, "All"], [0, "Default"], [4, "Action"], [2, "Romance"]]);
  assert.deepEqual(switcher.map(ids), [[1, 2, 3], [1], [2, 3], [3]]);
});

test("the shown category falls back to All when its category is gone", () => {
  const c = library([{ id: 4, name: "Action", order: 1 }], [[1, [4]]]);
  assert.equal(M.switcherIndex(M.switcher(c), 4), 2);
  assert.equal(M.switcherIndex(M.switcher(c), 9), 0);
  assert.equal(M.switcherIndex(M.switcher(library([], [[1, []]])), 0), 0);
});

test("an empty category has its own notice; a filled library with an empty category is not 'empty'", () => {
  const c = library([{ id: 4, name: "Action", order: 1 }], [[1, []]]);
  const switcher = M.switcher(c);
  assert.equal(M.notice(c, "p", switcher[2]).title, "Action is empty");
  assert.equal(M.notice(c, "p", switcher[1]), null);
  const empty = library([], []);
  assert.equal(M.notice(empty, "p", M.switcher(empty)[0]).title, "Your library is empty");
});

test("a chapter to open at launch is two ids, else nothing", () => {
  assert.deepEqual(M.chapterTarget("12 345"), { mangaId: 12, chapterId: 345 });
  assert.equal(M.chapterTarget(""), null);
  assert.equal(M.chapterTarget("12"), null);
  assert.equal(M.chapterTarget("12 x"), null);
  assert.equal(M.chapterTarget("12 3.5"), null);
});
