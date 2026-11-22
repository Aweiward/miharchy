// The MIHARCHY_BACKEND=core path (ADR 0010, #377): core.json, core's replies,
// Session's core requests, and the Extensions view on core's routes.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load");
const M = load("Model.js");
const E = load("Extensions.js");
const B = load("Browse.js");
const W = load("Widgets.js");
const P = load("Prefs.js");

const core = { url: "http://127.0.0.1:4591", secret: "c0ffee", backend: "core" };
const suwayomi = { url: "http://127.0.0.1:4590", username: "u", password: "p" };

// A fake core: one route table, the secret checked as core checks it.
function install(routes) {
  const requests = [];
  globalThis.XMLHttpRequest = class {
    static DONE = 4;
    constructor() { this.readyState = 0; this.headers = {}; }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    getResponseHeader(k) { return k === "Content-Type" ? this.type : null; }
    send(body) {
      setImmediate(() => {
        if (this.readyState === 4) return;
        requests.push({ method: this.method, url: this.url, headers: this.headers, body });
        if (this.headers.Authorization !== "Bearer c0ffee") return this.finish(401, JSON.stringify({ error: { kind: "unauthorized", message: "secret" } }));
        if (this.method === "GET") return this.finish(200, "bytes", "image/png");
        const name = this.url.replace(/^.*\/api\//, "");
        const route = routes[name];
        if (!route) return this.finish(404, JSON.stringify({ error: { kind: "notFound", message: "There is no route " + name + "." } }));
        const out = route(JSON.parse(body));
        this.finish(out.error ? 502 : 200, JSON.stringify(out));
      });
    }
    abort() { this.finish(0, "", null); }
    finish(status, body, type) {
      this.readyState = 4;
      this.status = status;
      this.responseText = body;
      this.response = body;
      this.type = type;
      this.onreadystatechange();
    }
  };
  return requests;
}

test("core.json gives a core config, and anything else none", () => {
  assert.deepEqual(M.parseCoreConfig('{"url":"http://127.0.0.1:4591/","secret":"s"}'), { url: "http://127.0.0.1:4591", secret: "s", backend: "core" });
  for (const bad of ["", "{", '{"url":"x"}', '{"url":"","secret":"s"}', '{"url":"x","secret":""}', '{"url":"x","username":"u","password":"p"}']) {
    assert.equal(M.parseCoreConfig(bad), null, bad);
  }
  assert.equal(M.parseConfig('{"url":"x","secret":"s"}'), null, "server.json's parser does not take core.json");
});

test("core's replies keep the connection states and carry the error kind", () => {
  assert.deepEqual(M.coreReply(200, '{"repos":[]}'), { state: "ok", message: "", data: { repos: [] }, kind: "" });
  assert.equal(M.coreReply(0, "").state, "down");
  assert.deepEqual(M.coreReply(401, '{"error":{"kind":"unauthorized","message":"x"}}'), { state: "unauthorized", message: "", data: null, kind: "unauthorized" });
  const cf = M.coreReply(502, '{"error":{"kind":"cloudflare","message":"https://x shows a Cloudflare challenge."}}');
  assert.equal(cf.state, "error");
  assert.equal(cf.kind, "cloudflare");
  assert.equal(cf.message, "https://x shows a Cloudflare challenge.");
  assert.equal(M.coreReply(500, "<html>").message, "miharchy-core answered HTTP 500.");
  assert.equal(M.coreReply(200, "nope").message, "miharchy-core sent a reply that is not JSON.");
});

test("a core view words its own failures", () => {
  const path = "/home/u/.config/miharchy/core.json";
  assert.equal(M.problem({ state: "down" }, path, "core").title, "miharchy-core is not running");
  assert.match(M.problem({ state: "down" }, path, "core").detail, /systemctl --user start miharchy-core/);
  assert.match(M.problem({ state: "unauthorized" }, path, "core").detail, /secret in \/home\/u\/\.config\/miharchy\/core\.json/);
  assert.match(M.problem({ state: "no-config" }, path, "core").detail, /core\.json is missing/);
  assert.equal(M.problem({ state: "ok" }, path, "core"), null);
  assert.equal(M.problem({ state: "down" }, "server.json").title, "The server is not running", "Suwayomi's wording stays");
});

test("a core request is one POST with the secret, and never a login", async () => {
  const requests = install({ "extension.list": () => ({ repos: [], extensions: [], errors: [] }) });
  const S = load("Session.js");
  const reply = await new Promise((resolve) => S.send(core, { route: "extension.list" }, resolve));
  assert.equal(reply.state, "ok");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url, "http://127.0.0.1:4591/api/extension.list");
  assert.equal(requests[0].headers.Authorization, "Bearer c0ffee");
  assert.equal(requests[0].body, "{}");
  assert.ok(!requests[0].url.includes("c0ffee"), "the secret never goes in a URL");

  const refused = await new Promise((resolve) => S.send(Object.assign({}, core, { secret: "wrong" }), { route: "extension.list" }, resolve));
  assert.equal(refused.state, "unauthorized");
  assert.equal(requests.length, 2, "a refused secret is not retried and starts no login");

  const img = await new Promise((resolve) => S.image(core, core.url + "/api/cover/1", resolve));
  assert.deepEqual([img.status, img.contentType], [200, "image/png"]);
  assert.equal(requests[2].headers.Authorization, "Bearer c0ffee");
});

