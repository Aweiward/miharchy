const { test } = require("node:test");
const assert = require("node:assert/strict");
const S = require("./load")("Settings.js");
const M = require("./load")("Model.js");

const row = (key) => S.ROWS.find((r) => r.key === key);
const ok = (data) => ({ type: "response", reply: M.coreReply(200, JSON.stringify(data)) });
const meta = (key, value) => ({ scope: "global", owner: 0, key, value });

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

test("a load reply sets server values and namespaced meta, defaults fill the rest", () => {
  const s = S.reduce(S.initial(), ok({
    settings: { flareSolverrEnabled: true, flareSolverrUrl: "http://localhost:8191" },
    metas: [
      meta("miharchy.showNsfw", "true"),
      meta("showNsfw", "false"),
      meta("webUI_theme", "dark")
    ]
  }));
  assert.equal(s.state, "ok");
  assert.deepEqual(s.values, { ...S.initial().values, showNsfw: true, flareSolverrEnabled: true, flareSolverrUrl: "http://localhost:8191" });
});

test("the page fit and webtoon width come back from meta after a restart; an unknown one reads as the default", () => {
  const s = S.reduce(S.initial(), ok({ settings: {}, metas: [meta("miharchy.pageFit", "width"), meta("miharchy.webtoonWidth", "80")] }));
  assert.equal(s.values.pageFit, "width");
  assert.equal(s.values.webtoonWidth, "80");
  const bad = S.reduce(S.initial(), ok({ settings: {}, metas: [meta("miharchy.pageFit", "stretch"), meta("miharchy.webtoonWidth", "55")] }));
  assert.equal(bad.values.pageFit, "screen");
  assert.equal(bad.values.webtoonWidth, "60");
});

test("an unknown stored reading mode falls back to the default", () => {
  const s = S.reduce(S.initial(), ok({ settings: {}, metas: [meta("miharchy.defaultReadingMode", "scroll")] }));
  assert.equal(s.values.defaultReadingMode, "paged-rtl");
});

test("delete after reading keeps what the old on/off row stored: on is the last read chapter", () => {
  const load = (value) => S.reduce(S.initial(), ok({ settings: {}, metas: [{ key: "miharchy.deleteAfterRead", value }] })).values.deleteAfterRead;
  assert.equal(S.display(row("deleteAfterRead"), load("true")), "Last read chapter");
  assert.equal(S.display(row("deleteAfterRead"), load("false")), "Off");
  assert.equal(S.display(row("deleteAfterRead"), load("4")), "Fifth to last read chapter");
  assert.deepEqual(S.activate(row("deleteAfterRead"), "4"), { save: "false" });
});

test("a meta save goes to meta.set as a string and its reply updates the row", () => {
  const p = S.savePayload(row("showNsfw"), true);
  assert.deepEqual(p, { route: "meta.set", body: { metas: [{ scope: "global", key: "miharchy.showNsfw", value: "true" }] } });
  const s = S.reduce(S.initial(), ok({ metas: [meta("miharchy.showNsfw", "true")] }));
  assert.equal(s.values.showNsfw, true);
  assert.equal(s.values.flareSolverrUrl, "http://127.0.0.1:8191", "other rows keep their values");
});

test("turning FlareSolverr on also turns on the response fallback; off leaves it", () => {
  const on = S.savePayload(row("flareSolverrEnabled"), true);
  assert.equal(on.route, "settings.set");
  assert.deepEqual(on.body.settings, { flareSolverrEnabled: true, flareSolverrAsResponseFallback: true });
  assert.deepEqual(S.savePayload(row("flareSolverrEnabled"), false).body.settings, { flareSolverrEnabled: false });
  assert.deepEqual(S.savePayload(row("flareSolverrUrl"), "http://x:1").body.settings, { flareSolverrUrl: "http://x:1" });
  const s = S.reduce(S.initial(), ok({ settings: { flareSolverrEnabled: true } }));
  assert.equal(s.values.flareSolverrEnabled, true);
});

test("the server's WebView row saves kcefEnabled alone and promises no Chromium download", () => {
  assert.deepEqual(S.savePayload(row("kcefEnabled"), false).body.settings, { kcefEnabled: false });
  assert.equal(row("kcefEnabled").note, undefined, "core marks it unapplied; SettingsView adds that note");
});

