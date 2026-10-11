const { test } = require("node:test");
const assert = require("node:assert/strict");
const O = require("./load")("Overlays.js");
const C = require("./load")("Commands.js");

// The window with nothing open, on the Library; each change(s) opens one thing.
const state = (...changes) => {
  const s = {
    trackAsk: null, readingCard: { open: false }, nextChapters: { open: false, editing: false, hint: "NC" },
    restoreView: { open: false, editing: false, restore: { step: "confirm" } },
    syncView: { open: false, sync: { state: "done" }, healthMode: false }, downloadsView: { open: false },
    reader: { open: false, panelOpen: false, editing: false },
    migrateView: { open: false, step: "search", editing: false, hint: "MG" },
    trackPanel: { open: false, picking: false, editing: false, hint: "TP" },
    mangaDetail: { open: false, dupesOpen: false, picking: false, optionsOpen: false, downloadsOpen: false, selecting: false, editing: false, writing: false, hint: "MD" },
    view: "library", browseView: { scope: "sources", editing: "", panel: null, screen: "sources", hint: "BR" },
    extensionsView: { details: false, editing: "", hint: "EX" }, libraryScreen: "", checkView: { merging: false, hint: "CK" },
    libraryArmed: "", libraryPickIds: [], libraryOptions: false, updatesView: { filterOpen: false, hint: "UP" },
    settingsEditing: false, libraryView: { editing: false }, historyView: { editing: false, hint: "HI" },
    settingsView: { loginEditing: false }, setupView: { editing: false, confirming: false },
    categoriesView: { editing: "" }, libraryHint: "LB",
  };
  changes.forEach((c) => c(s));
  return s;
};
const top = (...changes) => O.top(state(...changes));

const trackAsk = (s) => (s.trackAsk = { mangaIds: [1] });
const card = (s) => (s.readingCard.open = true);
const next = (s) => (s.nextChapters.open = true);
const restore = (step) => (s) => { s.restoreView.open = true; s.restoreView.restore.step = step; s.restoreView.editing = step === "path"; };
const sync = (s) => (s.syncView.open = true);
const held = (s) => { s.syncView.open = true; s.syncView.sync.state = "held"; };
const downloads = (s) => (s.downloadsView.open = true);
const reader = (s) => (s.reader.open = true);
const migrate = (step) => (s) => { s.migrateView.open = true; s.migrateView.step = step; };
const track = (s) => (s.trackPanel.open = true);
const manga = (s) => (s.mangaDetail.open = true);
const set = (path, value) => (s) => {
  const keys = path.split(".");
  keys.slice(0, -1).reduce((o, k) => o[k], s)[keys.at(-1)] = value;
};

test("the top open overlay gives the scope, in stack order", () => {
  const cases = [
    [[trackAsk, card], "track-ask"],
    [[card, next], "reading-card"],
    [[next, restore("confirm")], "next-chapters"],
    [[restore("running"), sync], "restore-running"],
    [[sync, downloads], "sync"],
    [[held], "sync-held"],
    [[held, set("syncView.healthMode", true)], "sync"],
    [[downloads, reader], "downloads"],
    [[reader, migrate("from")], "reader"],
    [[reader, set("reader.panelOpen", true)], "reader-settings"],
    [[migrate("match"), track], "migrate-match"],
    [[track, manga], "manga-track"],
    [[track, set("trackPanel.picking", true)], "manga-track-pick"],
    [[manga], "manga"],
    [[manga, set("mangaDetail.dupesOpen", true), set("mangaDetail.picking", true)], "manga-duplicates"],
    [[manga, set("mangaDetail.picking", true), set("mangaDetail.optionsOpen", true)], "manga-categories"],
    [[manga, set("mangaDetail.optionsOpen", true), set("mangaDetail.downloadsOpen", true)], "manga-options"],
    [[manga, set("mangaDetail.downloadsOpen", true), set("mangaDetail.selecting", true)], "manga-download"],
    [[manga, set("mangaDetail.selecting", true)], "manga-select"],
  ];
  for (const [changes, scope] of cases) assert.equal(top(...changes).scope, scope);
});

test("with no overlay open, the view or a screen inside it gives the scope", () => {
  const cases = [
    [[], "library"],
    [[set("libraryScreen", "categories"), set("libraryArmed", "remove")], "categories"],
    [[set("libraryArmed", "remove"), set("libraryPickIds", [1])], "library-remove"],
    [[set("libraryPickIds", [1]), set("libraryOptions", true)], "library-categories"],
    [[set("libraryOptions", true)], "library-options"],
    [[set("view", "updates")], "updates"],
    [[set("view", "updates"), set("updatesView.filterOpen", true)], "updates-filter"],
    [[set("view", "check")], "check"],
    [[set("view", "check"), set("checkView.merging", true)], "check-merge"],
    [[set("view", "browse"), set("browseView.scope", "source-filters")], "source-filters"],
    [[set("view", "browse"), set("browseView.scope", "extensions")], "extensions"],
    [[set("view", "browse"), set("browseView.scope", "extensions"), set("extensionsView.details", true)], "extension"],
    // Library screens apply on the Library only.
    [[set("view", "history"), set("libraryOptions", true)], "history"],
  ];
  for (const [changes, scope] of cases) assert.equal(top(...changes).scope, scope);
});