test("a request for the other server fails before it leaves", async () => {
  const requests = install({});
  const S = load("Session.js");
  const a = await new Promise((resolve) => S.send(core, { query: "{ mangas { totalCount } }" }, resolve));
  assert.equal(a.state, "error");
  assert.match(a.message, /GraphQL, but this view talks to miharchy-core/);
  const b = await new Promise((resolve) => S.send(suwayomi, { route: "extension.list" }, resolve));
  assert.match(b.message, /for miharchy-core, but this view talks to Suwayomi/);
  assert.equal(requests.length, 0);
});

// --- The Extensions view on core ---

const KEY = "https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.json";
const ok = (data) => M.coreReply(200, JSON.stringify(data));
const step = (s, data) => E.reduce(s, { type: "reply", reply: ok(data), config: core });
const ext = (o) => Object.assign({
  pkgName: "eu.kanade.tachiyomi.extension.en." + o.name.toLowerCase(), name: o.name, lang: "en", versionName: "1.6.4",
  iconUrl: "https://raw.githubusercontent.com/keiyoushi/extensions/repo/icon/x.png", isInstalled: false, hasUpdate: false,
  isObsolete: false, contentWarning: "SAFE", storeIndexUrl: KEY
}, o);
const MANGADEX = ext({ name: "MangaDex", lang: "all", isInstalled: true, hasUpdate: true, contentWarning: "MIXED",
  sources: [{ id: "2", displayName: "MangaDex (JA)", lang: "ja", isConfigurable: true }, { id: "1", displayName: "MangaDex (EN)", lang: "en", isConfigurable: true }] });
const LIST = { repos: [{ indexUrl: KEY, name: "Keiyoushi" }], extensions: [MANGADEX, ext({ name: "Asura" })], errors: [] };

test("on core, a first load adds Keiyoushi once, sets the flag, then lists", () => {
  let s = E.reduce(E.initial(true), { type: "load" });
  assert.deepEqual(E.next(s), { route: "meta.get", body: { scope: "global", keys: [E.PRESET_META] } });
  s = step(s, { metas: [] });
  assert.deepEqual(E.next(s), { route: "extensionRepo.list" });
  s = step(s, { repos: [] });
  assert.deepEqual(E.next(s), { route: "extensionRepo.add", body: { url: E.KEIYOUSHI } });
  s = step(s, { repo: { indexUrl: KEY, name: "Keiyoushi" } });
  assert.deepEqual(E.next(s), { route: "meta.set", body: { metas: [{ scope: "global", key: E.PRESET_META, value: "true" }] } });
  s = step(s, { metas: [] });
  assert.deepEqual(E.next(s), { route: "extension.list" });
  s = step(s, LIST);
  assert.equal(s.state, "ok");
  assert.deepEqual(s.repos, [{ url: KEY, name: "Keiyoushi" }]);
  assert.equal(E.next(s), null);
  assert.deepEqual(E.rows(s, {}).map((r) => r.title), ["Keiyoushi", "MangaDex", "Asura"]);
  assert.equal(E.find(s, MANGADEX.pkgName).icon, MANGADEX.iconUrl, "a repo icon stays an outside address");
});

test("on core, a set flag or a repo skips the preset", () => {
  let s = step(E.reduce(E.initial(true), { type: "load" }), { metas: [{ scope: "global", owner: 0, key: E.PRESET_META, value: "true" }] });
  assert.deepEqual(E.next(s), { route: "extension.list" });
  s = step(E.reduce(E.initial(true), { type: "load" }), { metas: [] });
  s = step(s, { repos: [{ indexUrl: KEY, name: "Keiyoushi" }] });
  assert.deepEqual(E.next(s), { route: "extension.list" });
});

function loaded(list = LIST) {
  let s = step(E.reduce(E.initial(true), { type: "load" }), { metas: [{ key: E.PRESET_META, value: "true" }] });
  return step(s, list);
}

test("on core, a repo that failed to fetch shows its message", () => {
  const s = loaded(Object.assign({}, LIST, { errors: [{ indexUrl: KEY, message: "Could not reach " + KEY + "." }] }));
  assert.equal(s.state, "ok");
  assert.equal(s.repoError, "Could not reach " + KEY + ".");
});