test("a failed request keeps the shown values and carries the error state", () => {
  const loaded = S.reduce(S.initial(), ok({ settings: { flareSolverrEnabled: true }, metas: [] }));
  const unauthorized = JSON.stringify({ error: { kind: "unauthorized", message: "" } });
  const refused = JSON.stringify({ error: { kind: "internal", message: "nope" } });
  for (const [status, body, state] of [[0, "", "down"], [401, unauthorized, "unauthorized"], [500, refused, "error"]]) {
    const s = S.reduce(S.reduce(loaded, { type: "request" }), { type: "response", reply: M.coreReply(status, body) });
    assert.equal(s.state, state);
    assert.equal(s.values.flareSolverrEnabled, true);
    assert.ok(M.problem(s, "p"), state + " has an inline message");
  }
  const gql = S.reduce(loaded, { type: "response", reply: M.coreReply(500, refused) });
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
  const loaded = S.reduce(S.initial(), ok({ settings: {}, metas: [meta("miharchy.defaultCategory", "5")] }));
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
  assert.deepEqual(S.savePayload(every, 24).body.settings, { globalUpdateInterval: 24 });
  assert.equal(S.reduce(S.initial(), ok({ settings: { globalUpdateInterval: 48.0 }, metas: [] })).values.globalUpdateInterval, 48);
});

test("the library update skip filters are the server's own settings, on meaning skip", () => {
  for (const key of ["excludeUnreadChapters", "excludeNotStarted", "excludeCompleted"]) {
    const r = row(key);
    assert.equal(r.store, "server", key);
    assert.deepEqual(S.savePayload(r, false).body.settings, { [key]: false });
    const s = S.reduce(S.initial(), ok({ settings: { [key]: false } }));
    assert.equal(s.values[key], false, key + " reads back from the save reply");
  }
});

