const { test } = require("node:test");
const assert = require("node:assert/strict");
const P = require("./load")("Prefs.js");

const TABLE = [
  { key: "librarySort", default: "title", options: ["title", "unread"] },
  { key: "librarySortDirection", default: "asc", options: ["asc", "desc"] }
];
const metas = (nodes) => ({ metas: { nodes } });

test("defaults hold every choice of the table", () => {
  assert.deepEqual(P.defaults(TABLE), { librarySort: "title", librarySortDirection: "asc" });
});

test("the load asks only for the table's keys under miharchy.", () => {
  const p = P.loadPayload(TABLE);
  assert.match(p.query, /metas\(filter: \{ key: \{ in: \$keys \} \}\) \{ nodes \{ key value \} \}/);
  assert.deepEqual(p.variables, { keys: ["miharchy.librarySort", "miharchy.librarySortDirection"] });
});

test("a load reply sets the stored choices; a missing or unknown value keeps what was there", () => {
  const was = { librarySort: "unread", librarySortDirection: "desc" };
  assert.deepEqual(P.read(TABLE, metas([{ key: "miharchy.librarySort", value: "title" }]), was), { librarySort: "title", librarySortDirection: "desc" });
  assert.deepEqual(P.read(TABLE, metas([{ key: "miharchy.librarySort", value: "random" }, { key: "librarySortDirection", value: "asc" }]), was), was);
  assert.deepEqual(P.read(TABLE, {}, P.defaults(TABLE)), P.defaults(TABLE));
});

test("a save round-trips: its payload stores a string, and its reply reads back the same value", () => {
  const p = P.savePayload("librarySortDirection", "desc");
  assert.match(p.query, /setGlobalMeta\(input: \{ meta: \{ key: \$key, value: \$value \} \}\) \{ meta \{ key value \} \}/);
  assert.deepEqual(p.variables, { key: "miharchy.librarySortDirection", value: "desc" });
  const reply = { setGlobalMeta: { meta: { key: p.variables.key, value: p.variables.value } } };
  assert.deepEqual(P.read(TABLE, reply, P.defaults(TABLE)), { librarySort: "title", librarySortDirection: "desc" });
});

test("read never changes the values it is given", () => {
  const was = P.defaults(TABLE);
  P.read(TABLE, metas([{ key: "miharchy.librarySort", value: "unread" }]), was);
  assert.equal(was.librarySort, "title");
});