test("on core, actions and repos use core's routes", () => {
  assert.deepEqual(E.actionPayload("p", "install", true), { route: "extension.install", body: { pkgName: "p" } });
  assert.deepEqual(E.actionPayload("p", "update", true), { route: "extension.update", body: { pkgName: "p" } });
  assert.deepEqual(E.actionPayload("p", "uninstall", true), { route: "extension.remove", body: { pkgName: "p" } });
  assert.deepEqual(E.addRepoPayload("https://r/index.min.json", true), { route: "extensionRepo.add", body: { url: "https://r/index.min.json" } });
  assert.deepEqual(E.removeRepoPayload({ url: KEY }, true), { route: "extensionRepo.remove", body: { url: KEY } });
  assert.deepEqual(E.updateAll(loaded()).payload, { route: "extension.updateAll", body: { pkgNames: [MANGADEX.pkgName] } });
});

test("on core, action replies update the row, and a null uninstall drops it", () => {
  let s = loaded();
  const asura = ext({ name: "Asura" }).pkgName;
  s = E.reduce(s, { type: "action", pkgName: asura, action: "install" });
  s = E.reduce(s, { type: "action-reply", pkgName: asura, config: core, reply: ok({ extension: ext({ name: "Asura", isInstalled: true }) }) });
  assert.equal(E.find(s, asura).installed, true);
  s = E.reduce(s, { type: "action-reply", pkgName: asura, config: core, reply: ok({ extension: null }) });
  assert.equal(E.find(s, asura), null);

  s = E.reduce(s, { type: "update-all", pkgNames: [MANGADEX.pkgName] });
  s = E.reduce(s, { type: "update-all-reply", pkgNames: [MANGADEX.pkgName], config: core, reply: ok({ extensions: [Object.assign({}, MANGADEX, { hasUpdate: false, versionName: "1.6.5" })] }) });
  assert.equal(E.find(s, MANGADEX.pkgName).version, "1.6.5");
  assert.equal(E.find(s, MANGADEX.pkgName).hasUpdate, false);

  const failed = E.reduce(E.reduce(s, { type: "action", pkgName: MANGADEX.pkgName, action: "update" }),
    { type: "action-reply", pkgName: MANGADEX.pkgName, config: core, reply: M.coreReply(400, '{"error":{"kind":"invalid","message":"not signed with its repo\'s key"}}') });
  assert.equal(failed.errors[MANGADEX.pkgName], "not signed with its repo's key");
});

test("on core, details come from the list with no request, and settings open on core", () => {
  const s = loaded();
  const d = E.details(MANGADEX.pkgName, s);
  assert.equal(d.state, "ok");
  assert.equal(E.detailsPayload(d), null);
  assert.deepEqual(d.sources.map((x) => x.name), ["MangaDex (EN)", "MangaDex (JA)"]);
  const opened = E.detailsAction(s, d, "extension.settings").settings;
  assert.deepEqual(opened, { id: "1", name: "MangaDex (EN)", lang: "en", configurable: true, core: true });
  assert.deepEqual(W.loadPayload(W.panel("preferences", opened)), { route: "source.settings", body: { source: "1" } });
  assert.ok(E.detailsPayload(E.details(MANGADEX.pkgName)).query, "Suwayomi still asks");
});

// --- Browse on core ---

const SOURCES = [
  { id: "2499283573021220255", displayName: "MangaDex (EN)", name: "MangaDex", lang: "en", iconUrl: "https://raw.githubusercontent.com/k/icon.png", contentWarning: "MIXED", supportsLatest: true, isConfigurable: true },
  { id: "77", displayName: "Raw (JA)", name: "Raw", lang: "ja", iconUrl: null, contentWarning: "SAFE", supportsLatest: false, isConfigurable: false }
];

test("on core, the sources come from source.list and carry core", () => {
  assert.deepEqual(B.sourcesPayload(true), { route: "source.list" });
  assert.ok(B.sourcesPayload(false).query, "Suwayomi still asks GraphQL");
  const s = B.sources(ok({ sources: SOURCES }), core, false, true);
  assert.equal(s.state, "ok");
  assert.deepEqual(s.sources[0], { id: "2499283573021220255", name: "MangaDex (EN)", lang: "en", icon: "https://raw.githubusercontent.com/k/icon.png", warning: "MIXED", supportsLatest: true, configurable: true, core: true });
  assert.equal(B.sources(ok({ sources: SOURCES }), core, false, false).sources.length, 1, "the language rule holds");
});

