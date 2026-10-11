const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "../..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const paths = (svg) => ({
  burst: svg.match(/id="burst"[^>]* d="([^"]+)"/)[1],
  cross: svg.match(/id="cross"[^>]* d="([^"]+)"/)[1],
});

// icons/mark.py writes the SVGs; these files embed the same paths by hand.
const embeds = [
  ["plugin/MiharchyIcon.qml", "icons/miharchy-symbolic.svg"],
  ["window/ReadingCard.qml", "icons/miharchy.svg"],
  ["site/index.html", "icons/miharchy.svg"],
];

for (const [file, svg] of embeds) {
  test(`${file} draws the mark from ${svg}`, () => {
    const text = read(file);
    for (const [part, d] of Object.entries(paths(read(svg)))) {
      assert.ok(text.includes(d), `${file} has an old ${part} path: paste the one icons/mark.py prints`);
    }
  });
}

test("site/miharchy.svg is a copy of icons/miharchy.svg", () => {
  assert.equal(read("site/miharchy.svg"), read("icons/miharchy.svg"));
});
