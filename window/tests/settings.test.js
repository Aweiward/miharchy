const { test } = require("node:test");
const assert = require("node:assert/strict");
const S = require("./load")("Settings.js");
const M = require("./load")("Model.js");

const row = (key) => S.ROWS.find((r) => r.key === key);
const ok = (data) => ({ type: "response", reply: M.reply(200, JSON.stringify({ data })) });

test("every row is complete, and a choice's default is one of its options", () => {
  const keys = new Set();
  for (const r of S.ROWS) {
    assert.ok(!keys.has(r.key), "unique key " + r.key);
    keys.add(r.key);
    if (r.type === "action") {
      assert.ok(r.label && r.command && !("store" in r), r.key);
      continue;
    }
    assert.ok(r.key && r.label && ["bool", "choice", "text", "folder", "category"].includes(r.type) && ["server", "meta"].includes(r.store), r.key);
    assert.ok("default" in r, r.key);
    if (r.type === "choice") assert.ok(r.options.some((o) => o.value === r.default), r.key);
  }
});

test("the modes come first, and some defaults match Mihon", () => {
  assert.deepEqual(S.ROWS.slice(0, 2).map((r) => r.key), ["downloadedOnly", "incognito"]);
  const v = S.initial().values;
  assert.equal(v.skipFiltered, true);
  assert.equal(v.defaultCategory, "ask");
  assert.equal(v.defaultReadingMode, "paged-rtl");
  assert.deepEqual(row("defaultReadingMode").options.map((o) => o.label), ["Paged right-to-left", "Paged left-to-right", "Paged vertical", "Webtoon", "Continuous vertical"]);
});

test("the load query asks for every server row and the global meta", () => {
  const q = S.loadPayload().query;
  for (const r of S.ROWS.filter((r) => r.store === "server")) assert.match(q, new RegExp("settings \\{[^}]*\\b" + r.key + "\\b"));
  assert.match(q, /metas \{ nodes \{ key value \} \}/);
});

test("a load reply sets server values and namespaced meta, defaults fill the rest", () => {
  const s = S.reduce(S.initial(), ok({
    settings: { flareSolverrEnabled: true, flareSolverrUrl: "http://localhost:8191" },
    metas: { nodes: [
      { key: "miharchy.showNsfw", value: "true" },
      { key: "showNsfw", value: "false" },
      { key: "webUI_theme", value: "dark" }
    ] }
  }));
  assert.equal(s.state, "ok");
  assert.deepEqual(s.values, { ...S.initial().values, showNsfw: true, flareSolverrEnabled: true, flareSolverrUrl: "http://localhost:8191" });
});

test("the page fit and webtoon width come back from meta after a restart; an unknown one reads as the default", () => {
  const s = S.reduce(S.initial(), ok({ settings: {}, metas: { nodes: [{ key: "miharchy.pageFit", value: "width" }, { key: "miharchy.webtoonWidth", value: "80" }] } }));
  assert.equal(s.values.pageFit, "width");
  assert.equal(s.values.webtoonWidth, "80");
  const bad = S.reduce(S.initial(), ok({ settings: {}, metas: { nodes: [{ key: "miharchy.pageFit", value: "stretch" }, { key: "miharchy.webtoonWidth", value: "55" }] } }));
  assert.equal(bad.values.pageFit, "screen");
  assert.equal(bad.values.webtoonWidth, "60");
});

test("an unknown stored reading mode falls back to the default", () => {
  const s = S.reduce(S.initial(), ok({ settings: {}, metas: { nodes: [{ key: "miharchy.defaultReadingMode", value: "scroll" }] } }));
  assert.equal(s.values.defaultReadingMode, "paged-rtl");
});

test("delete after reading keeps what the old on/off row stored: on is the last read chapter", () => {
  const load = (value) => S.reduce(S.initial(), ok({ settings: {}, metas: { nodes: [{ key: "miharchy.deleteAfterRead", value }] } })).values.deleteAfterRead;
  assert.equal(S.display(row("deleteAfterRead"), load("true")), "Last read chapter");
  assert.equal(S.display(row("deleteAfterRead"), load("false")), "Off");
  assert.equal(S.display(row("deleteAfterRead"), load("4")), "Fifth to last read chapter");
  assert.deepEqual(S.activate(row("deleteAfterRead"), "4"), { save: "false" });
});

test("a meta save goes to setGlobalMeta as a string and its reply updates the row", () => {
  const p = S.savePayload(row("showNsfw"), true);
  assert.match(p.query, /setGlobalMeta/);
  assert.deepEqual(p.variables, { key: "miharchy.showNsfw", value: "true" });
  const s = S.reduce(S.initial(), ok({ setGlobalMeta: { meta: { key: "miharchy.showNsfw", value: "true" } } }));
  assert.equal(s.values.showNsfw, true);
  assert.equal(s.values.flareSolverrUrl, "http://127.0.0.1:8191", "other rows keep their values");
});