test("on core, a listing pages through source routes and reads core's reply", () => {
  const src = B.sources(ok({ sources: SOURCES }), core, false, true).sources;
  let l = B.listing(src[0], "popular", "");
  assert.deepEqual(B.listingPayload(l), { route: "source.popular", body: { source: "2499283573021220255", page: 1 } });
  l = B.reduceListing(B.reduceListing(l, { type: "request" }), { type: "reply", config: core, reply: ok({ hasNextPage: true, mangas: [{ id: 5, title: "A", thumbnailUrl: "/api/cover/5", inLibrary: false }] }) });
  assert.deepEqual(l.items, [{ id: 5, title: "A", cover: "http://127.0.0.1:4591/api/cover/5", inLibrary: false }]);
  assert.deepEqual(B.listingPayload(l).body.page, 2);
  // A source without latest falls back to popular, as on Suwayomi.
  assert.equal(B.listingPayload(B.listing(src[1], "latest", "")).route, "source.popular");
  const states = [{ state: 1 }];
  assert.equal(B.listing(src[0], "search", "x", [{}, { state: 1 }], 1).filterCount, 1, "the count is the changed filters, not the states sent");
  assert.deepEqual(B.listingPayload(B.listing(src[0], "search", "one piece", states)), { route: "source.search", body: { source: "2499283573021220255", page: 1, query: "one piece", filters: states } });
  assert.deepEqual(B.listingPayload(B.listing(src[0], "search", "x", [])).body, { source: "2499283573021220255", page: 1, query: "x" }, "no filters changed, none sent");
  // Core's error kind marks a Cloudflare page.
  const cf = B.reduceListing(B.listing(src[0], "popular", ""), { type: "reply", config: core, reply: M.coreReply(502, '{"error":{"kind":"cloudflare","message":"https://x shows a Cloudflare challenge."}}') });
  assert.equal(cf.flare, true);
  assert.equal(cf.message, "https://x shows a Cloudflare challenge.");
});

const FILTERS = [
  { name: "Search by", type: "header" },
  { name: "Sort", type: "sort", values: ["Latest", "Title"], state: { index: 0, ascending: false } },
  { name: "Status", type: "select", values: ["Any", "Ongoing"], state: 0 },
  { name: "", type: "separator" },
  { name: "Genres", type: "group", filters: [{ name: "Action", type: "tristate", state: 0 }, { name: "Safe", type: "checkbox", state: true }] },
  { name: "Author", type: "text", state: "" }
];

test("on core, filters parse from the host's JSON and go back as every state", () => {
  const src = { id: "9", name: "S", core: true };
  let p = W.panel("filters", src);
  assert.deepEqual(W.loadPayload(p), { route: "source.filters", body: { source: "9" } });
  p = W.reducePanel(p, { type: "reply", reply: ok({ filters: FILTERS }) });
  assert.equal(p.state, "ok");
  assert.deepEqual(p.widgets.map((w) => w.kind), ["header", "sort", "choice", "separator", "group", "text"]);
  assert.deepEqual(p.widgets[4].children.map((w) => [w.kind, w.value]), [["tristate", "IGNORE"], ["bool", true]]);
  assert.deepEqual(W.filterChanges(p.widgets, true), [], "nothing changed, nothing sent");

  const rows = W.rows(p.widgets, { "4": true });
  const action = rows.find((r) => r.label === "Action");
  let w = W.activate(p.widgets, action).widgets;
  w = W.activate(w, W.rows(w, { "2": true }).find((r) => r.label === "Ongoing")).widgets;
  w = W.setText(w, [5], "Oda");
  assert.equal(W.changedCount(w), 3);
  assert.deepEqual(W.filterChanges(w, true), [
    {}, { state: { index: 0, ascending: false } }, { state: 1 }, {},
    { filters: [{ state: 1 }, { state: true }] }, { state: "Oda" }
  ]);
  assert.deepEqual(W.filterChanges(W.reset(w), true), []);
});

const SETTINGS = [
  { key: "q", type: "list", title: "Quality", summary: "%s", enabled: true, entries: ["Data", "Data saver"], values: ["data", "data-saver"], value: "data" },
  { key: "nsfw", type: "switch", title: "Show NSFW", summary: "", enabled: true, value: false, summaryOn: "Shown", summaryOff: "Hidden" },
  { key: "langs", type: "multi", title: "Languages", summary: "", enabled: true, entries: ["English", "French"], values: ["en", "fr"], value: ["en"] },
  { key: "x", type: "text", title: "Blocked groups", summary: "", enabled: false, value: "" },
  { key: "about", type: "info", title: "About", summary: "Restart after a change.", enabled: true }
];

test("on core, settings parse from the host's JSON and save one by key", () => {
  const src = { id: "9", name: "S", core: true };
  let p = W.reducePanel(W.panel("preferences", src), { type: "reply", reply: ok({ settings: SETTINGS }) });
  assert.deepEqual(p.widgets.map((w) => [w.kind, w.value]), [["choice", 0], ["bool", false], ["multi", ["en"]], ["text", ""], ["header", null]]);
  const rows = W.rows(p.widgets, {});
  assert.equal(rows[0].summary, "Data");
  assert.equal(rows[1].summary, "Hidden");
  assert.equal(rows[3].enabled, false);
  assert.deepEqual([rows[4].label, rows[4].summary, rows[4].mark], ["About", "Restart after a change.", ""]);
  assert.deepEqual(W.activate(p.widgets, rows[4]), {}, "an info row takes no edit");

  const before = p.widgets;
  const quality = W.activate(p.widgets, W.rows(p.widgets, { "0": true })[2]).widgets;
  p = W.reducePanel(p, { type: "edit", widgets: quality });
  assert.deepEqual(W.savePayload(p, [0]), { route: "source.setSetting", body: { source: "9", key: "q", value: "data-saver" } });
  const on = W.activate(p.widgets, rows[1]).widgets;
  assert.deepEqual(W.savePayload(Object.assign({}, p, { widgets: on }), [1]).body, { source: "9", key: "nsfw", value: true });

  const saved = W.reducePanel(p, { type: "reply", before, reply: ok({ accepted: true, settings: SETTINGS.map((s) => s.key === "q" ? Object.assign({}, s, { value: "data-saver" }) : s) }) });
  assert.equal(saved.saved, true);
  assert.equal(saved.widgets[0].value, 1);
  // The extension refused it: the server's values show, with a reason.
  const refused = W.reducePanel(p, { type: "reply", before, reply: ok({ accepted: false, settings: SETTINGS }) });
  assert.equal(refused.widgets[0].value, 0);
  assert.equal(refused.error, "The extension did not take that value.");
  assert.equal(refused.saved, false);
});

