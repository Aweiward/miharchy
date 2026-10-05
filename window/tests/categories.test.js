const { test } = require("node:test");
const assert = require("node:assert/strict");
const K = require("./load")("Categories.js");

const cats = [{ id: 4, name: "Action" }, { id: 2, name: "Romance" }, { id: 7, name: "Later" }];

test("a name is trimmed and must not be blank", () => {
  assert.deepEqual(K.checkName("  Drama ", cats), { name: "Drama" });
  assert.ok(K.checkName("   ", cats).error);
});

test("a name already taken, or Default in any case, is refused", () => {
  assert.match(K.checkName("Romance", cats).error, /already/);
  assert.match(K.checkName("default", cats).error, /Default/);
  assert.deepEqual(K.checkName("romance", cats), { name: "romance" }, "the server's uniqueness is case-sensitive");
});

test("a rename may keep the category's own name or change its case, but not take another's", () => {
  assert.deepEqual(K.checkName("Action", cats, 4), { name: "Action" });
  assert.deepEqual(K.checkName("ACTION", cats, 4), { name: "ACTION" });
  assert.match(K.checkName("Romance", cats, 4).error, /already/);
});

test("create, rename and delete send the category mutations", () => {
  assert.deepEqual(K.createPayload("Drama").variables, { name: "Drama" });
  assert.match(K.createPayload("Drama").query, /createCategory/);
  assert.deepEqual(K.renamePayload(4, "Fights").variables, { id: 4, name: "Fights" });
  assert.match(K.renamePayload(4, "Fights").query, /updateCategory\(/);
  assert.equal(K.deletePayload(cats, 2).variables.id, 2);
  assert.match(K.deletePayload(cats, 2).query, /deleteCategory/);
});

test("a move goes one place up or down, as a 1-based position after Default; none past either end", () => {
  assert.deepEqual(K.movePayload(cats, 1, -1).variables, { id: 2, position: 1 });
  assert.deepEqual(K.movePayload(cats, 1, 1).variables, { id: 2, position: 3 });
  assert.match(K.movePayload(cats, 1, 1).query, /updateCategoryOrder/);
  assert.equal(K.movePayload(cats, 0, -1), null);
  assert.equal(K.movePayload(cats, 2, 1), null);
  assert.equal(K.movePayload([], 0, 1), null);
});

test("rows count the library manga in each category", () => {
  const manga = [{ id: 1, categories: [4, 2] }, { id: 3, categories: [4] }, { id: 5, categories: [] }];
  assert.deepEqual(K.rows(cats, manga), [
    { id: 4, name: "Action", download: false, update: "UNSET", keep: false, count: 2 },
    { id: 2, name: "Romance", download: false, update: "UNSET", keep: false, count: 1 },
    { id: 7, name: "Later", download: false, update: "UNSET", keep: false, count: 0 }
  ]);
});

test("p flags a category to keep its read downloads in its meta, and again lets them go", () => {
  const p = K.keepPayload([{ id: 4, keep: false }], 4);
  assert.match(p.query, /setCategoryMeta/);
  assert.deepEqual(p.variables, { meta: { categoryId: 4, key: "miharchy.keepDownloads", value: "true" } });
  assert.equal(K.keepPayload([{ id: 4, keep: true }], 4).variables.meta.value, "false");
});

const flagged = [{ id: 4, name: "Action", download: true }, { id: 2, name: "Romance", download: false }];

test("d flags a category for auto-download and turns the server's auto-download on with it", () => {
  const p = K.autoDownloadPayload(flagged, 2);
  assert.match(p.query, /updateCategory\(input: \{ id: \$id, patch: \{ includeInDownload: \$include \} \}\)/);
  assert.match(p.query, /setSettings/);
  assert.deepEqual(p.variables, { id: 2, include: "INCLUDE", on: true });
});

test("the server downloads every unflagged category once none is flagged, so the last flag off turns auto-download off", () => {
  assert.deepEqual(K.autoDownloadPayload(flagged, 4).variables, { id: 4, include: "UNSET", on: false });
  const both = flagged.map((c) => Object.assign({}, c, { download: true }));
  assert.deepEqual(K.autoDownloadPayload(both, 4).variables, { id: 4, include: "UNSET", on: true });
});

test("deleting the last flagged category turns auto-download off too", () => {
  assert.deepEqual(K.deletePayload(flagged, 4).variables, { id: 4, on: false });
  assert.deepEqual(K.deletePayload(flagged, 2).variables, { id: 2, on: true });
  assert.match(K.deletePayload(flagged, 4).query, /setSettings/);
});

test("u cycles a category through unset, included in updates and excluded from them", () => {
  const states = ["UNSET", "INCLUDE", "EXCLUDE"].map((update) => [{ id: 4, name: "Action", update }]);
  assert.deepEqual(states.map((c) => K.updatePayload(c, 4).variables), [
    { id: 4, include: "INCLUDE" },
    { id: 4, include: "EXCLUDE" },
    { id: 4, include: "UNSET" }
  ]);
  assert.match(K.updatePayload(states[0], 4).query, /updateCategory\(input: \{ id: \$id, patch: \{ includeInUpdate: \$include \} \}\)/);
});

test("auto-download skips no manga for its unread chapters: the flag means every new chapter", () => {
  assert.match(K.autoDownloadPayload(flagged, 2).query, /excludeEntryWithUnreadChapters: false/);
});