test("turning FlareSolverr on also turns on the response fallback; off leaves it", () => {
  const on = S.savePayload(row("flareSolverrEnabled"), true);
  assert.match(on.query, /setSettings/);
  assert.deepEqual(on.variables.s, { flareSolverrEnabled: true, flareSolverrAsResponseFallback: true });
  assert.deepEqual(S.savePayload(row("flareSolverrEnabled"), false).variables.s, { flareSolverrEnabled: false });
  assert.deepEqual(S.savePayload(row("flareSolverrUrl"), "http://x:1").variables.s, { flareSolverrUrl: "http://x:1" });
  const s = S.reduce(S.initial(), ok({ setSettings: { settings: { flareSolverrEnabled: true } } }));
  assert.equal(s.values.flareSolverrEnabled, true);
});

test("the server's WebView row saves kcefEnabled alone and notes the Chromium download", () => {
  assert.deepEqual(S.savePayload(row("kcefEnabled"), false).variables.s, { kcefEnabled: false });
  assert.match(row("kcefEnabled").note, /Chromium, about 250 MB/);
});

test("a failed request keeps the shown values and carries the error state", () => {
  const loaded = S.reduce(S.initial(), ok({ settings: { flareSolverrEnabled: true }, metas: { nodes: [] } }));
  for (const [status, state] of [[0, "down"], [401, "unauthorized"], [500, "error"]]) {
    const s = S.reduce(S.reduce(loaded, { type: "request" }), { type: "response", reply: M.reply(status, "") });
    assert.equal(s.state, state);
    assert.equal(s.values.flareSolverrEnabled, true);
    assert.ok(M.problem(s, "p"), state + " has an inline message");
  }
  const gql = S.reduce(loaded, { type: "response", reply: M.reply(200, JSON.stringify({ errors: [{ message: "nope" }] })) });
  assert.equal(gql.message, "nope");
  assert.equal(S.reduce(loaded, { type: "config-missing" }).state, "no-config");
  assert.equal(M.problem(S.initial(), "p"), null, "loading is not a problem");
});

test("the default category row cycles always ask, Default and each category, and names them", () => {
  const r = row("defaultCategory");
  const cats = [{ id: 2, name: "Action" }, { id: 5, name: "Later" }];
  assert.equal(r.default, "ask");
  const seen = [];
  let v = r.default;
  for (let i = 0; i < 4; i++) {
    v = S.activate(r, v, cats).save;
    seen.push(v);
  }
  assert.deepEqual(seen, ["0", "2", "5", "ask"]);
  assert.deepEqual(["ask", "0", "5", "9"].map((x) => S.display(r, x, cats)), ["Always ask", "Default", "Later", "Always ask"]);
  const loaded = S.reduce(S.initial(), ok({ settings: {}, metas: { nodes: [{ key: "miharchy.defaultCategory", value: "5" }] } }));
  assert.equal(loaded.values.defaultCategory, "5");
});

test("activate toggles bools, cycles choices and edits text", () => {
  assert.deepEqual(S.activate(row("showNsfw"), false), { save: true });
  assert.deepEqual(S.activate(row("showNsfw"), true), { save: false });
  const mode = row("defaultReadingMode");
  assert.deepEqual(S.activate(mode, "paged-rtl"), { save: "paged-ltr" });
  assert.deepEqual(S.activate(mode, "webtoon"), { save: "continuous-vertical" });
  assert.deepEqual(S.activate(mode, "continuous-vertical"), { save: "paged-rtl" }, "the last wraps to the first");
  assert.deepEqual(S.activate(row("flareSolverrUrl"), "http://a"), { edit: "http://a" });
});

test("commit trims and checks the URL", () => {
  const url = row("flareSolverrUrl");
  assert.deepEqual(S.commit(url, "  http://127.0.0.1:8191 "), { save: "http://127.0.0.1:8191" });
  for (const bad of ["", "127.0.0.1:8191", "ftp://x", "http://a b"]) assert.ok(S.commit(url, bad).error, bad);
});

test("display words each type", () => {
  assert.equal(S.display(row("showNsfw"), true), "on");
  assert.equal(S.display(row("showNsfw"), false), "off");
  assert.equal(S.display(row("defaultReadingMode"), "webtoon"), "Webtoon");
  assert.equal(S.display(row("flareSolverrUrl"), "http://x"), "http://x");
});

