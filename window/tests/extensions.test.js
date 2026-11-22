const { test } = require("node:test");
const assert = require("node:assert/strict");
const E = require("./load")("Extensions.js");
const M = require("./load")("Model.js");

const config = { url: "http://127.0.0.1:4591", secret: "c0ffee" };
const KEY = "https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.json";
const ok = (data) => M.coreReply(200, JSON.stringify(data));
const fail = (message) => M.coreReply(502, JSON.stringify({ error: { kind: "upstream", message } }));
const reply = (ext, data) => E.reduce(ext, { type: "reply", reply: ok(data), config });

const node = (o) => Object.assign({
  pkgName: "pkg." + o.name, lang: "en", versionName: "1.6.0", iconUrl: "https://raw.githubusercontent.com/keiyoushi/extensions/repo/icon/pkg." + o.name + ".png",
  isInstalled: false, hasUpdate: false, isObsolete: false, contentWarning: "SAFE", storeIndexUrl: KEY
}, o);
const NODES = [
  node({ name: "Weeb Central", contentWarning: "MIXED" }),
  node({ name: "Asura Scans", isInstalled: true }),
  node({ name: "Hentai Site", contentWarning: "NSFW" }),
  node({ name: "MangaDex", lang: "all", isInstalled: true, hasUpdate: true, versionName: "1.6.1", sources: [
    { id: "22", displayName: "MangaDex (JA)", lang: "ja", isConfigurable: false },
    { id: "11", displayName: "MangaDex (EN)", lang: "en", isConfigurable: true }
  ] }),
  node({ name: "Raw Kuro", lang: "ja" }),
  node({ name: "Old Gone", storeIndexUrl: "https://gone.example/index.min.json" })
];
const fetched = (repos) => ({ repos: repos.map((u) => ({ indexUrl: u, name: "Keiyoushi" })), extensions: NODES, errors: [] });

function loadedState() {
  let s = E.reduce(E.initial(), { type: "load" });
  s = reply(s, { metas: [{ key: E.PRESET_META, value: "true" }] });
  return reply(s, fetched([KEY]));
}

const titles = (s, f) => E.rows(s, Object.assign({ query: "", allLanguages: false, showNsfw: false }, f)).map((r) => r.title);

test("a failed preset never writes the flag", () => {
  let s = reply(reply(E.reduce(E.initial(), { type: "load" }), { metas: [] }), { repos: [] });
  assert.equal(s.step, "preset");
  s = E.reduce(s, { type: "reply", reply: M.coreReply(0, ""), config });
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
  assert.equal(r[1].icon, "https://raw.githubusercontent.com/keiyoushi/extensions/repo/icon/pkg.MangaDex.png");
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
  const gone = E.reduce(s, { type: "repo-reply", reply: ok({}), removed: s.repos[0] });
  assert.deepEqual(titles(gone), ["MangaDex", "Asura Scans"]);
});

test("the filter matches names and repos, ignoring case", () => {
  const s = loadedState();
  assert.deepEqual(titles(s, { query: "asura" }), ["Asura Scans"]);
  assert.deepEqual(titles(s, { query: "KEI" }), ["Keiyoushi"]);
});

test("Enter installs or opens the details, u updates, x uninstalls or removes a repo", () => {
  const s = loadedState();
  const row = (t) => E.rows(s, { showNsfw: true }).find((r) => r.title === t);
  assert.deepEqual(E.actionFor(s, row("Weeb Central"), "extensions.activate"), { action: "install", pkgName: "pkg.Weeb Central" });
  assert.deepEqual(E.actionFor(s, row("MangaDex"), "extensions.update"), { action: "update", pkgName: "pkg.MangaDex" });
  assert.deepEqual(E.actionFor(s, row("MangaDex"), "extensions.activate"), { details: "pkg.MangaDex" }, "an updatable extension opens its details too");
  assert.deepEqual(E.actionFor(s, row("Asura Scans"), "extensions.activate"), { details: "pkg.Asura Scans" });
  assert.equal(E.actionFor(s, row("Asura Scans"), "extensions.update"), null, "nothing to update");
  assert.equal(E.actionFor(s, row("Weeb Central"), "extensions.update"), null, "not installed");
  assert.deepEqual(E.actionFor(s, row("Asura Scans"), "extensions.remove"), { action: "uninstall", pkgName: "pkg.Asura Scans" });
  assert.equal(E.actionFor(s, row("Weeb Central"), "extensions.remove"), null);
  assert.equal(E.actionFor(s, row("Keiyoushi"), "extensions.activate"), null);
  assert.equal(E.actionFor(s, null, "extensions.activate"), null);
});

test("details list the extension's sources by name and open settings only where there are some", () => {
  const s = loadedState();
  let d = E.details("pkg.MangaDex", s);
  assert.equal(d.state, "ok");
  assert.deepEqual(d.sources.map((x) => x.name), ["MangaDex (EN)", "MangaDex (JA)"]);
  assert.deepEqual(E.detailsAction(s, d, "extension.settings"), { settings: { id: "11", name: "MangaDex (EN)", lang: "en", configurable: true } });
  d = E.reduceDetails(d, { type: "move", delta: 5 });
  assert.equal(d.cursor, 1, "the cursor stops at the last source");
  assert.equal(E.detailsAction(s, d, "extension.settings"), null, "a source without settings");

  assert.deepEqual(E.detailsHeader(s, d), ["Version 1.6.1, an update is available", "Language multiple", "pkg.MangaDex"]);
  assert.deepEqual(E.detailsAction(s, d, "extension.update"), { action: "update", pkgName: "pkg.MangaDex" });
  assert.deepEqual(E.detailsAction(s, d, "extension.uninstall"), { action: "uninstall", pkgName: "pkg.MangaDex" });
  const busy = E.reduce(s, { type: "action", pkgName: "pkg.MangaDex", action: "update" });
  assert.equal(E.detailsAction(busy, d, "extension.uninstall"), null, "no uninstall while an update runs");
});

