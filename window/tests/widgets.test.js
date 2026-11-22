const { test } = require("node:test");
const assert = require("node:assert/strict");
const W = require("./load")("Widgets.js");
const M = require("./load")("Model.js");
// MangaDex's and Weeb Central's filters and MangaDex's settings in the
// shape of core's source.filters and source.settings replies; groups cut to
// three children.
const F = require("./fixtures/source-widgets.json");

const ok = (data) => M.coreReply(200, JSON.stringify(data));
const fail = (message) => M.coreReply(502, JSON.stringify({ error: { kind: "upstream", message } }));
const row = (rows, label, option) => rows.find((r) => r.label === label && (option === undefined || r.option === option));

function loaded(kind, nodes) {
  const p = W.panel(kind, { id: "7", name: "S", core: true });
  return W.reducePanel(p, { type: "reply", reply: ok(kind === "filters" ? { filters: nodes } : { settings: nodes }) });
}

const filters = (nodes) => loaded("filters", nodes).widgets;
const send = (w) => W.filterChanges(w);

test("a fresh filter list sends no changes", () => {
  assert.deepEqual(send(filters(F.mangadexFilters)), []);
  assert.deepEqual(send(filters(F.weebCentralFilters)), []);
});

test("a checkbox toggles, and its state goes at its position in the full list", () => {
  let w = filters(F.mangadexFilters);
  w = W.activate(w, row(W.rows(w, {}), "Has available chapters")).widgets;
  assert.equal(send(w).length, F.mangadexFilters.length, "every filter sends its state, in the source's order");
  assert.deepEqual(send(w)[0], { state: true });
  assert.equal(row(W.rows(w, {}), "Has available chapters").mark, "[x]");
});

test("a group opens to its children; a child's state goes under the group's position", () => {
  let w = filters(F.mangadexFilters);
  const group = row(W.rows(w, {}), "Genre");
  assert.deepEqual(W.activate(w, group), { toggle: group.key });
  assert.equal(row(W.rows(w, {}), "Action"), undefined, "a closed group hides its children");
  const open = { [group.key]: true };
  const action = row(W.rows(w, open), "Action");
  assert.equal(action.depth, 1);
  w = W.activate(w, action).widgets;
  assert.deepEqual(send(w)[10].filters[0], { state: 1 });
  assert.equal(row(W.rows(w, open), "Genre").detail, "1 set");
});

test("a tri-state cycles ignore, include, exclude, ignore", () => {
  let w = filters(F.mangadexFilters);
  const open = { [row(W.rows(w, {}), "Genre").key]: true };
  const marks = [];
  for (let i = 0; i < 3; i++) {
    w = W.activate(w, row(W.rows(w, open), "Action")).widgets;
    marks.push(row(W.rows(w, open), "Action").mark);
  }
  assert.deepEqual(marks, ["[+]", "[-]", "[ ]"]);
  assert.deepEqual(send(w), []);
});

test("a select picks an option from its open list", () => {
  let w = filters(F.weebCentralFilters);
  const sort = row(W.rows(w, {}), "Sort");
  const open = { [sort.key]: true };
  const options = W.rows(w, open).filter((r) => r.key === sort.key && r.option !== -1);
  assert.deepEqual(options.map((r) => r.mark), ["(•)", "( )", "( )", "( )", "( )", "( )"]);
  w = W.activate(w, options[3]).widgets;
  assert.deepEqual(send(w)[0], { state: 3 });
  assert.equal(row(W.rows(w, {}), "Sort").detail, options[3].label);
});

test("sort: another field keeps the direction, the chosen field flips it (Mihon)", () => {
  let w = filters(F.mangadexFilters);
  const key = row(W.rows(w, {}), "Sort").key;
  const open = { [key]: true };
  const option = (k) => W.rows(w, open).find((r) => r.key === key && r.option === k);
  assert.equal(option(5).mark, " ↓ ", "the default sorts by relevance, descending");
  w = W.activate(w, option(0)).widgets;
  assert.deepEqual(send(w)[5], { state: { index: 0, ascending: false } });
  w = W.activate(w, option(0)).widgets;
  assert.deepEqual(send(w)[5], { state: { index: 0, ascending: true } });
  assert.equal(row(W.rows(w, {}), "Sort").detail, "Alphabetic ↑");
});

test("a text filter asks for its text, and a typed text is a change", () => {
  let w = filters(F.weebCentralFilters);
  const author = row(W.rows(w, {}), "Author (Case-sensitive)");
  assert.deepEqual(W.activate(w, author), { edit: "" });
  w = W.setText(w, author.path, "Oda");
  assert.deepEqual(send(w)[5], { state: "Oda" });
});

test("reset restores every default, inside groups too", () => {
  let w = filters(F.mangadexFilters);
  const open = { [row(W.rows(w, {}), "Genre").key]: true };
  w = W.activate(w, row(W.rows(w, open), "Action")).widgets;
  w = W.activate(w, row(W.rows(w, open), "Has available chapters")).widgets;
  assert.equal(W.changedCount(w), 2);
  w = W.reset(w);
  assert.equal(W.changedCount(w), 0);
  assert.deepEqual(send(w), []);
});