test("the library update schedule is the server's own interval in hours, 0 for off", () => {
  const every = row("globalUpdateInterval");
  assert.deepEqual(every.options.map((o) => o.value), [0, 12, 24, 48, 72, 168]);
  assert.ok(every.options.every((o) => o.value === 0 || o.value >= 6), "the server takes 0 or at least 6 hours");
  assert.equal(S.display(every, 0), "Off");
  assert.equal(S.display(every, 24), "Daily");
  assert.deepEqual(S.activate(every, 168), { save: 0 });
  assert.deepEqual(S.savePayload(every, 24).variables.s, { globalUpdateInterval: 24 });
  assert.equal(S.reduce(S.initial(), ok({ settings: { globalUpdateInterval: 48.0 }, metas: { nodes: [] } })).values.globalUpdateInterval, 48);
  assert.match(S.loadPayload().query, /settings \{[^}]*\bglobalUpdateInterval\b/);
});

test("the library update skip filters are the server's own settings, on meaning skip", () => {
  for (const key of ["excludeUnreadChapters", "excludeNotStarted", "excludeCompleted"]) {
    const r = row(key);
    assert.equal(r.store, "server", key);
    assert.match(S.loadPayload().query, new RegExp("settings \\{[^}]*\\b" + key + "\\b"));
    assert.deepEqual(S.savePayload(r, false).variables.s, { [key]: false });
    const s = S.reduce(S.initial(), ok({ setSettings: { settings: { [key]: false } } }));
    assert.equal(s.values[key], false, key + " reads back from the save reply");
  }
});

test("refreshing metadata during the library update is the server's own updateMangas, off by default", () => {
  const r = row("updateMangas");
  assert.equal(r.store, "server");
  assert.equal(r.default, false);
  assert.match(S.loadPayload().query, /settings \{[^}]*\bupdateMangas\b/);
  assert.deepEqual(S.savePayload(r, true).variables.s, { updateMangas: true });
  assert.equal(S.reduce(S.initial(), ok({ setSettings: { settings: { updateMangas: true } } })).values.updateMangas, true);
});

test("a typed folder must be absolute; ~ means home; trailing slashes go", () => {
  const folder = row("syncFolder");
  assert.deepEqual(S.commit(folder, "  ~/Sync/Mihon/ ", "/home/u"), { folder: "/home/u/Sync/Mihon" });
  assert.deepEqual(S.commitFolder("~", "/home/u"), { folder: "/home/u" });
  assert.deepEqual(S.commitFolder("/", "/home/u"), { folder: "/" });
  for (const bad of ["", "Sync", "~user/x"]) assert.ok(S.commit(folder, bad, "/home/u").error, bad);
});

test("the backup folder never is the sync folder, and the sync folder never the backup folder", () => {
  const backup = row("backupPath");
  const sync = row("syncFolder");
  assert.ok(S.commit(backup, "/home/u/Sync/", "/home/u", { syncFolder: "/home/u/Sync" }).error);
  assert.ok(S.commit(sync, "~/Backups", "/home/u", { backupPath: "/home/u/Backups/" }).error);
  assert.deepEqual(S.commit(backup, "/home/u/Backups", "/home/u", { syncFolder: "/home/u/Sync" }), { folder: "/home/u/Backups" }, "saved once the folder exists, as the helper needs");
  assert.deepEqual(S.commit(backup, "", "/home/u", { syncFolder: "/home/u/Sync" }), { save: "" }, "blank is the server's own folder");
  assert.deepEqual(S.commit(sync, "~/Sync", "/home/u", { backupPath: "" }), { folder: "/home/u/Sync" });
  assert.ok(S.commit(backup, "Backups", "/home/u", {}).error, "a relative path");
});

test("the backup folder is refused and saved as the sync helper normalizes it", () => {
  const backup = row("backupPath");
  const cases = require("../../sync/src/test/resources/backup-folder-cases.json");
  for (const c of cases) {
    const done = S.commit(backup, c.backup, "/home/u", { syncFolder: c.sync || "" });
    if (c.refused) assert.deepEqual(done, { error: c.backup + " is the sync folder. Choose another backup folder in Settings." }, c.backup);
    else assert.ok("folder" in done, c.backup);
  }
  assert.deepEqual(S.commit(backup, "/a/./b//c/../d/", "/home/u", {}), { folder: "/a/b/d" });
  assert.deepEqual(S.commitFolder("~/x/../Sync/./", "/home/u"), { folder: "/home/u/Sync" });
});

test("saving the backup folder keeps the server password out of automatic backups", () => {
  assert.deepEqual(S.savePayload(row("backupPath"), "/home/u/Backups").variables.s, { backupPath: "/home/u/Backups", autoBackupIncludeServerSettings: false });
  assert.equal(S.display(row("backupPath"), ""), "server default");
});