test("on core, global choices live in core's global metas", () => {
  const table = [{ key: "pinnedSources", default: "[]" }];
  assert.deepEqual(P.loadPayload(table, undefined, true), { route: "meta.get", body: { scope: "global", keys: ["miharchy.pinnedSources"] } });
  assert.deepEqual(P.savePayload("pinnedSources", '["9"]', undefined, true), { route: "meta.set", body: { metas: [{ scope: "global", key: "miharchy.pinnedSources", value: '["9"]' }] } });
  assert.deepEqual(P.read(table, { metas: [{ scope: "global", owner: 0, key: "miharchy.pinnedSources", value: '["9"]' }] }, P.defaults(table)), { pinnedSources: '["9"]' });
  assert.ok(P.loadPayload(table).query, "Suwayomi still asks GraphQL");
});

// --- The manga detail and the reader on core ---

const C = load("Chapters.js");
const R = load("Reader.js");

test("on core, a manga's choices load with the global ones, and the manga's win by scope", () => {
  const table = [{ key: "chapterSort", default: "source" }, { key: "chapterFilterRead", default: "off" }];
  assert.deepEqual(P.loadPayload(table, 7, true), { route: "meta.get", body: { queries: [
    { scope: "global", keys: ["miharchy.chapterSort", "miharchy.chapterFilterRead"] },
    { scope: "manga", owners: [7], keys: ["miharchy.chapterSort", "miharchy.chapterFilterRead"] }
  ] } });
  const metas = [
    { scope: "manga", owner: 7, key: "miharchy.chapterSort", value: "number" },
    { scope: "global", owner: 0, key: "miharchy.chapterSort", value: "date" },
    { scope: "global", owner: 0, key: "miharchy.chapterFilterRead", value: "include" }
  ];
  assert.deepEqual(P.read(table, { metas }, P.defaults(table)), { chapterSort: "number", chapterFilterRead: "include" });
  assert.deepEqual(P.savePayload("notes", "good", 7, true), { route: "meta.set", body: { metas: [{ scope: "manga", owner: 7, key: "miharchy.notes", value: "good" }] } });
  assert.deepEqual(P.resetPayload(table, [7, 8], true), { route: "meta.delete", body: { scope: "manga", owners: [7, 8], keys: ["miharchy.chapterSort", "miharchy.chapterFilterRead"] } });
  assert.equal(P.resetPayload(table, [], true), null);
});

test("on core, marks are one chapter.update each", () => {
  const ch = [{ id: 1, read: false, lastPage: 0 }, { id: 2, read: true, lastPage: 4 }, { id: 3, read: true, lastPage: 0, bookmarked: true }];
  assert.deepEqual(C.markPayload(ch, true, true), { route: "chapter.update", body: { ids: [1], isRead: true } });
  assert.deepEqual(C.markPayload(ch, false, true), { route: "chapter.update", body: { ids: [2, 3], isRead: false, lastPageRead: 0 } });
  assert.equal(C.markPayload([ch[0]], false, true), null);
  assert.deepEqual(C.bookmarkPayload(ch, true), { route: "chapter.update", body: { ids: [1, 2], isBookmarked: true } });
  assert.deepEqual(C.bookmarkPayload([ch[2]], true), { route: "chapter.update", body: { ids: [3], isBookmarked: false } });
});

const MANGA = {
  id: 1, sourceId: "2499283573021220255", source: { displayName: "MangaDex (EN)" }, url: "/manga/x", realUrl: "https://mangadex.org/title/x",
  title: "Fire Mage", author: "A", artist: "B", description: "D", genre: ["Action"], status: "ONGOING", thumbnailUrl: "/api/cover/1",
  inLibrary: false, initialized: true, inLibraryAt: 0, categories: [3], meta: [{ key: "miharchy.notes", value: "hi" }],
  chapters: [
    { id: 11, name: "Ch. 1", realUrl: "https://mangadex.org/chapter/1", chapterNumber: 1, uploadDate: 1690000000000, isRead: true, isBookmarked: false, lastPageRead: 0, isDownloaded: false, scanlator: "G", sourceOrder: 1 },
    { id: 12, name: "Ch. 2", chapterNumber: 2, uploadDate: 1690000000000, isRead: false, isBookmarked: false, lastPageRead: 3, isDownloaded: false, scanlator: "G", sourceOrder: 2 }
  ]
};