test("headers list as rows and take no edit; separators do not list", () => {
  const w = filters([{ type: "header", name: "Note" }, { type: "separator", name: "" }, { type: "checkbox", name: "A", state: false }]);
  const rows = W.rows(w, {});
  assert.deepEqual(rows.map((r) => r.label), ["Note", "A"]);
  assert.deepEqual(W.activate(w, rows[0]), {});
  assert.deepEqual(send(W.activate(w, rows[1]).widgets), [{}, {}, { state: true }], "the separator still counts for positions");
});

test("settings: a switch saves its new state by key", () => {
  const p = loaded("preferences", F.mangadexSettings);
  const r = row(W.rows(p.widgets, p.open), "Data saver");
  const w = W.activate(p.widgets, r).widgets;
  assert.deepEqual(W.savePayload(W.reducePanel(p, { type: "edit", widgets: w }), r.path), { route: "source.setSetting", body: { source: "7", key: "dataSaverV5_en", value: true } });
});

test("settings: a list shows the chosen entry in its %s summary and saves the entry value", () => {
  const p = loaded("preferences", F.mangadexSettings);
  const quality = row(W.rows(p.widgets, {}), "Cover quality");
  assert.equal(quality.summary, "Original");
  assert.equal(quality.detail, "", "the summary already names it");
  const open = { [quality.key]: true };
  const low = row(W.rows(p.widgets, open), "Low", 2);
  const w = W.activate(p.widgets, low).widgets;
  assert.equal(W.savePayload(Object.assign({}, p, { widgets: w }), low.path).body.value, ".256.jpg");
  assert.equal(row(W.rows(w, {}), "Cover quality").summary, "Low");
});

test("settings: a multi-select toggles one entry and saves the whole set in entry order", () => {
  const p = loaded("preferences", F.mangadexSettings);
  const key = row(W.rows(p.widgets, {}), "Default content rating").key;
  const open = { [key]: true };
  assert.equal(row(W.rows(p.widgets, {}), "Default content rating").detail, "Safe, Suggestive");
  let w = W.activate(p.widgets, row(W.rows(p.widgets, open), "Erotica")).widgets;
  w = W.activate(w, row(W.rows(w, open), "Safe")).widgets;
  const path = row(W.rows(w, {}), "Default content rating").path;
  assert.deepEqual(W.savePayload(Object.assign({}, p, { widgets: w }), path).body.value, ["suggestive", "erotica"]);
});

test("settings: a text field saves its text", () => {
  const p = loaded("preferences", F.mangadexSettings);
  const r = row(W.rows(p.widgets, {}), "Block groups by UUID");
  assert.deepEqual(W.activate(p.widgets, r), { edit: "" });
  assert.equal(W.savePayload(Object.assign({}, p, { widgets: W.setText(p.widgets, r.path, "abc") }), r.path).body.value, "abc");
});

test("settings: a disabled one takes no edit", () => {
  const w = loaded("preferences", [
    { key: "b", type: "switch", title: "Off", summary: "", enabled: false, value: true },
    { key: "c", type: "switch", title: "On", summary: "", enabled: true, value: false }
  ]).widgets;
  const rows = W.rows(w, {});
  assert.deepEqual(rows.map((r) => r.label), ["Off", "On"]);
  assert.deepEqual(W.activate(w, rows[0]), {});
  assert.equal(rows[1].mark, "[ ]");
});

test("a saved setting shows what core stored; a failed save puts the old value back", () => {
  const p = loaded("preferences", F.mangadexSettings);
  const r = row(W.rows(p.widgets, {}), "Data saver");
  const edited = W.reducePanel(p, { type: "edit", widgets: W.activate(p.widgets, r).widgets });
  const stored = F.mangadexSettings.map((n) => (n.key === "dataSaverV5_en" ? Object.assign({}, n, { value: true }) : n));
  const saved = W.reducePanel(edited, { type: "reply", before: p.widgets, reply: ok({ accepted: true, settings: stored }) });
  assert.equal(row(W.rows(saved.widgets, {}), "Data saver").mark, "[x]");
  assert.equal(p.saved, false);
  assert.equal(saved.saved, true, "the listing is stale once a save lands");
  const failed = W.reducePanel(edited, { type: "reply", before: p.widgets, reply: fail("Expected change to SwitchPreferenceCompat") });
  assert.equal(row(W.rows(failed.widgets, {}), "Data saver").mark, "[ ]");
  assert.match(failed.error, /Expected change/);
  assert.equal(failed.state, "ok", "the panel stays open on its list");
});

test("a failed load keeps the connection state for Model.problem", () => {
  const p = W.reducePanel(W.panel("filters", { id: "7" }), { type: "reply", reply: M.coreReply(0, "") });
  assert.equal(p.state, "down");
});

test("the cursor stays on a row when a list closes under it", () => {
  let p = loaded("filters", F.mangadexFilters);
  const key = row(W.rows(p.widgets, {}), "Theme").key;
  p = W.reducePanel(p, { type: "toggle", key });
  p = W.reducePanel(p, { type: "move", delta: 100 });
  const last = W.rows(p.widgets, p.open).length - 1;
  assert.equal(p.cursor, last);
  p = W.reducePanel(p, { type: "toggle", key });
  assert.equal(p.cursor, W.rows(p.widgets, p.open).length - 1);
  assert.equal(W.reducePanel(p, { type: "move", delta: -100 }).cursor, 0);
});