test("the first editing field gives the prefix, whether or not it is on top", () => {
  assert.equal(top().editing, "");
  assert.equal(top(set("nextChapters.editing", true), set("restoreView.editing", true)).editing, "nextChapters");
  assert.equal(top(set("reader.editing", true), set("settingsEditing", true)).editing, "reader");
  assert.equal(top(set("libraryView.editing", true), reader).editing, "library");
  assert.equal(top(set("settingsView.loginEditing", true), set("trackPanel.editing", true)).editing, "login");
  assert.equal(top(set("mangaDetail.editing", true), set("migrateView.editing", true)).editing, "manga");
  assert.equal(top(set("migrateView.editing", true), set("extensionsView.editing", "x")).editing, "migrate");
  assert.equal(top(set("setupView.editing", true), set("categoriesView.editing", "c")).editing, "setup");
  assert.equal(top(set("categoriesView.editing", "c"), set("browseView.editing", "source")).editing, "categories");
  assert.equal(top(set("browseView.editing", "source-filters")).editing, "source-filters");
});

test("the hint follows the top overlay, its editing field, or the view", () => {
  const cases = [
    [[trackAsk, set("libraryView.editing", true)], "y update   n keep"],
    [[sync, set("libraryView.editing", true)], ""],
    [[restore("path")], ""],
    [[set("libraryView.editing", true)], "enter keep   esc clear"],
    [[manga, set("mangaDetail.editing", true), set("mangaDetail.writing", true)], "enter save   shift+enter new line   esc cancel"],
    [[next, set("nextChapters.editing", true)], "enter save   esc cancel"],
    [[set("view", "setup"), set("setupView.confirming", true)], "y run   n cancel"],
    [[next], "NC: commands   q quit"],
    [[migrate("search"), track], "MG: commands   q quit"],
    [[track, manga], "TP: commands   q quit"],
    [[manga], "MD: commands   q quit"],
    // The reading card, the download queue and the reader draw over the hint bar.
    [[card], "LB: commands   r reload   q quit"],
    [[set("view", "updates")], "UP: commands   r reload   q quit"],
    [[set("view", "history")], "HI: commands   r reload   q quit"],
    [[set("view", "settings")], "j k move   enter change   : commands   r reload   q quit"],
    [[set("view", "setup")], "j k move   enter act   : commands   r reload   q quit"],
    [[set("view", "check")], "CK: commands   r reload   q quit"],
    [[set("view", "browse")], "BR: commands   q quit"],
    [[set("view", "browse"), set("browseView.screen", "extensions")], "EXBR: commands   q quit"],
    [[set("view", "browse"), set("browseView.screen", "extensions"), set("extensionsView.details", true)], "EX: commands   q quit"],
    [[set("view", "browse"), set("browseView.screen", "extensions"), set("browseView.panel", {})], "BR: commands   q quit"],
  ];
  for (const [changes, hint] of cases) assert.equal(top(...changes).hint, hint);
});

test("the hint names the field that takes the keys", () => {
  assert.equal(top(next, set("nextChapters.editing", true), set("libraryView.editing", true)).hint, "enter save   esc cancel");
  assert.equal(top(next, restore("confirm")).hint, "NC: commands   q quit");
});

// A command for a scope nothing returns never runs. Browse screens, restore
// steps and migration steps come from their views, so they are inputs here.
test("every overlay or screen scope in Commands.js is one the stack returns", () => {
  const views = ["library", "updates", "history", "settings", "browse", "setup", "check"];
  const browse = ["sources", "extensions", "source", "global", "source-filters", "source-settings", "sources-languages"];
  const restores = ["path", "checking", "confirm", "running", "done", "failed"];
  const migrates = ["search", "from", "to", "match", "confirm", "busy", "done"];
  const states = [
    [trackAsk], [card], [next], [sync], [held], [downloads], [reader], [reader, set("reader.panelOpen", true)],
    [track], [track, set("trackPanel.picking", true)],
    ...["dupesOpen", "picking", "optionsOpen", "downloadsOpen", "selecting"].map((k) => [manga, set("mangaDetail." + k, true)]), [manga],
    ...views.map((v) => [set("view", v)]),
    ...browse.map((b) => [set("view", "browse"), set("browseView.scope", b)]),
    [set("view", "browse"), set("browseView.scope", "extensions"), set("extensionsView.details", true)],
    [set("libraryScreen", "categories")], [set("libraryArmed", "remove")], [set("libraryPickIds", [1])], [set("libraryOptions", true)],
    [set("view", "updates"), set("updatesView.filterOpen", true)], [set("view", "check"), set("checkView.merging", true)],
    ...restores.map((r) => [restore(r)]), ...migrates.map((m) => [migrate(m)]),
  ];
  const returned = new Set(states.map((changes) => top(...changes).scope));
  const named = new Set(C.commands.flatMap((c) => (c.view === undefined ? [] : [].concat(c.view))));
  for (const scope of named) assert.ok(returned.has(scope), `Commands.js names scope "${scope}", which Overlays.js never returns`);
});
