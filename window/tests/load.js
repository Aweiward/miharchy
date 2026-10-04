// Loads a QML JS module in node: drops .pragma, turns each
// `.import "X.js" as Name` into a loaded module named Name, runs it.
// name and imports resolve as QML does: name from window/, an import from
// the importing file's folder.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

module.exports = function load(name) {
  const file = path.join(__dirname, "..", name);
  const imports = {};
  const src = fs.readFileSync(file, "utf8")
    .split("\n")
    .map((line) => {
      const m = /^\s*\.import\s+"([^"]+\.js)"\s+as\s+(\w+)/.exec(line);
      if (m) imports[m[2]] = load(path.join(path.dirname(name), m[1]));
      return /^\s*\.(import|pragma)\b/.test(line) ? "" : line;
    })
    .join("\n");
  const mod = { exports: {} };
  vm.compileFunction(src, ["module", ...Object.keys(imports)], { filename: file })(mod, ...Object.values(imports));
  return mod.exports;
};