test("on core, the detail reads manga.get, refreshes once from a source, and toggles the library", () => {
  let d = B.detail(1, true, true);
  assert.deepEqual(B.detailPayload(d), { route: "manga.get", body: { id: 1 } });
  d = B.reduceDetail(d, { type: "reply", config: core, now: 0, reply: ok({ manga: MANGA }) });
  assert.deepEqual(B.detailPayload(d), { route: "manga.refresh", body: { id: 1 } }, "opened from a source: one refresh");
  assert.equal(d.manga.cover, "http://127.0.0.1:4591/api/cover/1");
  assert.deepEqual(d.manga.categories, [3]);
  assert.equal(d.manga.notes, "hi");
  assert.deepEqual(d.chapters.map((c) => [c.id, c.read, c.lastPage]), [[12, false, 3], [11, true, 0]], "newest first");
  const { chapters, ...rest } = MANGA;
  d = B.reduceDetail(d, { type: "reply", config: core, now: 0, reply: ok({ manga: rest, chapters: chapters.concat([Object.assign({}, chapters[1], { id: 13, name: "Ch. 3", sourceOrder: 3 })]) }) });
  assert.equal(d.state, "ok");
  assert.equal(B.detailPayload(d), null);
  assert.equal(d.chapters[0].name, "Ch. 3");

  assert.deepEqual(B.libraryPayload(d), { route: "manga.update", body: { ids: [1], inLibrary: true } });
  const added = ok({ mangas: [Object.assign({}, rest, { inLibrary: true })] });
  assert.equal(B.libraryReply(added), true);
  d = B.reduceDetail(B.reduceDetail(d, { type: "library-request" }), { type: "library-reply", reply: added });
  assert.equal(d.manga.inLibrary, true);

  // A missing source: no extension lookup on core.
  const gone = B.reduceDetail(B.detail(1, false, true), { type: "reply", config: core, now: 0, reply: ok({ manga: Object.assign({}, MANGA, { source: null }) }) });
  assert.equal(gone.step, null);
  assert.equal(gone.manga.missing, true);
});

