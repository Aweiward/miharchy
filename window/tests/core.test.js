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

test("on core, the reader loads pages, saves, bookmarks and keeps its mode on core, and pushes the trackers on core", () => {
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
  assert.deepEqual(R.trackPayload(r), { route: "track.progress", body: { mangaIds: [1] } });
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

const H = load("History.js");

test("on core, History loads the cleared cutoff and history.list, hides and clears through meta.set", () => {
  const sent = [];
  const replies = {
    "meta.get": { metas: [{ scope: "global", owner: 0, key: H.CLEARED_KEY, value: "100" }] },
    "history.list": { hasNextPage: false, chapters: [
      { id: 12, name: "Ch. 2", lastReadAt: 300, lastPageRead: 4, pageCount: 9, isRead: false, manga: { id: 3, title: "A", thumbnailUrl: "/api/cover/3", meta: [] } },
      { id: 11, name: "Ch. 1", lastReadAt: 250, lastPageRead: 0, pageCount: 9, isRead: true, manga: { id: 3, title: "A", thumbnailUrl: "/api/cover/3", meta: [] } },
      { id: 20, name: "Ch. 1", lastReadAt: 200, lastPageRead: 1, pageCount: 0, isRead: false, manga: { id: 4, title: "B", thumbnailUrl: null, meta: [{ key: H.HIDDEN_KEY, value: "200" }] } },
      { id: 30, name: "Ch. 1", lastReadAt: 90, lastPageRead: 1, pageCount: 0, isRead: false, manga: { id: 5, title: "C", thumbnailUrl: null, meta: [] } }
    ] }
  };
  let reply;
  H.load((p, done) => { sent.push(p); done({ state: "ok", data: replies[p.route] }); }, true, (r) => { reply = r; });
  assert.deepEqual(sent, [{ route: "meta.get", body: { scope: "global", keys: [H.CLEARED_KEY] } }, { route: "history.list", body: { limit: 500 } }]);
  const h = H.reduce(H.initial(), { type: "reply", reply, config: core });
  assert.deepEqual(h.entries.map((e) => [e.mangaId, e.chapterId, e.page, e.at]), [[3, 12, 4, 300]]);
  assert.equal(h.entries[0].cover, "http://127.0.0.1:4591/api/cover/3");
  assert.deepEqual(H.removePayload(h.entries[0], true), { route: "meta.set", body: { metas: [{ scope: "manga", owner: 3, key: H.HIDDEN_KEY, value: "300" }] } });
  assert.deepEqual(H.clearPayload(h.entries, true), { route: "meta.set", body: { metas: [{ scope: "global", key: H.CLEARED_KEY, value: "300" }] } });
  assert.equal(H.clearPayload([], true), null);
  let failed;
  H.load((p, done) => done(p.route === "history.list" ? { state: "down" } : { state: "ok", data: replies[p.route] }), true, (r) => { failed = r; });
  assert.equal(failed.state, "down");
  assert.equal(H.notice(H.reduce(H.initial(), { type: "reply", reply: { state: "down" } }), "core.json", "", "core").title, "miharchy-core is not running");
  const suwa = [];
  H.load((p, done) => suwa.push(p), false, () => {});
  assert.deepEqual(suwa, [{ query: H.QUERY }]);
});

const D = load("Downloads.js");
const N = load("NextChapters.js");
const LV = load("Live.js");
const F = load("Failure.js");

const coreItem = (id, state, extra) => Object.assign({ state, progress: 0.5, tries: 1, error: null,
  chapter: { id, name: "Ch. " + id, mangaId: 3, chapterNumber: id, uploadDate: 1000 }, manga: { id: 3, title: "A", source: { id: "7" } } }, extra);

test("on core, the Downloads view reads the plain status from routes and the topic", () => {
  const reply = { state: "ok", data: { state: "STARTED", queue: [coreItem(1, "DOWNLOADING"), coreItem(2, "ERROR", { error: { kind: "source", message: "timeout" } })] } };
  const q = D.reduce(D.initial(), { type: "reply", reply });
  assert.equal(q.running, true);
  assert.deepEqual(q.items.map((i) => [i.chapterId, i.state]), [[1, "DOWNLOADING"], [2, "ERROR"]]);
  const live = D.reduce(q, { type: "live", data: { state: "STOPPED", queue: [coreItem(2, "ERROR")] } });
  assert.equal(live.running, false);
  assert.deepEqual(live.items.map((i) => i.chapterId), [2]);
  assert.equal(D.omitted({ state: "STOPPED", queue: [] }), false);
  // The reason comes with the item: nothing is probed.
  const f = D.failed(q.items, {}, true);
  assert.deepEqual(f.probe, []);
  assert.deepEqual(f.reasons[2], { kind: "network", text: "No connection to the source" });
  assert.deepEqual(D.failed([D.reduce(D.initial(), { type: "reply", reply: { state: "ok", data: { state: "STOPPED", queue: [coreItem(5, "ERROR")] } } }).items[0]], {}, true).reasons[5], { kind: "other", text: "Unknown error" });
  // The delete reply carries the status too.
  assert.equal(D.statusText(q.items[1], f.reasons[2], false, true), D.progressText(q.items[1]) + "   No connection to the source", "no Suwayomi hint on core");
  const del = D.reduce(q, { type: "reply", reply: { state: "ok", data: { state: "STOPPED", queue: [], chapters: [{ id: 1, isDownloaded: false }] } } });
  assert.deepEqual(del.items, []);
});

test("on core, every download payload is a route", () => {
  const chapters = [{ id: 1, downloaded: false }, { id: 2, downloaded: true }];
  const items = D.reduce(D.initial(), { type: "reply", reply: { state: "ok", data: { state: "STARTED", queue: [coreItem(1, "QUEUED"), coreItem(9, "QUEUED")] } } });
  assert.deepEqual(D.statusPayload(true), { route: "download.queue" });
  assert.deepEqual(D.statusPayload(false), { query: D.STATUS_QUERY });
  assert.deepEqual(D.clearPayload(true), { route: "download.clear" });
  assert.deepEqual(D.enqueuePayload(chapters, true), { route: "download.enqueue", body: { ids: [1] } });
  assert.equal(D.enqueuePayload([chapters[1]], true), null);
  assert.deepEqual(D.removePayload(chapters, items.items, true), { route: "download.delete", body: { ids: [1, 2] } });
  assert.equal(D.removePayload([{ id: 5, downloaded: false }], items.items, true), null);
  assert.deepEqual(D.dequeuePayload(1, true), { route: "download.dequeue", body: { ids: [1] } });
  assert.deepEqual(D.retryPayload([2], true), { route: "download.enqueue", body: { ids: [2] } });
  assert.deepEqual(D.togglePayload(items, true), { route: "download.stop" });
  assert.deepEqual(D.togglePayload({ running: false }, true), { route: "download.start" });
  assert.deepEqual(D.orderPayload(items, [9, 1], true), { route: "download.reorder", body: { order: [9, 1] } });
  assert.equal(D.orderPayload(items, [1, 9], true), null);
  assert.ok(D.enqueuePayload(chapters).query, "Suwayomi keeps its mutation");
});

test("on core, delete after read loads chapters and the categories' metas, and deletes by route", () => {
  const sent = [];
  const replies = {
    "chapter.list": { chapters: [
      { id: 1, mangaId: 3, isRead: true, isBookmarked: false, isDownloaded: true },
      { id: 2, mangaId: 4, isRead: true, isBookmarked: false, isDownloaded: true },
      { id: 3, mangaId: 3, isRead: false, isBookmarked: false, isDownloaded: true }
    ] },
    "library.list": { categories: [{ id: 7, meta: [{ key: D.KEEP_KEY, value: "true" }] }], mangas: [{ id: 3, categories: [] }, { id: 4, categories: [7] }] }
  };
  let reply;
  D.autoDeleteLoad((p, done) => { sent.push(p.route); done({ state: "ok", data: replies[p.route] }); }, true, [1, 2, 3], (r) => { reply = r; });
  assert.deepEqual(sent, ["chapter.list", "library.list"]);
  // Manga 4's category keeps its downloads; chapter 3 is unread.
  assert.deepEqual(D.autoDeletePayload(reply.data, false, [], true), { route: "download.delete", body: { ids: [1] } });
  assert.deepEqual(D.autoDeletePayload(reply.data, false, [3], true), { route: "download.delete", body: { ids: [1, 3] } });
  let down;
  D.autoDeleteLoad((p, done) => done(p.route === "library.list" ? { state: "down" } : { state: "ok", data: replies[p.route] }), true, [1], (r) => { down = r; });
  assert.equal(down.state, "down");
  const suwa = [];
  D.autoDeleteLoad((p) => suwa.push(p), false, [1], () => {});
  assert.deepEqual(suwa, [D.autoDeleteQuery([1])]);
});

test("on core, a next-chapters run refreshes, reads and settles through routes", () => {
  assert.deepEqual(N.refreshPayload(3, true), { route: "manga.refresh", body: { id: 3 } });
  const replies = {
    "chapter.list": { chapters: [
      { id: 1, mangaId: 3, name: "Ch. 1", chapterNumber: 1, uploadDate: 1, isRead: false, isBookmarked: false, lastPageRead: 0, isDownloaded: false, scanlator: null, sourceOrder: 1 },
      { id: 2, mangaId: 4, name: "Ch. 1", chapterNumber: 1, uploadDate: 1, isRead: false, isBookmarked: false, lastPageRead: 0, isDownloaded: true, scanlator: null, sourceOrder: 1 }
    ] },
    "meta.get": { metas: [] },
    "download.queue": { state: "STARTED", queue: [coreItem(5, "QUEUED")] }
  };
  const sent = [];
  const send = (p, done) => { sent.push(p); done({ state: "ok", data: replies[p.route] }); };
  let read;
  N.readLoad(send, true, [3, 4], (r) => { read = r; });
  assert.deepEqual(sent.map((p) => p.route), ["chapter.list", "meta.get"]);
  assert.deepEqual(sent[0].body, { mangaIds: [3, 4] });
  assert.deepEqual(read.data.mangas.nodes.map((m) => [m.id, m.chapters.nodes.map((c) => c.id)]), [[3, [1]], [4, [2]]]);
  assert.deepEqual(N.pick(read.data, { id: "unread" }, 0, []).map((c) => c.id), [1], "a chapter on disk is not queued again");
  let settled;
  N.settleLoad(send, true, { queued: [1, 2, 5] }, (r) => { settled = r; });
  assert.deepEqual(sent.slice(2).map((p) => p.route), ["download.queue", "chapter.list"]);
  assert.deepEqual(sent[3].body, { ids: [1, 2, 5] });
  // Core sends no DEQUEUED: a run chapter that left the queue settles at once.
  const run = { queued: [1, 2, 5] };
  assert.deepEqual(N.goneIds(run, [{ chapterId: 1 }, { chapterId: 9 }]), [1]);
  assert.deepEqual(N.goneIds(null, [{ chapterId: 1 }]), []);
  const gone = N.goneMarks({ 1: "seen", 2: "seen" }, [{ id: 1, isDownloaded: false }, { id: 2, isDownloaded: true }]);
  assert.deepEqual(gone, { 1: "out", 2: "disk" });
  assert.deepEqual(N.tally(run, [{ chapterId: 5, state: "QUEUED" }], gone), { onDisk: 1, queued: 1, failed: [] });
  // Out of the window's queue: on disk, still queued on core, or taken out.
  assert.deepEqual(N.settle({}, { queued: [1, 2, 5] }, [], settled.data), { 1: "out", 2: "disk" });
});

test("on core, the live socket sends the secret, then subscribes to its topic", () => {
  assert.equal(LV.coreUrl(core), "ws://127.0.0.1:4591/api/live");
  assert.deepEqual(LV.coreOpen("c0ffee", "downloads").map((m) => JSON.parse(m)), [{ secret: "c0ffee" }, { subscribe: "downloads" }]);
  assert.deepEqual(LV.parseCore(JSON.stringify({ topic: "downloads", data: { state: "STOPPED", queue: [] } }), "downloads"), { type: "data", data: { state: "STOPPED", queue: [] } });
  assert.deepEqual(LV.parseCore(JSON.stringify({ topic: "other", data: {} }), "downloads"), { type: "none" });
  assert.deepEqual(LV.parseCore(JSON.stringify({ type: "pong" }), "downloads"), { type: "none" });
  assert.deepEqual(LV.parseCore(JSON.stringify({ topic: "downloads", error: { kind: "notFound", message: "There is no topic downloads." } }), "downloads"), { type: "ended", message: "There is no topic downloads." });
  assert.deepEqual(LV.parseCore("not json", "downloads"), { type: "none" });
});

test("core's error kinds map to the window's failure reasons", () => {
  assert.equal(F.coreReason({ kind: "cloudflare", message: "https://x shows a Cloudflare challenge." }).kind, "cloudflare");
  assert.equal(F.coreReason({ kind: "cloudflare", message: "blocked" }).kind, "cloudflare");
  assert.deepEqual(F.coreReason({ kind: "network", message: "The source did not answer within 30 s." }), { kind: "network", text: "No connection to the source" });
  assert.equal(F.coreReason({ kind: "network", message: "The site answered HTTP 404." }).kind, "notFound");
  assert.equal(F.coreReason({ kind: "webview", message: "This source needs a WebView." }).kind, "other");
  assert.equal(F.coreReason({ kind: "source", message: "java.net.UnknownHostException: Unable to resolve host \"api.mangadex.org\"" }).kind, "network");
  assert.equal(F.coreReason({ kind: "notFound", message: "Source not installed" }).kind, "sourceMissing");
  assert.deepEqual(F.coreReason(null), { kind: "other", text: "Unknown error" });
  assert.deepEqual(F.coreReason({ kind: "source", message: "Page 2 of MangaDex is not an image." }), { kind: "other", text: "Page 2 of MangaDex is not an image." });
});

test("on core, the detail reads a delete's chapters beside the status", () => {
  const d = { chapters: [{ id: 1, downloaded: true }, { id: 2, downloaded: true }] };
  const next = B.reduceDetail(d, { type: "downloads-reply", reply: { state: "ok", data: { state: "STOPPED", queue: [], chapters: [{ id: 1, isDownloaded: false }] } } });
  assert.deepEqual(next.chapters.map((c) => c.downloaded), [false, true]);
  const enq = B.reduceDetail(d, { type: "downloads-reply", reply: { state: "ok", data: { state: "STARTED", queue: [] } } });
  assert.deepEqual(enq.chapters.map((c) => c.downloaded), [true, true]);
});

test("on core, a check for new chapters is update.start, with categories only when named", () => {
  const U = load("Updates.js");
  assert.deepEqual(U.checkPayload(null, true), { route: "update.start", body: {} });
  assert.deepEqual(U.checkPayload([0, 4], true), { route: "update.start", body: { categories: [0, 4] } });
  assert.match(U.checkPayload([4]).query, /updateLibrary/);
});

test("on core, Updates loads its list from library.list, chapter.list, update.status and the skip metas", () => {
  const U = load("Updates.js");
  const now = Date.UTC(2026, 10, 22);
  const sent = [];
  const replies = {
    "library.list": { mangas: [{ id: 1, title: "A", thumbnailUrl: "/api/cover/1", inLibraryAt: 100, categories: [3], meta: [] }] },
    "chapter.list": { chapters: [
      { id: 10, mangaId: 1, name: "Ch. 2", uploadDate: now - 1000, fetchedAt: 200, sourceOrder: 2, isRead: false, lastPageRead: 0, isBookmarked: false, isDownloaded: false },
      { id: 9, mangaId: 1, name: "Ch. 1", uploadDate: now - 200 * 86400000, fetchedAt: 200, sourceOrder: 1, isRead: false },
    ] },
    "update.status": { isRunning: false, finishedJobs: 3, totalJobs: 3, skippedMangasCount: 2, lastUpdateTimestamp: now - 60000, failed: [] },
    "meta.get": { metas: [{ scope: "global", owner: 0, key: "miharchy.excludeCompleted", value: "false" }] },
  };
  let out;
  U.load((p, done) => { sent.push(p); done({ state: "ok", data: replies[p.route] }); }, true, now, (r) => { out = r; });
  assert.deepEqual(sent.map((p) => p.route), ["library.list", "chapter.list", "update.status", "meta.get"]);
  assert.deepEqual(sent[1].body, { mangaIds: [1] });
  const u = U.reduce(U.initial(), { type: "list", reply: out, config: { url: "http://127.0.0.1:4591", secret: "s", backend: "core" }, now, prefs: { updatesFilterUnread: "include", updatesIncludedCategories: "[3]" } });
  assert.deepEqual(u.rows.map((r) => r.id), [10], "older than 3 months is history");
  assert.deepEqual([u.finished, u.total, u.skipped, u.checkedAt], [3, 3, 2, now - 60000]);
  assert.deepEqual(u.skipReasons, ["unread chapters", "not started"]);

  let failed;
  U.load((p, done) => done(p.route === "update.status" ? { state: "error", kind: "internal", message: "boom" } : { state: "ok", data: replies[p.route] }), true, now, (r) => { failed = r; });
  assert.equal(failed.message, "boom");
  let empty;
  U.load((p, done) => { assert.notEqual(p.route, "chapter.list"); done({ state: "ok", data: p.route === "library.list" ? { mangas: [] } : replies[p.route] }); }, true, now, (r) => { empty = r; });
  assert.deepEqual(empty.data.chapters.nodes, []);
});

test("on core, Updates follows the flat run status and stops with update.stop", () => {
  const U = load("Updates.js");
  assert.deepEqual(U.stopPayload(true), { route: "update.stop" });
  let u = U.reduce(U.initial(), { type: "checking" });
  // The start reply: core has no all-zero opening result.
  const running = U.reduce(u, { type: "live", data: { isRunning: true, finishedJobs: 0, totalJobs: 4, skippedMangasCount: 1, started: true } });
  assert.deepEqual([running.checking, running.running, running.total], [false, true, 4]);
  const done = U.reduce(running, { type: "live", data: { isRunning: false, finishedJobs: 4, totalJobs: 4, skippedMangasCount: 1 } });
  assert.ok(U.finished(running, done), "a run's end reloads the list");
  // A stop keeps its counts; core's status says so, before or after the stop's reply.
  const after = U.reduce(running, { type: "live", data: { isRunning: false, stopped: true, finishedJobs: 2, totalJobs: 4, skippedMangasCount: 1 } });
  assert.match(U.progress(after, Date.now()), /Stopped checking for new chapters at 2 \/ 4/);
  assert.equal(U.reduce(after, { type: "stopped" }).stopped, "2 / 4");
  assert.equal(U.reduce(U.reduce(running, { type: "stopped" }), { type: "live", data: { isRunning: false, stopped: true, finishedJobs: 3, totalJobs: 4 } }).stopped, "3 / 4");
  assert.equal(done.stopped, null, "an end is no stop");
  // An instant run of nothing ends the check too.
  assert.equal(U.reduce(u, { type: "live", data: { isRunning: false, finishedJobs: 0, totalJobs: 0, skippedMangasCount: 0 } }).checking, false);
  assert.equal(U.notice({ state: "no-config", rows: [] }, "/x/core.json", "core").title, M.problem({ state: "no-config" }, "/x/core.json", "core").title);
});

// #383: tracker logins and the tracking panel on core's routes.
const T = load("Trackers.js");
const S2 = load("Session.js");
const coreFail = (status, kind, message) => M.coreReply(status, JSON.stringify({ error: { kind, message } }));
// A send that answers each route from a table and records what went out.
function routeSend(routes, sent) {
  return (payload, done) => {
    sent.push(payload);
    assert.equal(typeof payload.route, "string", "only core routes: " + JSON.stringify(payload));
    const answer = routes[payload.route];
    setImmediate(() => done(typeof answer === "function" ? answer(payload.body || {}) : answer));
  };
}
const TRACKERS = [
  { id: 1, name: "MyAnimeList", isLoggedIn: false, authUrl: "https://myanimelist.net/v1/oauth2/authorize?client_id=x&code_challenge=c&response_type=code", scores: ["0", "1"], statuses: [{ value: 1, name: "Reading" }], supportsReadingDates: true, supportsPrivateTracking: false },
  { id: 2, name: "AniList", isLoggedIn: true, authUrl: null, scores: ["0", "7"], statuses: [{ value: 1, name: "Reading" }, { value: 3, name: "On hold" }], supportsReadingDates: true, supportsPrivateTracking: true },
  { id: 7, name: "MangaUpdates", isLoggedIn: false, authUrl: null, scores: [], statuses: [], supportsReadingDates: false, supportsPrivateTracking: false }
];

test("on core, Settings lists the trackers and logs in by callback and by password on core's routes", () => {
  let s = T.initial(true);
  assert.deepEqual(T.listPayload(true), { route: "tracker.list" });
  s = T.reduce(s, { type: "list", reply: ok({ trackers: TRACKERS }) });
  assert.deepEqual(s.list.map((t) => [t.id, t.loggedIn, t.authUrl !== ""]), [[1, false, true], [2, true, false], [7, false, false]]);

  // OAuth: the link is core's tracker list, then the pasted callback.
  s = T.begin(s, 0);
  assert.deepEqual(T.loginPayload(s), { route: "tracker.list" });
  s = T.reduce(T.reduce(s, { type: "sent" }), { type: "link", reply: ok({ trackers: TRACKERS }) });
  assert.equal(s.login.step, "paste");
  assert.equal(s.login.url, TRACKERS[0].authUrl);
  s = T.reduce(s, { type: "commit", text: "https://suwayomi.org/tracker-oauth?code=abc" });
  assert.deepEqual(T.loginPayload(s), { route: "tracker.login", body: { trackerId: 1, callbackUrl: "https://suwayomi.org/tracker-oauth?code=abc" } });
  // A refusal reads once, with core's own words, and asks for a fresh link.
  const refused = T.reduce(T.reduce(s, { type: "sent" }), { type: "reply", reply: coreFail(400, "invalid", "MyAnimeList did not accept the login.") });
  assert.equal(refused.login.error, "MyAnimeList did not accept the login. Press Esc, then Enter for a fresh link.");
  const loggedIn = T.reduce(T.reduce(s, { type: "sent" }), { type: "reply", reply: ok({ tracker: Object.assign({}, TRACKERS[0], { isLoggedIn: true, authUrl: null }) }) });
  assert.equal(loggedIn.login, null);
  assert.equal(loggedIn.list[0].loggedIn, true);

  // Username and password.
  let u = T.begin(T.reduce(T.initial(true), { type: "list", reply: ok({ trackers: TRACKERS }) }), 2);
  u = T.reduce(T.reduce(u, { type: "commit", text: "reader" }), { type: "commit", text: "pw" });
  assert.deepEqual(T.loginPayload(u), { route: "tracker.login", body: { trackerId: 7, username: "reader", password: "pw" } });

  // Logout.
  let o = T.begin(T.reduce(T.initial(true), { type: "list", reply: ok({ trackers: TRACKERS }) }), 1);
  assert.deepEqual(T.loginPayload(o), { route: "tracker.logout", body: { trackerId: 2 } });
  o = T.reduce(T.reduce(o, { type: "sent" }), { type: "reply", reply: ok({ tracker: Object.assign({}, TRACKERS[1], { isLoggedIn: false }) }) });
  assert.equal(o.list[1].loggedIn, false);

  // Suwayomi's state still builds GraphQL.
  assert.ok(T.loginPayload(T.begin(T.reduce(T.initial(), { type: "list", reply: ok({ trackers: { nodes: TRACKERS } }) }), 1)).query);
});

test("on core, the tracking panel loads, searches, binds, updates and unbinds on core's routes", async () => {
  const sent = [];
  const record = { id: 9, mangaId: 5, trackerId: 2, remoteId: 118586, title: "Frieren", status: 1, displayScore: "0", lastChapterRead: 3, totalChapters: 0, remoteUrl: "https://anilist.co/manga/118586", startDate: 0, finishDate: 0, private: false };
  const send = routeSend({
    "tracker.list": ok({ trackers: TRACKERS }),
    "track.list": (b) => { assert.deepEqual(b, { mangaIds: [5] }); return ok({ tracks: [record] }); }
  }, sent);
  let p = T.panel(5, "Frieren", true);
  const reply = await new Promise((resolve) => T.panelLoad(send, p, resolve));
  p = T.act(p, { type: "loaded", reply }).panel;
  // Logged in, or holding a track: AniList only.
  assert.deepEqual(p.rows.map((r) => [r.tracker.name, r.record && r.record.read]), [["AniList", 3]]);
  assert.match(T.summary(p.rows[0]), /Reading   3 \/ \? chapters/);

  let r = T.act(T.act(p, { type: "search" }).panel, { type: "query", text: "Frieren" });
  assert.deepEqual(r.payload, { route: "track.search", body: { trackerId: 2, query: "Frieren" } });
  p = T.act(r.panel, { type: "results", reply: ok({ results: [{ remoteId: 118586, title: "Sousou no Frieren", publishingType: "Manga", startDate: "2020-4-28", totalChapters: 0 }] }) }).panel;
  assert.equal(p.pick.items[0].detail, "Manga   2020");
  r = T.act(p, { type: "choose" });
  assert.deepEqual(r.payload, { route: "track.bind", body: { mangaId: 5, trackerId: 2, remoteId: "118586" } });
  p = T.act(r.panel, { type: "written", trackerId: 2, reply: ok({ track: Object.assign({}, record, { lastChapterRead: 10 }) }) }).panel;
  assert.equal(p.rows[0].record.read, 10);

  r = T.act(T.act(p, { type: "status" }).panel, { type: "move", delta: 1 });
  r = T.act(r.panel, { type: "choose" });
  assert.deepEqual(r.payload, { route: "track.update", body: { recordId: 9, status: 3 } });
  r = T.act(T.act(r.panel, { type: "written", trackerId: 2, reply: ok({ track: record }) }).panel, { type: "chapters" });
  assert.deepEqual(T.act(r.panel, { type: "progress", text: "12" }).payload, { route: "track.update", body: { recordId: 9, lastChapterRead: 12 } });
  assert.deepEqual(T.act(T.act(p, { type: "start" }).panel, { type: "date", text: "2026-01-31" }).payload, { route: "track.update", body: { recordId: 9, startDate: String(Date.UTC(2026, 0, 31)) } });
  assert.deepEqual(T.act(p, { type: "private" }).payload, { route: "track.update", body: { recordId: 9, private: true } });

  r = T.act(p, { type: "unbind" });
  assert.deepEqual(r.payload, { route: "track.unbind", body: { recordId: 9 } });
  p = T.act(r.panel, { type: "written", trackerId: 2, reply: ok({ deleted: 9 }) }).panel;
  assert.equal(p.rows[0].record, null);

  // A failed load keeps core's connection state.
  const down = await new Promise((resolve) => T.panelLoad(routeSend({ "tracker.list": M.coreReply(0, "") }, []), T.panel(5, "", true), resolve));
  assert.equal(T.act(T.panel(5, "", true), { type: "loaded", reply: down }).panel.state, "down");
});

test("on core, a mark read pushes or asks the trackers through core's routes", async () => {
  assert.deepEqual(C.trackPayload([5, 6, 5], true), { route: "track.progress", body: { mangaIds: [5, 6] } });
  assert.equal(C.trackPayload([], true), null);
  const sent = [];
  const send = routeSend({
    "tracker.list": ok({ trackers: TRACKERS }),
    "track.list": ok({ tracks: [
      { id: 1, mangaId: 5, trackerId: 2, lastChapterRead: 3 },
      { id: 2, mangaId: 6, trackerId: 2, lastChapterRead: 10 },
      // A logged-out tracker below the chapter asks nothing.
      { id: 3, mangaId: 6, trackerId: 1, lastChapterRead: 0 }
    ] }),
    "chapter.list": ok({ chapters: [
      { id: 50, mangaId: 5, chapterNumber: 4, isRead: true }, { id: 51, mangaId: 5, chapterNumber: 9, isRead: true }, { id: 52, mangaId: 5, chapterNumber: 12, isRead: false },
      { id: 60, mangaId: 6, chapterNumber: 10, isRead: true }
    ] })
  }, sent);
  const reply = await new Promise((resolve) => C.trackCheckLoad(send, true, [5, 6], resolve));
  assert.equal(reply.state, "ok");
  assert.deepEqual(C.trackAsk(reply.data), { mangaIds: [5], chapter: 9 });
  assert.deepEqual(sent.map((x) => x.route), ["tracker.list", "track.list", "chapter.list"]);
  const failed = await new Promise((resolve) => C.trackCheckLoad(routeSend({ "tracker.list": coreFail(500, "internal", "x") }, []), true, [5], resolve));
  assert.notEqual(failed.state, "ok");
});

test("a core tracker request reaches core's route with the secret, and Suwayomi's GraphQL is refused", async () => {
  const requests = install({ "tracker.list": () => ({ trackers: TRACKERS }) });
  const reply = await new Promise((resolve) => S2.send(core, T.listPayload(true), resolve));
  assert.equal(reply.data.trackers.length, 3);
  assert.equal(requests[0].url, "http://127.0.0.1:4591/api/tracker.list");
  const wrong = await new Promise((resolve) => S2.send(core, T.listPayload(false), resolve));
  assert.equal(wrong.state, "error");
});
