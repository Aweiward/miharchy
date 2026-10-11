const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const C = require("./load")("Capped.js");

const run = (argv) => execFileSync(argv[0], argv.slice(1), { encoding: "utf8" });

test("a capped command keeps cap + 1 bytes of a longer output, and over() calls that an error", () => {
  const out = run(C.command(["sh", "-c", "yes | head -c 5000"], 100, 5));
  assert.equal(out.length, 101);
  assert.equal(C.over(out, 100), true);
  const small = run(C.command(["sh", "-c", "printf %s \"$1\"", "sh", "$(touch x) ok"], 100, 5));
  assert.equal(small, "$(touch x) ok", "data passes as an argument, never as shell text");
  assert.equal(C.over(small, 100), false);
});

test("over() counts UTF-8 bytes, as head does", () => {
  assert.equal(C.over("é".repeat(50), 100), false);
  assert.equal(C.over("é".repeat(51), 100), true);
});

test("a capped command ends at its deadline, with its children", () => {
  const start = Date.now();
  const out = run(C.command(["sh", "-c", "echo started; sleep 30 & sleep 30; echo late"], 100, 1));
  assert.equal(out, "started\n");
  assert.ok(Date.now() - start < 10000, "the deadline stopped it");
});
