const { test } = require("node:test");
const assert = require("node:assert/strict");
const W = require("./load")("Widgets.js");
const M = require("./load")("Model.js");
// Replies from Suwayomi v2.3.2243 to Widgets' own queries; groups cut to
// three children.
const F = require("./fixtures/source-widgets.json");

const ok = (data) => M.reply(200, JSON.stringify({ data }));
const fail = (message) => M.reply(200, JSON.stringify({ errors: [{ message }] }));
const row = (rows, label, option) => rows.find((r) => r.label === label && (option === undefined || r.option === option));

function loaded(kind, nodes) {
  const p = W.panel(kind, { id: "7", name: "S" });
  const source = kind === "filters" ? { filters: nodes } : { preferences: nodes };
  return W.reducePanel(p, { type: "reply", reply: ok({ source }) });
}

test("a fresh filter list sends no changes", () => {
  assert.deepEqual(W.filterChanges(W.fromFilters(F.mangadexFilters)), []);
  assert.deepEqual(W.filterChanges(W.fromFilters(F.weebCentralFilters)), []);
});

test("a checkbox toggles, and its change names its position in the full list", () => {
  let w = W.fromFilters(F.mangadexFilters);
  w = W.activate(w, row(W.rows(w, {}), "Has available chapters")).widgets;
  assert.deepEqual(W.filterChanges(w), [{ position: 0, checkBoxState: true }]);
  assert.equal(row(W.rows(w, {}), "Has available chapters").mark, "[x]");
});

test("a group opens to its children; a child's change goes under the group's position", () => {
  let w = W.fromFilters(F.mangadexFilters);
  const group = row(W.rows(w, {}), "Genre");
  assert.deepEqual(W.activate(w, group), { toggle: group.key });
  assert.equal(row(W.rows(w, {}), "Action"), undefined, "a closed group hides its children");
  const open = { [group.key]: true };
  const action = row(W.rows(w, open), "Action");
  assert.equal(action.depth, 1);
  w = W.activate(w, action).widgets;
  assert.deepEqual(W.filterChanges(w), [{ position: 10, groupChange: { position: 0, triState: "INCLUDE" } }]);
  assert.equal(row(W.rows(w, open), "Genre").detail, "1 set");
});

test("a tri-state cycles ignore, include, exclude, ignore", () => {
  let w = W.fromFilters(F.mangadexFilters);
  const open = { [row(W.rows(w, {}), "Genre").key]: true };
  const marks = [];
  for (let i = 0; i < 3; i++) {
    w = W.activate(w, row(W.rows(w, open), "Action")).widgets;
    marks.push(row(W.rows(w, open), "Action").mark);
  }
  assert.deepEqual(marks, ["[+]", "[-]", "[ ]"]);
  assert.deepEqual(W.filterChanges(w), []);
});

test("a select picks an option from its open list", () => {
  let w = W.fromFilters(F.weebCentralFilters);
  const sort = row(W.rows(w, {}), "Sort");
  const open = { [sort.key]: true };
  const options = W.rows(w, open).filter((r) => r.key === sort.key && r.option !== -1);
  assert.deepEqual(options.map((r) => r.mark), ["(•)", "( )", "( )", "( )", "( )", "( )"]);
  w = W.activate(w, options[3]).widgets;
  assert.deepEqual(W.filterChanges(w), [{ position: 0, selectState: 3 }]);
  assert.equal(row(W.rows(w, {}), "Sort").detail, options[3].label);
});

test("sort: another field keeps the direction, the chosen field flips it (Mihon)", () => {
  let w = W.fromFilters(F.mangadexFilters);
  const key = row(W.rows(w, {}), "Sort").key;
  const open = { [key]: true };
  const option = (k) => W.rows(w, open).find((r) => r.key === key && r.option === k);
  assert.equal(option(5).mark, " ↓ ", "the default sorts by relevance, descending");
  w = W.activate(w, option(0)).widgets;
  assert.deepEqual(W.filterChanges(w), [{ position: 5, sortState: { index: 0, ascending: false } }]);
  w = W.activate(w, option(0)).widgets;
  assert.deepEqual(W.filterChanges(w), [{ position: 5, sortState: { index: 0, ascending: true } }]);
  assert.equal(row(W.rows(w, {}), "Sort").detail, "Alphabetic ↑");
});

test("a text filter asks for its text, and a typed text is a change", () => {
  let w = W.fromFilters(F.weebCentralFilters);
  const author = row(W.rows(w, {}), "Author (Case-sensitive)");
  assert.deepEqual(W.activate(w, author), { edit: "" });
  w = W.setText(w, author.path, "Oda");
  assert.deepEqual(W.filterChanges(w), [{ position: 5, textState: "Oda" }]);
});

test("reset restores every default, inside groups too", () => {
  let w = W.fromFilters(F.mangadexFilters);
  const open = { [row(W.rows(w, {}), "Genre").key]: true };
  w = W.activate(w, row(W.rows(w, open), "Action")).widgets;
  w = W.activate(w, row(W.rows(w, open), "Has available chapters")).widgets;
  assert.equal(W.changedCount(w), 2);
  w = W.reset(w);
  assert.equal(W.changedCount(w), 0);
  assert.deepEqual(W.filterChanges(w), []);
});

