const { test } = require("node:test");
const assert = require("node:assert/strict");
const C = require("./load")("Commands.js");
const M = require("./load")("Model.js");

const CTRL = 0x04000000;
const text = (t) => C.keyEvent(t.charCodeAt(0), t, 0);
const key = (k, mods) => C.keyEvent(k, "", mods || 0);
const normal = { palette: false };
const palette = { palette: true };

test("number keys 1-5 open each view, in the model's order", () => {
  M.VIEWS.forEach((v) => assert.equal(C.dispatch(normal, text(v.key)), "view." + v.id));
});

test(": opens the palette; q and Esc quit; r reloads", () => {
  assert.equal(C.dispatch(normal, text(":")), "palette.open");
  assert.equal(C.dispatch(normal, text("q")), "window.quit");
  assert.equal(C.dispatch(normal, key(C.KEY.Escape)), "window.quit");
  assert.equal(C.dispatch(normal, text("r")), "library.reload");
  assert.equal(C.dispatch(normal, text("x")), null);
  assert.equal(C.dispatch(normal, C.keyEvent(0x31, "1", CTRL)), null, "Ctrl-1 is not 1");
});

test("in the palette, Esc closes it and printable keys type into the field", () => {
  assert.equal(C.dispatch(palette, key(C.KEY.Escape)), "palette.close");
  for (const t of ["q", "1", ":", "r"]) assert.equal(C.dispatch(palette, text(t)), null, t);
});

test("in the palette, Enter runs and Up/Down/Ctrl-p/Ctrl-n move", () => {
  assert.equal(C.dispatch(palette, key(C.KEY.Return)), "palette.run");
  assert.equal(C.dispatch(palette, key(C.KEY.Enter)), "palette.run");
  assert.equal(C.dispatch(palette, key(C.KEY.Up)), "palette.up");
  assert.equal(C.dispatch(palette, key(C.KEY.Down)), "palette.down");
  assert.equal(C.dispatch(palette, key(C.KEY.P, CTRL)), "palette.up");
  assert.equal(C.dispatch(palette, key(C.KEY.N, CTRL)), "palette.down");
  assert.equal(C.dispatch(palette, key(C.KEY.N)), null, "plain n types");
});

test("the palette lists every view and quit, not itself, and filters by title", () => {
  const all = C.paletteRows("").map((c) => c.id);
  for (const v of M.VIEWS) assert.ok(all.includes("view." + v.id), v.id);
  assert.ok(all.includes("window.quit"));
  assert.ok(!all.includes("palette.open"));
  assert.deepEqual(C.paletteRows("LIB").map((c) => c.id), ["view.library", "library.reload"]);
  assert.deepEqual(C.paletteRows("zzz"), []);
});

test("every command id the palette lists is one dispatch can return", () => {
  const reachable = new Set(C.commands.map((c) => c.id));
  for (const row of C.paletteRows("")) assert.ok(reachable.has(row.id));
});

test("the palette cursor wraps and stays in range", () => {
  assert.equal(C.moveCursor(0, -1, 3), 2);
  assert.equal(C.moveCursor(2, 1, 3), 0);
  assert.equal(C.moveCursor(1, 1, 3), 2);
  assert.equal(C.moveCursor(5, 1, 0), 0);
});
