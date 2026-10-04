const { test } = require("node:test");
const assert = require("node:assert/strict");
const E = require("./load")("Extensions.js");
const M = require("./load")("Model.js");

const config = { url: "http://127.0.0.1:4590", username: "u", password: "p" };
const PB = "https://github.com/keiyoushi/extensions/raw/repo/index.pb";
const ok = (data) => M.reply(200, JSON.stringify({ data }));
const reply = (ext, data) => E.reduce(ext, { type: "reply", reply: ok(data), config });
const stores = (urls, preset) => ({
  extensionStores: { nodes: urls.map((u) => ({ indexUrl: u, name: "Keiyoushi" })) },
  metas: { nodes: preset ? [{ key: E.PRESET_META, value: "true" }] : [] }
});

const node = (o) => Object.assign({
  pkgName: "pkg." + o.name, lang: "en", versionName: "1.6.0", iconUrl: "/api/v1/extension/icon/pkg." + o.name,
  isInstalled: false, hasUpdate: false, isObsolete: false, contentWarning: "SAFE", storeIndexUrl: PB
}, o);
const NODES = [
  node({ name: "Weeb Central", contentWarning: "MIXED" }),
  node({ name: "Asura Scans", isInstalled: true }),
  node({ name: "Hentai Site", contentWarning: "NSFW" }),
  node({ name: "MangaDex", lang: "all", isInstalled: true, hasUpdate: true, versionName: "1.6.1" }),
  node({ name: "Raw Kuro", lang: "ja" }),
  node({ name: "Old Gone", storeIndexUrl: "https://gone.example/index.min.json" })
];
const fetched = (repos) => ({ fetchExtensions: { extensionStores: repos.map((u) => ({ indexUrl: u, name: "Keiyoushi" })), extensions: NODES } });

function loadedState() {
  let s = E.reduce(E.initial(), { type: "load" });
  s = reply(s, stores([PB]));
  return reply(s, fetched([PB]));
}

const titles = (s, f) => E.rows(s, Object.assign({ query: "", allLanguages: false, showNsfw: false }, f)).map((r) => r.title);

test("an empty server gets the Keiyoushi repo once, then the flag, then a fetch", () => {
  let s = E.reduce(E.initial(), { type: "load" });
  assert.equal(s.state, "loading");
  assert.match(E.next(s).query, /extensionStores/);
  assert.match(E.next(s).query, /miharchy\.repoPreset/);
  s = reply(s, stores([], false));
  assert.equal(s.step, "preset");
  assert.deepEqual(E.next(s).variables, { url: E.KEIYOUSHI });
  assert.match(E.next(s).query, /addExtensionStore/);
  s = reply(s, { addExtensionStore: { extensionStore: { indexUrl: PB, name: "Keiyoushi" } } });
  assert.equal(s.step, "mark");
  assert.match(E.next(s).query, /setGlobalMeta/);
  assert.deepEqual(E.next(s).variables, { key: "miharchy.repoPreset" });
  s = reply(s, { setGlobalMeta: { meta: { key: "miharchy.repoPreset" } } });
  assert.match(E.next(s).query, /fetchExtensions/);
  s = reply(s, fetched([PB]));
  assert.equal(s.state, "ok");
  assert.equal(E.next(s), null);
  assert.deepEqual(s.repos, [{ url: PB, name: "Keiyoushi" }]);
});

test("a server with repos, or one whose preset was removed by the user, goes straight to the fetch", () => {
  const start = E.reduce(E.initial(), { type: "load" });
  assert.equal(reply(start, stores([PB], false)).step, "fetch");
  assert.equal(reply(start, stores([], true)).step, "fetch", "a removed Keiyoushi stays removed");
});

test("a failed preset never writes the flag", () => {
  let s = reply(E.reduce(E.initial(), { type: "load" }), stores([], false));
  s = E.reduce(s, { type: "reply", reply: M.reply(0, ""), config });
  assert.equal(s.state, "down");
  assert.equal(E.next(s), null);
  assert.ok(M.problem(s, "p"));
});

test("rows: repos, then updates, installed and available, each by name", () => {
  const s = loadedState();
  const r = E.rows(s, { query: "", allLanguages: false, showNsfw: false });
  assert.deepEqual(r.map((x) => [x.group, x.title]), [
    ["Extension repos", "Keiyoushi"],
    ["Updates", "MangaDex"],
    ["Installed", "Asura Scans"],
    ["Available", "Weeb Central"]
  ]);
  assert.equal(r[1].icon, "http://u:p@127.0.0.1:4590/api/v1/extension/icon/pkg.MangaDex", "icons get the cover credentials");
  assert.equal(r[3].marker, "mixed");
  assert.match(r[1].detail, /all\s+1\.6\.1/);
});

test("NSFW extensions hide unless the setting is on; MIXED ones always show", () => {
  const s = loadedState();
  assert.ok(!titles(s).includes("Hentai Site"));
  assert.ok(titles(s).includes("Weeb Central"));
  assert.ok(titles(s, { showNsfw: true }).includes("Hentai Site"));
  const nsfw = E.rows(s, { showNsfw: true }).find((r) => r.title === "Hentai Site");
  assert.equal(nsfw.marker, "18+");
});

test("languages: English and all by default, every language on request", () => {
  const s = loadedState();
  assert.ok(!titles(s).includes("Raw Kuro"));
  assert.ok(titles(s, { allLanguages: true }).includes("Raw Kuro"));
});