test("on core, a Cloudflare page says core cannot pass it yet", () => {
  const n = B.notice({ core: true, state: "error", message: "x", flare: true }, "core.json");
  assert.match(n.detail, /#361/);
  assert.equal(B.notice({ core: true, state: "down" }, "core.json").title, "miharchy-core is not running");
  assert.equal(B.notice({ state: "error", message: "x", flare: true }, "server.json").title, "This source needs FlareSolverr");
});

test("on core, the reader loads pages, saves, bookmarks and keeps its mode on core, and pushes no tracker", () => {
  const ch = B.toChapters(MANGA.chapters);
  let r = R.open(1, ch, 12, "paged-rtl", false, "Fire Mage", false, true);
  assert.deepEqual(R.pagesPayload(r), { route: "chapter.pages", body: { id: 12 } });
  r = R.reduce(r, { type: "pages", config: core, now: 0, reply: ok({ pages: ["/api/page/12/0", "/api/page/12/1", "/api/page/12/2", "/api/page/12/3", "/api/page/12/4"], chapter: { id: 12, isRead: false, lastPageRead: 3 } }) });
  assert.equal(r.state, "ok");
  assert.equal(r.page, 3, "resumes on the page core kept");
  assert.equal(r.pages[0], "http://127.0.0.1:4591/api/page/12/0");
  assert.deepEqual(R.savePayload(r), { route: "chapter.update", body: { lastPageRead: 3, ids: [12] } });
  r = R.reduce(r, { type: "turn", delta: 1 });
  assert.deepEqual(R.savePayload(r), { route: "chapter.update", body: { lastPageRead: 4, isRead: true, ids: [12] } });
  assert.equal(R.trackPayload(r), null);
  assert.deepEqual(R.bookmarkPayload(r), { route: "chapter.update", body: { ids: [12], isBookmarked: true } });
  assert.deepEqual(R.modePayload(r), { route: "meta.set", body: { metas: [{ scope: "manga", owner: 1, key: "miharchy.readingMode", value: "paged-rtl" }] } });
  // Incognito saves nothing, on core too.
  const quiet = R.reduce(R.open(1, ch, 12, "paged-rtl", true, "", false, true), { type: "pages", config: core, now: 0, reply: ok({ pages: ["/api/page/12/0"], chapter: { id: 12, isRead: false, lastPageRead: 0 } }) });
  assert.equal(R.savePayload(quiet), null);
});

const L = load("Library.js");
const Cat = load("Categories.js");

// One manga as core's library.list sends it (Library.kt), and as Suwayomi's
// LIBRARY_QUERY sends the same manga.
const coreManga = {
  id: 1, title: "Manga 1", author: "A", artist: "B", genre: ["Action"], status: "ONGOING",
  thumbnailUrl: "/api/cover/1", sourceId: "7", source: { id: "7", displayName: "MangaDex (EN)", lang: "en" },
  inLibraryAt: 1700000000, chapterCount: 3, unreadCount: 2, bookmarkCount: 1, downloadCount: 0, trackCount: 0,
  lastReadChapter: { lastReadAt: 1700000500 }, latestUploadedChapter: { uploadDate: 1690000000000 },
  latestFetchedChapter: { fetchedAt: 1700000100 }, categories: [2], meta: []
};
const suwayomiManga = Object.assign({}, coreManga, {
  thumbnailUrl: "/api/v1/manga/1/thumbnail", chapters: { totalCount: 3 }, trackRecords: { totalCount: 0 }, categories: { nodes: [{ id: 2 }] }
});
const coreCategories = [
  { id: 0, name: "Default", includeInUpdate: "UNSET", includeInDownload: "UNSET", meta: [] },
  { id: 2, name: "Drama", includeInUpdate: "EXCLUDE", includeInDownload: "UNSET", meta: [{ key: "miharchy.keepDownloads", value: "true" }] }
];

test("on core, the Library reads library.list into the same manga and categories as Suwayomi's reply", () => {
  assert.deepEqual(M.libraryPayload(true), { route: "library.list" });
  assert.equal(typeof M.libraryPayload(false).query, "string");
  const fromCore = M.reduce(M.initial(), { type: "response", config: core, reply: { state: "ok", data: { categories: coreCategories, mangas: [coreManga] } } });
  const fromSuwayomi = M.reduce(M.initial(), { type: "response", config: suwayomi, reply: { state: "ok", data: {
    categories: { nodes: coreCategories }, metas: { nodes: [] }, mangas: { nodes: [suwayomiManga] } } } });
  assert.equal(fromCore.state, "ok");
  const strip = (m) => Object.assign({}, m, { cover: "" });
  assert.deepEqual(fromCore.manga.map(strip), fromSuwayomi.manga.map(strip));
  assert.deepEqual(fromCore.categories, fromSuwayomi.categories);
  assert.deepEqual(fromCore.categories, [{ id: 2, name: "Drama", download: "UNSET", update: "EXCLUDE", keep: true }]);
  assert.equal(fromCore.manga[0].cover, "http://127.0.0.1:4591/api/cover/1");
  assert.deepEqual([fromCore.manga[0].read, fromCore.manga[0].lastRead, fromCore.manga[0].latestUpload], [1, 1700000500, 1690000000000]);
  const broken = M.reduce(M.initial(), { type: "response", config: core, reply: { state: "ok", data: {} } });
  assert.equal(broken.state, "error");
});

test("on core, the Library's and Categories' changes go to core's routes", () => {
  assert.deepEqual(L.chaptersPayload([1, 2], true), { route: "chapter.list", body: { mangaIds: [1, 2] } });
  assert.deepEqual(L.chapterNodes({ chapters: [{ id: 5 }] }), [{ id: 5 }]);
  assert.deepEqual(L.chapterNodes({ chapters: { nodes: [{ id: 5 }] } }), [{ id: 5 }]);
  assert.deepEqual(L.removePayload([1], true), { route: "manga.update", body: { ids: [1], inLibrary: false } });
  assert.deepEqual(L.categoryPayload({ id: 2, state: "all" }, [1], true), { route: "manga.update", body: { ids: [1], removeFromCategories: [2] } });
  assert.deepEqual(L.categoryPayload({ id: 2, state: "some" }, [1], true), { route: "manga.update", body: { ids: [1], addToCategories: [2] } });
  assert.deepEqual(L.moveToPayload(1, 0, [{ id: 2 }], true), { route: "manga.update", body: { ids: [1], clearCategories: true, addToCategories: [] } });
  assert.equal(typeof L.removePayload([1]).query, "string");

  const cats = [{ id: 2, name: "Drama", download: "UNSET", update: "UNSET", keep: false }, { id: 3, name: "Action", download: "UNSET", update: "UNSET", keep: false }];
  assert.deepEqual(Cat.createPayload("New", true), { route: "category.create", body: { name: "New" } });
  assert.equal(Cat.createdId({ category: { id: 9 } }), 9);
  assert.equal(Cat.createdId({ createCategory: { category: { id: 9 } } }), 9);
  assert.deepEqual(Cat.renamePayload(2, "X", true), { route: "category.update", body: { id: 2, name: "X" } });
  assert.deepEqual(Cat.deletePayload(2, true), { route: "category.delete", body: { id: 2 } });
  assert.deepEqual(Cat.includePayload(cats, 2, "update", true), { route: "category.update", body: { id: 2, includeInUpdate: "INCLUDE" } });
  assert.deepEqual(Cat.keepPayload(cats, 3, true), { route: "meta.set", body: { metas: [{ scope: "category", owner: 3, key: "miharchy.keepDownloads", value: "true" }] } });
  assert.deepEqual(Cat.movePayload(cats, 1, -1, true), { route: "category.reorder", body: { id: 3, position: 1 } });
  assert.equal(Cat.movePayload(cats, 0, -1, true), null);
});

test("on core, the detail's category toggle sends manga.update and reads core's reply", () => {
  let d = Object.assign(B.detail(1, false, true), { manga: { inLibrary: true, categories: [2] } });
  assert.deepEqual(B.categoryPayload(d, 2), { route: "manga.update", body: { ids: [1], removeFromCategories: [2] } });
  assert.deepEqual(B.categoryPayload(d, 3), { route: "manga.update", body: { ids: [1], addToCategories: [3] } });
  d = B.reduceDetail(d, { type: "categories-reply", reply: { state: "ok", data: { mangas: [{ id: 1, categories: [2, 3] }] } } });
  assert.deepEqual(d.manga.categories, [2, 3]);
});

const U = load("UpNext.js");
const RC = load("ReadingCard.js");

test("on core, Up next loads the library, its chapters and the global chapter prefs, and lists as on Suwayomi", () => {
  const sent = [];
  const replies = {
    "library.list": { mangas: [{ id: 1, title: "A", inLibraryAt: 100, source: { id: "7" }, meta: [] }, { id: 2, title: "B", inLibraryAt: 100, source: { id: "7" }, meta: [] }], categories: [] },
    "chapter.list": { chapters: [
      { id: 10, mangaId: 1, name: "Ch. 1", chapterNumber: 1, sourceOrder: 0, isRead: true, isBookmarked: false, lastPageRead: 0, pageCount: 5, lastReadAt: 200, fetchedAt: 50, uploadDate: 0, scanlator: null, isDownloaded: false },
      { id: 11, mangaId: 1, name: "Ch. 2", chapterNumber: 2, sourceOrder: 1, isRead: false, isBookmarked: false, lastPageRead: 3, pageCount: 9, lastReadAt: 300, fetchedAt: 50, uploadDate: 0, scanlator: null, isDownloaded: false },
      { id: 20, mangaId: 2, name: "Ch. 1", chapterNumber: 1, sourceOrder: 0, isRead: false, isBookmarked: false, lastPageRead: 0, pageCount: 0, lastReadAt: 0, fetchedAt: 50, uploadDate: 0, scanlator: null, isDownloaded: false }
    ] },
    "meta.get": { metas: [] }
  };
  let out;
  U.load((p, done) => { sent.push(p); done({ state: "ok", data: replies[p.route] }); }, true, (r) => { out = r; });
  assert.deepEqual(sent.map((p) => p.route), ["library.list", "chapter.list", "meta.get"]);
  assert.deepEqual(sent[1].body, { mangaIds: [1, 2] });
  assert.equal(sent[2].body.scope, "global");
  const list = U.list(out.data, false, 1e6 * 1000);
  assert.deepEqual(list.map((e) => [e.mangaId, e.chapterId, e.tier, e.page, e.pages]), [[1, 11, 1, 3, 9]]);
  let failed;
  U.load((p, done) => done(p.route === "chapter.list" ? { state: "down", message: "x" } : { state: "ok", data: replies[p.route] }), true, (r) => { failed = r; });
  assert.equal(failed.state, "down");
  const empty = [];
  let none;
  U.load((p, done) => { empty.push(p.route); done({ state: "ok", data: { mangas: [], categories: [] } }); }, true, (r) => { none = r; });
  assert.deepEqual(empty, ["library.list"]);
  assert.deepEqual(U.list(none.data, false, 1e6 * 1000), []);
  U.load((p, done) => { sent.push(p); done({ state: "ok", data: {} }); }, false, () => {});
  assert.equal(typeof sent[sent.length - 1].query, "string");
});

test("on core, the reading card pages core's read history by offset", () => {
  assert.deepEqual(RC.payload(null, true), { route: "history.list", body: { readOnly: true, limit: 200, offset: 0 } });
  assert.deepEqual(RC.payload(200, true).body.offset, 200);
  const data = { chapters: [{ id: 1, isRead: true, lastReadAt: 500, manga: { id: 3, thumbnailUrl: "/api/cover/3", inLibrary: true, unreadCount: 2 } }], hasNextPage: true };
  assert.deepEqual(RC.rows(data), [{ at: 500, mangaId: 3, thumbnailUrl: "/api/cover/3", inLibrary: true, unread: 2 }]);
  assert.deepEqual(RC.pageInfo(data, 200), { hasNextPage: true, endCursor: 400 });
  assert.deepEqual(RC.pageInfo({ chapters: { pageInfo: { hasNextPage: false, endCursor: "c" }, nodes: [] } }), { hasNextPage: false, endCursor: "c" });
  assert.equal(RC.card(RC.rows(data), 600, core).covers[0], "http://127.0.0.1:4591/api/cover/3");
});