test("headers list as rows and take no edit; separators do not list", () => {
  const w = W.fromFilters([{ __typename: "HeaderFilter", name: "Note" }, { __typename: "SeparatorFilter", name: "" }, { __typename: "CheckBoxFilter", name: "A", checkBox: false }]);
  const rows = W.rows(w, {});
  assert.deepEqual(rows.map((r) => r.label), ["Note", "A"]);
  assert.deepEqual(W.activate(w, rows[0]), {});
  assert.deepEqual(W.filterChanges(W.activate(w, rows[1]).widgets), [{ position: 2, checkBoxState: true }], "the separator still counts for positions");
});

test("preferences: a switch saves its new state by position", () => {
  const p = loaded("preferences", F.mangadexPreferences);
  const r = row(W.rows(p.widgets, p.open), "Data saver");
  const w = W.activate(p.widgets, r).widgets;
  assert.deepEqual(W.savePayload(W.reducePanel(p, { type: "edit", widgets: w }), r.path).variables, { source: "7", change: { position: 2, switchState: true } });
});

test("preferences: a list shows the chosen entry in its %s summary and saves the entry value", () => {
  const p = loaded("preferences", F.mangadexPreferences);
  const quality = row(W.rows(p.widgets, {}), "Cover quality");
  assert.equal(quality.summary, "Original");
  assert.equal(quality.detail, "", "the summary already names it");
  const open = { [quality.key]: true };
  const low = row(W.rows(p.widgets, open), "Low", 2);
  const w = W.activate(p.widgets, low).widgets;
  assert.deepEqual(W.preferenceChange(w, low.path), { position: 0, listState: ".256.jpg" });
  assert.equal(row(W.rows(w, {}), "Cover quality").summary, "Low");
});

test("preferences: a multi-select toggles one entry and saves the whole set in entry order", () => {
  const p = loaded("preferences", F.mangadexPreferences);
  const key = row(W.rows(p.widgets, {}), "Default content rating").key;
  const open = { [key]: true };
  assert.equal(row(W.rows(p.widgets, {}), "Default content rating").detail, "Safe, Suggestive");
  let w = W.activate(p.widgets, row(W.rows(p.widgets, open), "Erotica")).widgets;
  w = W.activate(w, row(W.rows(w, open), "Safe")).widgets;
  const path = row(W.rows(w, {}), "Default content rating").path;
  assert.deepEqual(W.preferenceChange(w, path), { position: 8, multiSelectState: ["suggestive", "erotica"] });
});

test("preferences: a text field saves as editTextState", () => {
  const p = loaded("preferences", F.mangadexPreferences);
  const r = row(W.rows(p.widgets, {}), "Block groups by UUID");
  assert.deepEqual(W.activate(p.widgets, r), { edit: "" });
  assert.deepEqual(W.preferenceChange(W.setText(p.widgets, r.path, "abc"), r.path), { position: 10, editTextState: "abc" });
});

test("preferences: a hidden one does not list but keeps its position; a disabled one takes no edit", () => {
  const nodes = [
    { __typename: "SwitchPreference", key: "a", title: "Hidden", summary: null, visible: false, enabled: true, switchValue: false, switchDefault: false },
    { __typename: "CheckBoxPreference", key: "b", title: "Off", summary: null, visible: true, enabled: false, checkValue: true, checkDefault: false },
    { __typename: "CheckBoxPreference", key: "c", title: "On", summary: null, visible: true, enabled: true, checkValue: null, checkDefault: true }
  ];
  const w = W.fromPreferences(nodes);
  const rows = W.rows(w, {});
  assert.deepEqual(rows.map((r) => r.label), ["Off", "On"]);
  assert.deepEqual(W.activate(w, rows[0]), {});
  assert.equal(rows[1].mark, "[x]", "no current value reads as the default");
  assert.deepEqual(W.preferenceChange(W.activate(w, rows[1]).widgets, rows[1].path), { position: 2, checkBoxState: false });
});

test("a saved preference shows what the server stored; a failed save puts the old value back", () => {
  const p = loaded("preferences", F.mangadexPreferences);
  const r = row(W.rows(p.widgets, {}), "Data saver");
  const edited = W.reducePanel(p, { type: "edit", widgets: W.activate(p.widgets, r).widgets });
  const stored = F.mangadexPreferences.map((n) => (n.key === "dataSaverV5_en" ? Object.assign({}, n, { switchValue: true }) : n));
  const saved = W.reducePanel(edited, { type: "reply", before: p.widgets, reply: ok({ updateSourcePreference: { preferences: stored } }) });
  assert.equal(row(W.rows(saved.widgets, {}), "Data saver").mark, "[x]");
  assert.equal(p.saved, false);
  assert.equal(saved.saved, true, "the listing is stale once a save lands");
  const failed = W.reducePanel(edited, { type: "reply", before: p.widgets, reply: fail("Expected change to SwitchPreferenceCompat") });
  assert.equal(row(W.rows(failed.widgets, {}), "Data saver").mark, "[ ]");
  assert.match(failed.error, /Expected change/);
  assert.equal(failed.state, "ok", "the panel stays open on its list");
});

test("a failed load keeps the connection state for Model.problem", () => {
  const p = W.reducePanel(W.panel("filters", { id: "7" }), { type: "reply", reply: M.reply(0, "") });
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

test("the load payload asks the source for its filters or its preferences", () => {
  assert.deepEqual(W.loadPayload(W.panel("filters", { id: "7" })), { query: W.FILTERS_QUERY, variables: { id: "7" } });
  assert.equal(W.loadPayload(W.panel("preferences", { id: "7" })).query, W.PREFERENCES_QUERY);
});
