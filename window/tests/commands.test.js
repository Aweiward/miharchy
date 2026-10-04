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
  for (const v of ["updates", undefined]) {
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

const browse = { palette: false, view: "extensions" };

test("on the extensions screen, keys drive the extension list", () => {
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

test("r refreshes extensions on that screen and reloads the library elsewhere", () => {
  assert.equal(C.dispatch(browse, text("r")), "extensions.refresh");
  for (const v of ["library", "settings"]) assert.equal(C.dispatch({ palette: false, view: v }, text("r")), "library.reload", v);
  for (const t of ["x", "a", "/"]) assert.equal(C.dispatch({ palette: false, view: "library" }, text(t)), null, t);
});

test("an open edit field gets its own commit and cancel", () => {
  const filtering = { palette: false, view: "extensions", editing: "extensions" };
  assert.equal(C.dispatch(filtering, key(C.KEY.Escape)), "extensions.cancel");
  assert.equal(C.dispatch(filtering, key(C.KEY.Enter)), "extensions.commit");
  for (const t of ["x", "j", "/", "q"]) assert.equal(C.dispatch(filtering, text(t)), null, t);
});

test("the palette opens Setup; in it j/k move and Enter acts on a step", () => {
  assert.ok(C.paletteRows("setup").some((c) => c.id === "view.setup"));
  const setup = { palette: false, view: "setup" };
  assert.equal(C.dispatch(setup, text("j")), "setup.down");
  assert.equal(C.dispatch(setup, key(C.KEY.Up)), "setup.up");
  assert.equal(C.dispatch(setup, key(C.KEY.Return)), "setup.activate");
  assert.equal(C.dispatch(setup, text("y")), null, "y runs nothing without a question");
  assert.equal(C.dispatch(settings, text("j")), "settings.down", "setup keys stay out of Settings");
});

test("a setup question takes only y, n or Esc", () => {
  const asking = { palette: false, view: "setup", confirming: true };
  assert.equal(C.dispatch(asking, text("y")), "setup.confirm");
  assert.equal(C.dispatch(asking, text("n")), "setup.cancel");
  assert.equal(C.dispatch(asking, key(C.KEY.Escape)), "setup.cancel");
  for (const t of ["q", "Y", "1", ":", "j"]) assert.equal(C.dispatch(asking, text(t)), null, t);
  assert.equal(C.dispatch(asking, key(C.KEY.Return)), null, "Enter does not consent");
  assert.equal(C.dispatch(asking, C.keyEvent(0x59, "y", CTRL)), null, "Ctrl-y does not consent");
});

const screen = (view) => ({ palette: false, view });

test("Tab switches between sources and extensions on Browse, and between categories on the Library", () => {
  assert.equal(C.dispatch(screen("sources"), key(C.KEY.Tab)), "browse.tab");
  assert.equal(C.dispatch(screen("extensions"), key(C.KEY.Tab)), "browse.tab");
  assert.equal(C.dispatch(screen("library"), key(C.KEY.Tab)), "library.nextCategory");
  assert.equal(C.dispatch(screen("library"), key(C.KEY.Backtab)), "library.previousCategory");
  assert.equal(C.dispatch(screen("settings"), key(C.KEY.Tab)), null);
});

test("c on the Library opens its categories; there j/k move, J/K reorder, a adds, Enter renames, x deletes, Esc goes back", () => {
  assert.equal(C.dispatch(screen("library"), text("c")), "library.categories");
  assert.equal(C.dispatch(screen("settings"), text("c")), null);
  const c = screen("categories");
  assert.equal(C.dispatch(c, text("j")), "categories.down");
  assert.equal(C.dispatch(c, key(C.KEY.Up)), "categories.up");
  assert.equal(C.dispatch(c, text("J")), "categories.moveDown");
  assert.equal(C.dispatch(c, text("K")), "categories.moveUp");
  assert.equal(C.dispatch(c, text("a")), "categories.add");
  assert.equal(C.dispatch(c, key(C.KEY.Return)), "categories.rename");
  assert.equal(C.dispatch(c, text("x")), "categories.remove");
  assert.equal(C.dispatch(c, key(C.KEY.Escape)), "categories.back");
  assert.equal(C.dispatch(c, text("r")), "library.reload");
  assert.equal(C.dispatch(c, text("q")), "window.quit");
  const naming = { palette: false, view: "categories", editing: "categories" };
  assert.equal(C.dispatch(naming, key(C.KEY.Return)), "categories.commit");
  assert.equal(C.dispatch(naming, key(C.KEY.Escape)), "categories.cancel");
  assert.equal(C.dispatch(naming, text("x")), null);
});

test("c on a manga opens its category checklist; there j/k move, Space or Enter toggles, Esc or c closes", () => {
  assert.equal(C.dispatch(screen("manga"), text("c")), "manga.categories");
  const p = screen("manga-categories");
  assert.equal(C.dispatch(p, text("j")), "manga.categoryDown");
  assert.equal(C.dispatch(p, text("k")), "manga.categoryUp");
  assert.equal(C.dispatch(p, C.keyEvent(C.KEY.Space, " ", 0)), "manga.categoryToggle");
  assert.equal(C.dispatch(p, key(C.KEY.Return)), "manga.categoryToggle");
  assert.equal(C.dispatch(p, key(C.KEY.Escape)), "manga.categoriesClose");
  assert.equal(C.dispatch(p, text("c")), "manga.categoriesClose");
  assert.equal(C.dispatch(p, text("a")), null, "the detail's keys wait until the checklist closes");
});

test("on the sources screen, j/k move, Enter opens and r refreshes", () => {
  assert.equal(C.dispatch(screen("sources"), text("j")), "sources.down");
  assert.equal(C.dispatch(screen("sources"), text("k")), "sources.up");
  assert.equal(C.dispatch(screen("sources"), key(C.KEY.Return)), "sources.open");
  assert.equal(C.dispatch(screen("sources"), text("r")), "sources.refresh");
  assert.equal(C.dispatch(screen("sources"), key(C.KEY.Escape)), "window.quit", "the root of Browse has nothing to go back to");
});

test("on a source, hjkl move the grid, p n / switch lists, Enter opens and Esc goes back", () => {
  const s = screen("source");
  assert.equal(C.dispatch(s, text("h")), "source.left");
  assert.equal(C.dispatch(s, text("l")), "source.right");
  assert.equal(C.dispatch(s, text("j")), "source.down");
  assert.equal(C.dispatch(s, text("k")), "source.up");
  assert.equal(C.dispatch(s, text("p")), "source.popular");
  assert.equal(C.dispatch(s, text("n")), "source.latest");
  assert.equal(C.dispatch(s, text("/")), "source.search");
  assert.equal(C.dispatch(s, text("r")), "source.retry");
  assert.equal(C.dispatch(s, key(C.KEY.Return)), "source.open");
  assert.equal(C.dispatch(s, key(C.KEY.Escape)), "browse.back");
  assert.equal(C.dispatch(s, key(C.KEY.Backspace)), "browse.back");
  assert.equal(C.dispatch(s, text("q")), "window.quit");
});

test("on a manga, j/k move the chapters, a toggles the library, r refreshes, Enter reads and Esc goes back", () => {
  const m = screen("manga");
  assert.equal(C.dispatch(m, text("j")), "manga.down");
  assert.equal(C.dispatch(m, text("k")), "manga.up");
  assert.equal(C.dispatch(m, text("a")), "manga.library");
  assert.equal(C.dispatch(m, text("r")), "manga.refresh");
  assert.equal(C.dispatch(m, key(C.KEY.Return)), "manga.read");
  assert.equal(C.dispatch(m, key(C.KEY.Escape)), "manga.back");
  assert.equal(C.dispatch(m, key(C.KEY.Backspace)), "manga.back");
});

test("in the reader, h/l and the arrows turn by side, Space goes on, and Esc or q closes it", () => {
  const r = screen("reader");
  assert.equal(C.dispatch(r, text("h")), "reader.left");
  assert.equal(C.dispatch(r, key(C.KEY.Left)), "reader.left");
  assert.equal(C.dispatch(r, text("l")), "reader.right");
  assert.equal(C.dispatch(r, key(C.KEY.Right)), "reader.right");
  assert.equal(C.dispatch(r, C.keyEvent(C.KEY.Space, " ", 0)), "reader.next");
  assert.equal(C.dispatch(r, text("r")), "reader.retry");
  assert.equal(C.dispatch(r, key(C.KEY.Escape)), "reader.close");
  assert.equal(C.dispatch(r, text("q")), "reader.close", "q leaves the reader, not the window");
});

test("on the library, hjkl move the grid and Enter opens the manga", () => {
  const l = screen("library");
  assert.equal(C.dispatch(l, text("h")), "library.left");
  assert.equal(C.dispatch(l, text("l")), "library.right");
  assert.equal(C.dispatch(l, text("j")), "library.down");
  assert.equal(C.dispatch(l, text("k")), "library.up");
  assert.equal(C.dispatch(l, key(C.KEY.Down)), "library.down");
  assert.equal(C.dispatch(l, key(C.KEY.Return)), "library.open");
  assert.equal(C.dispatch(l, text("r")), "library.reload");
  assert.equal(C.dispatch(l, key(C.KEY.Escape)), "window.quit");
});

test("a source search field commits and cancels as source.*", () => {
  const searching = { palette: false, view: "source", editing: "source" };
  assert.equal(C.dispatch(searching, key(C.KEY.Enter)), "source.commit");
  assert.equal(C.dispatch(searching, key(C.KEY.Escape)), "source.cancel");
  assert.equal(C.dispatch(searching, text("n")), null);
});

test("/ on the sources screen searches every source; on its results hjkl move, Enter opens, r retries, Esc goes back", () => {
  assert.equal(C.dispatch(screen("sources"), text("/")), "global.search");
  const g = screen("global");
  assert.equal(C.dispatch(g, text("/")), "global.search");
  assert.equal(C.dispatch(g, text("h")), "global.left");
  assert.equal(C.dispatch(g, text("l")), "global.right");
  assert.equal(C.dispatch(g, text("j")), "global.down");
  assert.equal(C.dispatch(g, text("k")), "global.up");
  assert.equal(C.dispatch(g, key(C.KEY.Return)), "global.open");
  assert.equal(C.dispatch(g, text("r")), "global.retry");
  assert.equal(C.dispatch(g, key(C.KEY.Escape)), "browse.back");
  const typing = { palette: false, view: "global", editing: "global" };
  assert.equal(C.dispatch(typing, key(C.KEY.Return)), "global.commit");
  assert.equal(C.dispatch(typing, key(C.KEY.Escape)), "global.cancel");
  assert.equal(C.dispatch(typing, text("j")), null);
});

test("l on the sources screen toggles every language", () => {
  assert.equal(C.dispatch(screen("sources"), text("l")), "sources.languages");
});

test("in the reader, j/k and the arrows scroll, d/u go half a view, and m changes the reading mode", () => {
  const r = screen("reader");
  assert.equal(C.dispatch(r, text("j")), "reader.down");
  assert.equal(C.dispatch(r, key(C.KEY.Down)), "reader.down");
  assert.equal(C.dispatch(r, text("k")), "reader.up");
  assert.equal(C.dispatch(r, key(C.KEY.Up)), "reader.up");
  assert.equal(C.dispatch(r, text("d")), "reader.halfDown");
  assert.equal(C.dispatch(r, text("u")), "reader.halfUp");
  assert.equal(C.dispatch(r, text("m")), "reader.mode");
  assert.equal(C.dispatch(screen("manga"), text("m")), null);
});