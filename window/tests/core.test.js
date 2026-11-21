// The MIHARCHY_BACKEND=core path (ADR 0010, #377): core.json, core's replies,
// Session's core requests, and the Extensions view on core's routes.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load");
const M = load("Model.js");
const E = load("Extensions.js");

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

test("on core, details come from the list with no request, and settings wait for #378", () => {
  const s = loaded();
  const d = E.details(MANGADEX.pkgName, s);
  assert.equal(d.state, "ok");
  assert.equal(E.detailsPayload(d), null);
  assert.deepEqual(d.sources.map((x) => x.name), ["MangaDex (EN)", "MangaDex (JA)"]);
  assert.ok(d.sources.every((x) => x.configurable === false));
  assert.equal(E.detailsAction(s, d, "extension.settings"), null);
  assert.ok(E.detailsPayload(E.details(MANGADEX.pkgName)).query, "Suwayomi still asks");
});
