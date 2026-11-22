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

test("a move goes one place up or down, as a 1-based position after Default; none past either end", () => {
  assert.deepEqual(K.movePayload(cats, 1, -1), { route: "category.reorder", body: { id: 2, position: 1 } });
  assert.deepEqual(K.movePayload(cats, 1, 1), { route: "category.reorder", body: { id: 2, position: 3 } });
  assert.equal(K.movePayload(cats, 0, -1), null);
  assert.equal(K.movePayload(cats, 2, 1), null);
  assert.equal(K.movePayload([], 0, 1), null);
});

test("rows count the library manga in each category", () => {
  const manga = [{ id: 1, categories: [4, 2] }, { id: 3, categories: [4] }, { id: 5, categories: [] }];
  assert.deepEqual(K.rows(cats, manga), [
    { id: 4, name: "Action", download: "UNSET", update: "UNSET", keep: false, count: 2 },
    { id: 2, name: "Romance", download: "UNSET", update: "UNSET", keep: false, count: 1 },
    { id: 7, name: "Later", download: "UNSET", update: "UNSET", keep: false, count: 0 }
  ]);
});

test("p flags a category to keep its read downloads in its meta, and again lets them go", () => {
  const meta = (value) => ({ route: "meta.set", body: { metas: [{ scope: "category", owner: 4, key: "miharchy.keepDownloads", value }] } });
  assert.deepEqual(K.keepPayload([{ id: 4, keep: false }], 4), meta("true"));
  assert.deepEqual(K.keepPayload([{ id: 4, keep: true }], 4), meta("false"));
});

for (const [key, kind, field] of [["u", "update", "includeInUpdate"], ["d", "download", "includeInDownload"]]) {
  test(key + " cycles a category through unset, included in and excluded from " + kind + "s", () => {
    const states = ["UNSET", "INCLUDE", "EXCLUDE"].map((state) => [{ id: 4, name: "Action", [kind]: state }]);
    assert.deepEqual(states.map((c) => K.includePayload(c, 4, kind)), ["INCLUDE", "EXCLUDE", "UNSET"].map((include) => (
      { route: "category.update", body: { id: 4, [field]: include } }
    )));
  });
}

test("a category's id comes back from the create reply", () => {
  assert.equal(K.createdId({ category: { id: 9 } }), 9);
});
