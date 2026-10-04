// Loads a QML JS module in node: strips .pragma/.import, runs it as a module.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

module.exports = function load(name) {
  const file = path.join(__dirname, "..", name);
  const src = fs.readFileSync(file, "utf8")
    .split("\n")
    .map((line) => (/^\s*\.(import|pragma)\b/.test(line) ? "" : line))
    .join("\n");
  const mod = { exports: {} };
  vm.compileFunction(src, ["module"], { filename: file })(mod);
  return mod.exports;
};