test("automatic backups are the server's own schedule: an interval in days, a time and an age to keep", () => {
  const every = row("backupInterval");
  assert.equal(S.display(every, 0), "Off");
  assert.deepEqual(S.activate(every, 1), { save: 2 });
  assert.deepEqual(S.activate(every, 7), { save: 0 });
  assert.deepEqual(S.savePayload(every, 7).variables.s, { backupInterval: 7 });
  const time = row("backupTime");
  assert.deepEqual(S.commit(time, " 21:30 "), { save: "21:30" });
  for (const bad of ["", "24:00", "9:30", "21:60", "noon"]) assert.ok(S.commit(time, bad).error, bad);
  const keep = row("backupTTL");
  assert.equal(S.display(keep, 0), "Forever");
  assert.deepEqual(S.activate(keep, 0), { save: 7 });
  assert.equal(S.reduce(S.initial(), ok({ settings: { backupInterval: 3, backupTime: "06:15", backupTTL: 30 }, metas: { nodes: [] } })).values.backupTTL, 30);
  for (const key of ["backupInterval", "backupTime", "backupTTL"]) assert.match(S.loadPayload().query, new RegExp("settings \\{[^}]*\\b" + key + "\\b"));
});

test("the backup include rows are the server's automatic backup settings", () => {
  for (const part of ["Categories", "Chapters", "Tracking", "History"]) {
    const r = row("autoBackupInclude" + part);
    assert.equal(r.store, "server");
    assert.deepEqual(S.savePayload(r, false).variables.s, { ["autoBackupInclude" + part]: false });
  }
});

test("Create a backup is an action: Enter runs its command and the row shows the outcome", () => {
  const r = row("createBackup");
  assert.deepEqual(S.activate(r, undefined), { run: "backup.create" });
  assert.equal(S.display(r, "Wrote /b/x.tachibk"), "Wrote /b/x.tachibk");
  assert.equal(S.display(r, undefined), "");
  assert.ok(!("createBackup" in S.initial().values));
  assert.doesNotMatch(S.loadPayload().query, /createBackup/);
});

test("Library check is an action row: Enter opens the check, the row shows the count", () => {
  const r = row("libraryCheck");
  assert.equal(r.label, "Library check");
  assert.deepEqual(S.activate(r, undefined), { run: "view.check" });
  assert.equal(S.display(r, "7 problems"), "7 problems");
});

test("the sync folder is the meta Setup writes, shown as not set until then", () => {
  const folder = row("syncFolder");
  assert.deepEqual(S.savePayload(folder, "/home/u/Sync").variables, { key: "miharchy.syncFolder", value: "/home/u/Sync" });
  assert.equal(S.display(folder, ""), "not set");
  assert.deepEqual(S.activate(folder, "/home/u/Sync"), { edit: "/home/u/Sync" });
});

test("incognito is a meta toggle the palette flips, and the status bar names it while on", () => {
  assert.deepEqual(S.modes(S.initial().values), []);
  const t = S.toggle("incognito", S.initial().values);
  assert.equal(t.row.key, "incognito");
  assert.deepEqual(S.savePayload(t.row, t.value).variables, { key: "miharchy.incognito", value: "true" });
  const on = S.reduce(S.initial(), ok({ setGlobalMeta: { meta: { key: "miharchy.incognito", value: "true" } } }));
  assert.deepEqual(S.modes(on.values), ["incognito"]);
  assert.equal(S.toggle("incognito", on.values).value, false);
});

test("downloaded only is a meta toggle too, named first in the status bar", () => {
  const t = S.toggle("downloadedOnly", S.initial().values);
  assert.deepEqual(S.savePayload(t.row, t.value).variables, { key: "miharchy.downloadedOnly", value: "true" });
  const both = S.reduce(S.initial(), ok({ settings: {}, metas: { nodes: [{ key: "miharchy.downloadedOnly", value: "true" }, { key: "miharchy.incognito", value: "true" }] } }));
  assert.deepEqual(S.modes(both.values), ["downloaded only", "incognito"]);
});

test("Catch-up is a meta choice, 3 by default, with Off; a stored 2 comes back", () => {
  assert.equal(S.initial().values.catchUp, "3");
  assert.equal(S.display(row("catchUp"), "0"), "Off");
  const s = S.reduce(S.initial(), ok({ settings: {}, metas: { nodes: [{ key: "miharchy.catchUp", value: "2" }] } }));
  assert.equal(s.values.catchUp, "2");
  assert.deepEqual(S.savePayload(row("catchUp"), "5").variables, { key: "miharchy.catchUp", value: "5" });
});
