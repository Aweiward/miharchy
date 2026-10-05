const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// Quickshell refuses to load a file that names two imports alike ("Script
// import qualifiers must be unique"), and qmllint does not catch it.
test("no QML file in window/ or plugin/ repeats an import qualifier", () => {
  for (const dir of [path.join(__dirname, ".."), path.join(__dirname, "../../plugin")]) {
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".qml"))) {
      const names = fs.readFileSync(path.join(dir, f), "utf8").split("\n")
        .map((l) => l.match(/^import\s+\S+(?:\s+[\d.]+)?\s+as\s+(\w+)/)).filter(Boolean).map((m) => m[1]);
      assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), [], f);
    }
  }
});