test("update all sends every installed extension with an update in one request", () => {
  let s = loadedState();
  const second = Object.assign({}, s.extensions.find((e) => e.name === "Asura Scans"), { pkgName: "pkg.Second", name: "Second", hasUpdate: true });
  s = Object.assign({}, s, { extensions: s.extensions.concat([second]) });
  const u = E.updateAll(s);
  assert.deepEqual(u.pkgNames, ["pkg.MangaDex", "pkg.Second"]);
  assert.deepEqual(u.payload, { route: "extension.updateAll", body: { pkgNames: ["pkg.MangaDex", "pkg.Second"] } });

  const busy = E.reduce(s, { type: "update-all", pkgNames: u.pkgNames });
  const row = (st, t) => E.rows(st, {}).find((r) => r.title === t);
  assert.equal(E.status(busy, row(busy, "MangaDex")), "updating...");
  assert.equal(E.status(busy, row(busy, "Second")), "updating...");
  assert.equal(E.updateAll(busy), null, "nothing more while they run");

  const done = E.reduce(busy, { type: "update-all-reply", pkgNames: u.pkgNames, config, reply: ok({ extensions: [
    node({ name: "MangaDex", lang: "all", isInstalled: true, hasUpdate: false, versionName: "1.6.1" }),
    node({ name: "Second", isInstalled: true, hasUpdate: false })
  ] }) });
  assert.equal(row(done, "MangaDex").group, "Installed");
  assert.equal(row(done, "Second").group, "Installed");
  assert.equal(E.status(done, row(done, "Second")), "");
  assert.equal(E.updateAll(done), null, "no update left");

  const failed = E.reduce(busy, { type: "update-all-reply", pkgNames: u.pkgNames, config, reply: fail("Failed to download") });
  assert.equal(E.status(failed, row(failed, "MangaDex")), "Failed to download");
  assert.equal(E.status(failed, row(failed, "Second")), "Failed to download");
  assert.deepEqual(E.updateAll(failed).pkgNames, u.pkgNames, "a failure leaves them to retry");
});

test("a repo is removed by the URL core stores, never the one typed", () => {
  let s = E.reduce(E.initial(), { type: "load" });
  s = reply(s, { metas: [{ key: E.PRESET_META, value: "true" }] });
  s = reply(s, fetched([KEY]));
  const row = E.rows(s, {}).find((r) => r.kind === "repo");
  const act = E.actionFor(s, row, "extensions.remove");
  assert.deepEqual(E.removeRepoPayload(act.removeRepo), { route: "extensionRepo.remove", body: { url: KEY } });
});

test("an action shows inline while in flight, then its result or error", () => {
  const s = loadedState();
  const p = E.actionPayload("pkg.Weeb Central", "install");
  assert.deepEqual(p, { route: "extension.install", body: { pkgName: "pkg.Weeb Central" } });
  const busy = E.reduce(s, { type: "action", pkgName: "pkg.Weeb Central", action: "install" });
  const row = E.rows(busy, {}).find((r) => r.title === "Weeb Central");
  assert.equal(E.status(busy, row), "installing...");
  assert.equal(E.actionFor(busy, row, "extensions.activate"), null, "no second install while one runs");

  const done = E.reduce(busy, { type: "action-reply", pkgName: "pkg.Weeb Central", config, reply: ok({ extension: node({ name: "Weeb Central", contentWarning: "MIXED", isInstalled: true }) }) });
  const moved = E.rows(done, {}).find((r) => r.title === "Weeb Central");
  assert.equal(moved.group, "Installed");
  assert.equal(E.status(done, moved), "");

  const failed = E.reduce(busy, { type: "action-reply", pkgName: "pkg.Weeb Central", config, reply: fail("Failed to download") });
  assert.equal(E.status(failed, row), "Failed to download");
  assert.equal(E.rows(failed, {}).find((r) => r.title === "Weeb Central").group, "Available");
  const retry = E.reduce(failed, { type: "action", pkgName: "pkg.Weeb Central", action: "install" });
  assert.equal(E.status(retry, row), "installing...", "a retry clears the old error");
});

test("adding a repo: URL check, then a fetch for its extensions; a failure shows inline", () => {
  assert.ok(E.parseRepoUrl("ftp://x").error);
  assert.ok(E.parseRepoUrl("").error);
  assert.deepEqual(E.parseRepoUrl("  https://x.example/index.min.json "), { url: "https://x.example/index.min.json" });
  assert.deepEqual(E.addRepoPayload("https://x"), { route: "extensionRepo.add", body: { url: "https://x" } });

  const s = loadedState();
  const added = E.reduce(s, { type: "repo-reply", reply: ok({ repo: { indexUrl: "https://x", name: "X" } }) });
  assert.deepEqual(E.next(added), { route: "extension.list" });
  const failed = E.reduce(s, { type: "repo-reply", reply: fail("HTTP error 404") });
  assert.equal(failed.repoError, "HTTP error 404");
  assert.equal(failed.state, "ok", "the list stays usable");
});

test("a failed load keeps the shown list", () => {
  const s = E.reduce(loadedState(), { type: "load" });
  const down = E.reduce(s, { type: "reply", reply: M.coreReply(0, ""), config });
  assert.equal(down.state, "down");
  assert.equal(down.extensions.length, NODES.length);
  assert.equal(E.reduce(E.initial(), { type: "config-missing" }).state, "no-config");
});
