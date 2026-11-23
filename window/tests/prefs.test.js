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

test("a load reply sets the stored choices; a missing or unknown value keeps what was there", () => {
  const was = { librarySort: "unread", librarySortDirection: "desc" };
  assert.deepEqual(P.read(TABLE, metas([{ key: "miharchy.librarySort", value: "title" }]), was), { librarySort: "title", librarySortDirection: "desc" });
  assert.deepEqual(P.read(TABLE, metas([{ key: "miharchy.librarySort", value: "random" }, { key: "librarySortDirection", value: "asc" }]), was), was);
  assert.deepEqual(P.read(TABLE, {}, P.defaults(TABLE)), P.defaults(TABLE));
});

test("the manga's own choice wins over the global defaults", () => {
  const data = {
    metas: { nodes: [{ key: "miharchy.librarySort", value: "unread" }, { key: "miharchy.librarySortDirection", value: "desc" }] },
    manga: { meta: [{ key: "miharchy.librarySort", value: "title" }, { key: "miharchy.readingMode", value: "webtoon" }] }
  };
  assert.deepEqual(P.read(TABLE, data, P.defaults(TABLE)), { librarySort: "title", librarySortDirection: "desc" });
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

test("a choice without options takes any stored string, and an absent one keeps its default", () => {
  const free = [{ key: "excludedScanlators", default: "[]" }];
  assert.deepEqual(P.read(free, { manga: { meta: [{ key: "miharchy.excludedScanlators", value: "[\"A\"]" }] } }, P.defaults(free)), { excludedScanlators: "[\"A\"]" });
  assert.deepEqual(P.read(free, metas([]), P.defaults(free)), { excludedScanlators: "[]" });
});

test("force shows a value while on and leaves the stored choice alone", () => {
  const stored = { libraryFilterDownloaded: "exclude", librarySort: "title" };
  assert.deepEqual(P.force(stored, "libraryFilterDownloaded", "include", true), { libraryFilterDownloaded: "include", librarySort: "title" });
  assert.equal(P.force(stored, "libraryFilterDownloaded", "include", false), stored);
  assert.equal(stored.libraryFilterDownloaded, "exclude");
});
