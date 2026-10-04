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

const settings = { palette: false, view: "settings" };
const editing = { palette: false, view: "settings", editing: "settings" };

test("in the Settings view, j/k/arrows move and Enter/Space change a row", () => {
  assert.equal(C.dispatch(settings, text("j")), "settings.down");
  assert.equal(C.dispatch(settings, key(C.KEY.Down)), "settings.down");
  assert.equal(C.dispatch(settings, text("k")), "settings.up");
  assert.equal(C.dispatch(settings, key(C.KEY.Up)), "settings.up");
  assert.equal(C.dispatch(settings, key(C.KEY.Return)), "settings.activate");
  assert.equal(C.dispatch(settings, key(C.KEY.Enter)), "settings.activate");
  assert.equal(C.dispatch(settings, C.keyEvent(C.KEY.Space, " ", 0)), "settings.activate");
  assert.equal(C.dispatch(settings, text("q")), "window.quit");
  assert.equal(C.dispatch(settings, key(C.KEY.Escape)), "window.quit");
  assert.equal(C.dispatch(settings, text("1")), "view.library");
});

test("settings keys do nothing in other views", () => {
  for (const v of ["library", "updates", undefined]) {
    const s = { palette: false, view: v };
    assert.equal(C.dispatch(s, text("j")), null);
    assert.equal(C.dispatch(s, key(C.KEY.Return)), null);
  }
});

test("while editing a row, Esc cancels, Enter commits and the rest types", () => {
  assert.equal(C.dispatch(editing, key(C.KEY.Escape)), "settings.cancel");
  assert.equal(C.dispatch(editing, key(C.KEY.Return)), "settings.commit");
  for (const t of ["q", "1", ":", "j", "r"]) assert.equal(C.dispatch(editing, text(t)), null, t);
});

test("the palette lists no view-scoped command", () => {
  assert.ok(C.paletteRows("").every((c) => !c.view));
});

const browse = { palette: false, view: "browse" };

test("in the Browse view, keys drive the extension list", () => {
  assert.equal(C.dispatch(browse, text("j")), "extensions.down");
  assert.equal(C.dispatch(browse, key(C.KEY.Down)), "extensions.down");
  assert.equal(C.dispatch(browse, text("k")), "extensions.up");
  assert.equal(C.dispatch(browse, key(C.KEY.Return)), "extensions.activate");
  assert.equal(C.dispatch(browse, text("x")), "extensions.remove");
  assert.equal(C.dispatch(browse, text("a")), "extensions.addRepo");
  assert.equal(C.dispatch(browse, text("/")), "extensions.filter");
  assert.equal(C.dispatch(browse, text("l")), "extensions.languages");
  assert.equal(C.dispatch(browse, text("q")), "window.quit");
  assert.equal(C.dispatch(browse, text("1")), "view.library");
});

test("r refreshes extensions on Browse and reloads the library elsewhere", () => {
  assert.equal(C.dispatch(browse, text("r")), "extensions.refresh");
  for (const v of ["library", "settings"]) assert.equal(C.dispatch({ palette: false, view: v }, text("r")), "library.reload", v);
  for (const t of ["x", "a", "/", "l"]) assert.equal(C.dispatch({ palette: false, view: "library" }, text(t)), null, t);
});

test("an open edit field gets its own commit and cancel", () => {
  const filtering = { palette: false, view: "browse", editing: "extensions" };
  assert.equal(C.dispatch(filtering, key(C.KEY.Escape)), "extensions.cancel");
  assert.equal(C.dispatch(filtering, key(C.KEY.Enter)), "extensions.commit");
  for (const t of ["x", "j", "/", "q"]) assert.equal(C.dispatch(filtering, text(t)), null, t);
});
