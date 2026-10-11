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

// Text renders markup by default (AutoText), so a title from a source could
// style itself. Every Text and TextEdit names its format; one other than
// PlainText carries a comment on the line above that says why.
test("every Text and TextEdit in window/ and plugin/ names its textFormat", () => {
  const missing = [], unexplained = [];
  for (const dir of [path.join(__dirname, ".."), path.join(__dirname, "../../plugin")]) {
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".qml"))) {
      const lines = fs.readFileSync(path.join(dir, f), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!/^\s*(?:[\w.]+:\s*)?(?:Text|TextEdit)\s*\{\s*$/.test(line)) return;
        let depth = 1, format = -1;
        for (let j = i + 1; j < lines.length && depth > 0; j++) {
          if (depth === 1 && /^\s*textFormat\s*:/.test(lines[j])) format = j;
          depth += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
        }
        if (format < 0) missing.push(f + ":" + (i + 1));
        else if (!/\.PlainText\s*$/.test(lines[format]) && !/^\s*\/\//.test(lines[format - 1])) unexplained.push(f + ":" + (format + 1));
      });
    }
  }
  assert.deepEqual(missing, [], "Text without textFormat");
  assert.deepEqual(unexplained, [], "textFormat other than PlainText without a comment above");
});