test("refreshing metadata during the library update is the server's own updateMangas, off by default", () => {
  const r = row("updateMangas");
  assert.equal(r.store, "server");
  assert.equal(r.default, false);
  assert.deepEqual(S.savePayload(r, true).body.settings, { updateMangas: true });
  assert.equal(S.reduce(S.initial(), ok({ settings: { updateMangas: true } })).values.updateMangas, true);
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

test("an empty backup folder reads as the server's own", () => {
  assert.equal(S.display(row("backupPath"), ""), "server default");
});

test("automatic backups are the server's own schedule: an interval in days, a time and an age to keep", () => {
  const every = row("backupInterval");
  assert.equal(S.display(every, 0), "Off");
  assert.deepEqual(S.activate(every, 1), { save: 2 });
  assert.deepEqual(S.activate(every, 7), { save: 0 });
  assert.deepEqual(S.savePayload(every, 7).body.settings, { backupInterval: 7 });
  const time = row("backupTime");
  assert.deepEqual(S.commit(time, " 21:30 "), { save: "21:30" });
  for (const bad of ["", "24:00", "9:30", "21:60", "noon"]) assert.ok(S.commit(time, bad).error, bad);
  const keep = row("backupTTL");
  assert.equal(S.display(keep, 0), "Forever");
  assert.deepEqual(S.activate(keep, 0), { save: 7 });
  assert.equal(S.reduce(S.initial(), ok({ settings: { backupInterval: 3, backupTime: "06:15", backupTTL: 30 }, metas: [] })).values.backupTTL, 30);
});

test("the backup include rows are the server's automatic backup settings", () => {
  for (const part of ["Categories", "Chapters", "Tracking", "History"]) {
    const r = row("autoBackupInclude" + part);
    assert.equal(r.store, "server");
    assert.deepEqual(S.savePayload(r, false).body.settings, { ["autoBackupInclude" + part]: false });
  }
});

test("Create a backup is an action: Enter runs its command and the row shows the outcome", () => {
  const r = row("createBackup");
  assert.deepEqual(S.activate(r, undefined), { run: "backup.create" });
  assert.equal(S.display(r, "Wrote /b/x.tachibk"), "Wrote /b/x.tachibk");
  assert.equal(S.display(r, undefined), "");
  assert.ok(!("createBackup" in S.initial().values));
  assert.ok(!S.loadPayloads()[1].body.keys.includes("miharchy.createBackup"));
});

test("Library check is an action row: Enter opens the check, the row shows the count", () => {
  const r = row("libraryCheck");
  assert.equal(r.label, "Library check");
  assert.deepEqual(S.activate(r, undefined), { run: "view.check" });
  assert.equal(S.display(r, "7 problems"), "7 problems");
});

test("the sync folder is the meta Setup writes, shown as not set until then", () => {
  const folder = row("syncFolder");
  assert.deepEqual(S.savePayload(folder, "/home/u/Sync").body.metas, [{ scope: "global", key: "miharchy.syncFolder", value: "/home/u/Sync" }]);
  assert.equal(S.display(folder, ""), "not set");
  assert.deepEqual(S.activate(folder, "/home/u/Sync"), { edit: "/home/u/Sync" });
});

test("incognito is a meta toggle the palette flips, and the status bar names it while on", () => {
  assert.deepEqual(S.modes(S.initial().values), []);
  const t = S.toggle("incognito", S.initial().values);
  assert.equal(t.row.key, "incognito");
  assert.deepEqual(S.savePayload(t.row, t.value).body.metas, [{ scope: "global", key: "miharchy.incognito", value: "true" }]);
  const on = S.reduce(S.initial(), ok({ metas: [meta("miharchy.incognito", "true")] }));
  assert.deepEqual(S.modes(on.values), ["incognito"]);
  assert.equal(S.toggle("incognito", on.values).value, false);
});

test("downloaded only is a meta toggle too, named first in the status bar", () => {
  const t = S.toggle("downloadedOnly", S.initial().values);
  assert.deepEqual(S.savePayload(t.row, t.value).body.metas, [{ scope: "global", key: "miharchy.downloadedOnly", value: "true" }]);
  const both = S.reduce(S.initial(), ok({ settings: {}, metas: [meta("miharchy.downloadedOnly", "true"), meta("miharchy.incognito", "true")] }));
  assert.deepEqual(S.modes(both.values), ["downloaded only", "incognito"]);
});

test("Catch-up is a meta choice, 3 by default, with Off; a stored 2 comes back", () => {
  assert.equal(S.initial().values.catchUp, "3");
  assert.equal(S.display(row("catchUp"), "0"), "Off");
  const s = S.reduce(S.initial(), ok({ settings: {}, metas: [meta("miharchy.catchUp", "2")] }));
  assert.equal(s.values.catchUp, "2");
  assert.deepEqual(S.savePayload(row("catchUp"), "5").body.metas, [{ scope: "global", key: "miharchy.catchUp", value: "5" }]);
});

// miharchy-core (#385).
const core = (status, body) => ({ type: "response", reply: M.coreReply(status, JSON.stringify(body)) });

test("a load is settings.get, then a global meta.get of the meta rows", () => {
  const [settings, metas] = S.loadPayloads();
  assert.deepEqual(settings, { route: "settings.get", body: {} });
  assert.equal(metas.route, "meta.get");
  assert.equal(metas.body.scope, "global");
  assert.deepEqual(metas.body.keys, S.ROWS.filter((r) => r.store === "meta").map((r) => "miharchy." + r.key));
});

test("a server row saves with settings.set and keeps whenOn", () => {
  assert.deepEqual(S.savePayload(row("flareSolverrEnabled"), true), {
    route: "settings.set", body: { settings: { flareSolverrEnabled: true, flareSolverrAsResponseFallback: true } }
  });
  assert.deepEqual(S.savePayload(row("backupPath"), "/b"), { route: "settings.set", body: { settings: { backupPath: "/b" } } });
});

test("a meta row saves with meta.set", () => {
  assert.deepEqual(S.savePayload(row("syncFolder"), "/s"), {
    route: "meta.set", body: { metas: [{ scope: "global", key: "miharchy.syncFolder", value: "/s" }] }
  });
});

test("core's replies fill the values, and its unapplied rows stay across a failed save", () => {
  let s = S.reduce(S.initial(), core(200, { settings: { globalUpdateInterval: 24, downloadsPath: "/d" }, unapplied: ["downloadsPath"] }));
  assert.equal(s.state, "ok");
  assert.equal(s.values.globalUpdateInterval, 24);
  assert.deepEqual(s.unapplied, ["downloadsPath"]);
  s = S.reduce(s, core(200, { metas: [{ scope: "global", owner: 0, key: "miharchy.syncFolder", value: "/s" }] }));
  assert.equal(s.values.syncFolder, "/s");
  assert.deepEqual(s.unapplied, ["downloadsPath"], "a meta reply has no unapplied list");
  s = S.reduce(s, { type: "request" });
  s = S.reduce(s, { type: "response", reply: M.coreReply(0, "") });
  assert.equal(s.state, "down");
  assert.deepEqual(s.unapplied, ["downloadsPath"]);
});

test("a value core refuses is the row's error, not the view's", () => {
  assert.ok(S.refused(M.coreReply(400, JSON.stringify({ error: { kind: "invalid", message: "/x is not a folder." } }))));
  assert.ok(!S.refused(M.coreReply(0, "")));
  assert.ok(!S.refused(M.coreReply(500, JSON.stringify({ error: { kind: "internal", message: "boom" } }))));
});