test("available extensions of a removed repo do not show; installed ones do", () => {
  const s = loadedState();
  assert.ok(!titles(s, { allLanguages: true }).includes("Old Gone"));
  const gone = E.reduce(s, { type: "repo-reply", reply: ok({ removeExtensionStore: { extensionStore: { indexUrl: PB } } }), removed: s.repos[0] });
  assert.deepEqual(titles(gone), ["MangaDex", "Asura Scans"]);
});

test("the filter matches names and repos, ignoring case", () => {
  const s = loadedState();
  assert.deepEqual(titles(s, { query: "asura" }), ["Asura Scans"]);
  assert.deepEqual(titles(s, { query: "KEI" }), ["Keiyoushi"]);
});

test("Enter installs or updates, x uninstalls or removes a repo", () => {
  const s = loadedState();
  const row = (t) => E.rows(s, { showNsfw: true }).find((r) => r.title === t);
  assert.deepEqual(E.actionFor(s, row("Weeb Central"), "extensions.activate"), { action: "install", pkgName: "pkg.Weeb Central" });
  assert.deepEqual(E.actionFor(s, row("MangaDex"), "extensions.activate"), { action: "update", pkgName: "pkg.MangaDex" });
  assert.equal(E.actionFor(s, row("Asura Scans"), "extensions.activate"), null);
  assert.deepEqual(E.actionFor(s, row("Asura Scans"), "extensions.remove"), { action: "uninstall", pkgName: "pkg.Asura Scans" });
  assert.equal(E.actionFor(s, row("Weeb Central"), "extensions.remove"), null);
  assert.equal(E.actionFor(s, row("Keiyoushi"), "extensions.activate"), null);
  assert.equal(E.actionFor(s, null, "extensions.activate"), null);
});

test("a repo is removed by the URL the server stores, never the one typed", () => {
  let s = E.reduce(E.initial(), { type: "load" });
  s = reply(s, stores([PB]));
  const row = E.rows(s, {}).find((r) => r.kind === "repo");
  const act = E.actionFor(s, row, "extensions.remove");
  const p = E.removeRepoPayload(act.removeRepo);
  assert.match(p.query, /removeExtensionStore/);
  assert.deepEqual(p.variables, { url: PB });
});

test("an action shows inline while in flight, then its result or error", () => {
  const s = loadedState();
  const p = E.actionPayload("pkg.Weeb Central", "install");
  assert.deepEqual(p.variables, { id: "pkg.Weeb Central", patch: { install: true } });
  const busy = E.reduce(s, { type: "action", pkgName: "pkg.Weeb Central", action: "install" });
  const row = E.rows(busy, {}).find((r) => r.title === "Weeb Central");
  assert.equal(E.status(busy, row), "installing...");
  assert.equal(E.actionFor(busy, row, "extensions.activate"), null, "no second install while one runs");

  const done = E.reduce(busy, { type: "action-reply", pkgName: "pkg.Weeb Central", config, reply: ok({ updateExtension: { extension: node({ name: "Weeb Central", contentWarning: "MIXED", isInstalled: true }) } }) });
  const moved = E.rows(done, {}).find((r) => r.title === "Weeb Central");
  assert.equal(moved.group, "Installed");
  assert.equal(E.status(done, moved), "");

  const failed = E.reduce(busy, { type: "action-reply", pkgName: "pkg.Weeb Central", config, reply: M.reply(200, JSON.stringify({ errors: [{ message: "Exception while fetching data (/updateExtension) : Failed to download\nstack" }] })) });
  assert.equal(E.status(failed, row), "Failed to download");
  assert.equal(E.rows(failed, {}).find((r) => r.title === "Weeb Central").group, "Available");
  const retry = E.reduce(failed, { type: "action", pkgName: "pkg.Weeb Central", action: "install" });
  assert.equal(E.status(retry, row), "installing...", "a retry clears the old error");
});

test("an uninstall whose extension left the server drops the row", () => {
  const s = loadedState();
  const done = E.reduce(s, { type: "action-reply", pkgName: "pkg.Asura Scans", config, reply: ok({ updateExtension: { extension: null } }) });
  assert.ok(!titles(done).includes("Asura Scans"));
});

test("adding a repo: URL check, then a fetch for its extensions; a failure shows inline", () => {
  assert.ok(E.parseRepoUrl("ftp://x").error);
  assert.ok(E.parseRepoUrl("").error);
  assert.deepEqual(E.parseRepoUrl("  https://x.example/index.min.json "), { url: "https://x.example/index.min.json" });
  assert.deepEqual(E.addRepoPayload("https://x").variables, { url: "https://x" });

  const s = loadedState();
  const added = E.reduce(s, { type: "repo-reply", reply: ok({ addExtensionStore: { extensionStore: { indexUrl: "https://x", name: "X" } } }) });
  assert.match(E.next(added).query, /fetchExtensions/);
  const failed = E.reduce(s, { type: "repo-reply", reply: M.reply(200, JSON.stringify({ errors: [{ message: "Exception while fetching data (/addExtensionStore) : HTTP error 404" }] })) });
  assert.equal(failed.repoError, "HTTP error 404");
  assert.equal(failed.state, "ok", "the list stays usable");
});

test("a failed load keeps the shown list", () => {
  const s = E.reduce(loadedState(), { type: "load" });
  const down = E.reduce(s, { type: "reply", reply: M.reply(0, ""), config });
  assert.equal(down.state, "down");
  assert.equal(down.extensions.length, NODES.length);
  assert.equal(E.reduce(E.initial(), { type: "config-missing" }).state, "no-config");
});
