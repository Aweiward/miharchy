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

test("the first rows and their defaults", () => {
  assert.deepEqual(S.ROWS.map((r) => r.label), ["Show NSFW sources", "Default reading mode", "Page fit", "Webtoon width", "Reader background", "Keep the screen on", "Always show chapter transition", "Skip read chapters", "Skip filtered chapters", "Skip duplicate chapters", "FlareSolverr", "FlareSolverr URL", "Check for new chapters", "Skip manga with unread chapters", "Skip manga not started", "Skip completed manga", "Default category", "Download folder", "Save downloads as CBZ", "Auto-download new chapters", "Auto-download only for manga with no unread chapters", "Auto-download skips re-uploaded chapters", "Delete downloads marked read", "Delete after reading", "Delete bookmarked chapters", "Sync folder", "Backup folder", "Backups include categories", "Backups include chapters", "Backups include tracking", "Backups include history", "Create a backup"]);, "Update trackers after reading", "Update trackers when marking chapters read", "Sync folder"]);
  assert.deepEqual(S.initial().values, { showNsfw: false, defaultReadingMode: "paged-rtl", pageFit: "screen", webtoonWidth: "60", readerTheme: "theme", keepScreenOn: true, alwaysShowChapterTransition: true, skipRead: false, skipFiltered: true, skipDupe: false, flareSolverrEnabled: false, flareSolverrUrl: "http://127.0.0.1:8191", globalUpdateInterval: 12, excludeUnreadChapters: true, excludeNotStarted: true, excludeCompleted: true, defaultCategory: "ask", downloadsPath: "", downloadAsCbz: false, autoDownloadNewChapters: false, excludeEntryWithUnreadChapters: true, autoDownloadIgnoreReUploads: false, deleteAfterMarkRead: false, deleteAfterRead: "false", deleteBookmarked: false, syncFolder: "", backupPath: "", autoBackupIncludeCategories: true, autoBackupIncludeChapters: true, autoBackupIncludeTracking: true, autoBackupIncludeHistory: true });, trackAfterReading: true, trackOnMarkRead: "always", syncFolder: "" });
  assert.deepEqual(row("defaultReadingMode").options.map((o) => o.label), ["Paged right-to-left", "Paged left-to-right", "Webtoon"]);
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
  assert.deepEqual(s.values, { showNsfw: true, defaultReadingMode: "paged-rtl", pageFit: "screen", webtoonWidth: "60", readerTheme: "theme", keepScreenOn: true, alwaysShowChapterTransition: true, skipRead: false, skipFiltered: true, skipDupe: false, flareSolverrEnabled: true, flareSolverrUrl: "http://localhost:8191", globalUpdateInterval: 12, excludeUnreadChapters: true, excludeNotStarted: true, excludeCompleted: true, defaultCategory: "ask", downloadsPath: "", downloadAsCbz: false, autoDownloadNewChapters: false, excludeEntryWithUnreadChapters: true, autoDownloadIgnoreReUploads: false, deleteAfterMarkRead: false, deleteAfterRead: "false", deleteBookmarked: false, syncFolder: "", backupPath: "", autoBackupIncludeCategories: true, autoBackupIncludeChapters: true, autoBackupIncludeTracking: true, autoBackupIncludeHistory: true });, trackAfterReading: true, trackOnMarkRead: "always", syncFolder: "" });
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
  assert.deepEqual(S.activate(mode, "webtoon"), { save: "paged-rtl" });
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
  assert.deepEqual(S.commit(backup, "/home/u/Backups", "/home/u", { syncFolder: "/home/u/Sync" }), { save: "/home/u/Backups" });
  assert.deepEqual(S.commit(backup, "", "/home/u", { syncFolder: "/home/u/Sync" }), { save: "" }, "blank is the server's own folder");
  assert.deepEqual(S.commit(sync, "~/Sync", "/home/u", { backupPath: "" }), { folder: "/home/u/Sync" });
  assert.ok(S.commit(backup, "Backups", "/home/u", {}).error, "a relative path");
});

test("saving the backup folder keeps the server password out of automatic backups", () => {
  assert.deepEqual(S.savePayload(row("backupPath"), "/home/u/Backups").variables.s, { backupPath: "/home/u/Backups", autoBackupIncludeServerSettings: false });
  assert.equal(S.display(row("backupPath"), ""), "server default");
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

test("the sync folder is the meta Setup writes, shown as not set until then", () => {
  const folder = row("syncFolder");
  assert.deepEqual(S.savePayload(folder, "/home/u/Sync").variables, { key: "miharchy.syncFolder", value: "/home/u/Sync" });
  assert.equal(S.display(folder, ""), "not set");
  assert.deepEqual(S.activate(folder, "/home/u/Sync"), { edit: "/home/u/Sync" });
});
