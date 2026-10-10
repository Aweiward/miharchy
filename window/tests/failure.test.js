const { test } = require("node:test");
const assert = require("node:assert/strict");
const F = require("./load")("Failure.js");
const M = require("./load")("Model.js");

// What Model.reply leaves of a GraphQL error: the first line, without
// Suwayomi's "Exception while fetching data (/path) : " prefix.
const message = (raw) => M.reply(200, JSON.stringify({ errors: [{ message: raw }] })).message;

const samples = {
  cloudflare: [
    "Cloudflare bypass currently disabled",
    "Failed to bypass Cloudflare",
    "HTTP error 403 (Cloudflare)",
    "HTTP 503: Just a moment..."
  ],
  notFound: [
    // Seen: a local-source chapter whose folder is gone.
    "Chapter not found",
    "HTTP error 404"
  ],
  sourceMissing: [
    // Seen: a queued chapter after its extension was uninstalled.
    "Source not installed: 2499283573021220255"
  ],
  network: [
    "api.mangadex.org: Name or service not known",
    "Unable to resolve host \"api.mangadex.org\": No address associated with hostname",
    "timeout",
    "Read timed out",
    "connect timed out",
    "Failed to connect to api.mangadex.org/104.18.0.1:443",
    "Connection refused",
    "Connection reset",
    "Timed out waiting for 30000 ms"
  ]
};

test("each sample message gets its kind", () => {
  for (const kind in samples) {
    for (const text of samples[kind]) assert.equal(F.reason(text).kind, kind, text);
  }
});

test("a real Suwayomi error, stack trace and all, classifies after Model.reply strips it", () => {
  const raw = "Exception while fetching data (/a) : Source not installed: 2499283573021220255\r\n\r\n"
    + "suwayomi.tachidesk.manga.impl.util.source.StubSource$SourceNotInstalledException: Source not installed: 2499283573021220255\n\tat x";
  assert.equal(F.reason(message(raw)).kind, "sourceMissing");
  assert.equal(F.reason(message("Exception while fetching data (/a) : Chapter not found\r\n\r\njava.lang.Exception: Chapter not found")).kind, "notFound");
});

test("another message is other, its raw text shortened", () => {
  const short = F.reason("Chapter does not have any pages to download");
  assert.deepEqual(short, { kind: "other", text: "Chapter does not have any pages to download" });
  const long = F.reason("x".repeat(200));
  assert.equal(long.kind, "other");
  assert.ok(long.text.length <= F.MAX_TEXT, long.text.length);
  assert.ok(long.text.endsWith("…"));
  assert.equal(F.reason("").kind, "other");
});

test("the hint: Cloudflare points to Setup only while FlareSolverr is off, a missing source to the library check", () => {
  assert.match(F.hint(F.reason("Cloudflare bypass currently disabled"), false), /FlareSolverr in Setup/);
  assert.equal(F.hint(F.reason("Failed to bypass Cloudflare"), true), "");
  assert.match(F.hint(F.reason("Source not installed: 1"), true), /library check/);
  assert.equal(F.hint(F.reason("timeout"), false), "");
});
