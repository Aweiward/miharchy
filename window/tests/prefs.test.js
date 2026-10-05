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

test("a manga's load asks for the global defaults and the manga's meta; the manga's own choice wins", () => {
  const p = P.loadPayload(TABLE, 7);
  assert.match(p.query, /manga\(id: \$id\) \{ meta \{ key value \} \}/);
  assert.deepEqual(p.variables, { keys: ["miharchy.librarySort", "miharchy.librarySortDirection"], id: 7 });
  const data = {
    metas: { nodes: [{ key: "miharchy.librarySort", value: "unread" }, { key: "miharchy.librarySortDirection", value: "desc" }] },
    manga: { meta: [{ key: "miharchy.librarySort", value: "title" }, { key: "miharchy.readingMode", value: "webtoon" }] }
  };
  assert.deepEqual(P.read(TABLE, data, P.defaults(TABLE)), { librarySort: "title", librarySortDirection: "desc" });
});

test("a manga's save goes to its manga meta", () => {
  const p = P.savePayload("librarySort", "unread", 7);
  assert.match(p.query, /setMangaMeta\(input: \{ meta: \{ mangaId: \$id, key: \$key, value: \$value \} \}\)/);
  assert.deepEqual(p.variables, { id: 7, key: "miharchy.librarySort", value: "unread" });
});

test("a reset drops the table's keys from each manga's meta, so they follow the global default", () => {
  const p = P.resetPayload(TABLE, [1, 2]);
  assert.match(p.query, /deleteMangaMetas\(input: \{ items: \[\{ mangaIds: \$ids, keys: \$keys \}\] \}\)/);
  assert.deepEqual(p.variables, { ids: [1, 2], keys: ["miharchy.librarySort", "miharchy.librarySortDirection"] });
  assert.equal(P.resetPayload(TABLE, []), null);
});

test("the save queue keeps one entry per scope and key, in place, with the latest payload", () => {
  const save = (scope, key, value) => ({ scope, key, payload: { value } });
  let q = P.enqueue([], save("global", "a", 1));
  q = P.enqueue(q, save("manga:7", "a", 2));
  q = P.enqueue(q, save("global", "b", 3));
  q = P.enqueue(q, save("global", "a", 4));
  assert.deepEqual(q.map((e) => [e.scope, e.key, e.payload.value]), [["global", "a", 4], ["manga:7", "a", 2], ["global", "b", 3]]);
  assert.equal(P.scope(), "global");
  assert.equal(P.scope(7), "manga:7");
});

test("read never changes the values it is given", () => {
  const was = P.defaults(TABLE);
  P.read(TABLE, metas([{ key: "miharchy.librarySort", value: "unread" }]), was);
  assert.equal(was.librarySort, "title");
});
