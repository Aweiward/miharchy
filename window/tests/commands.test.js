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
  for (const v of ["nowhere", undefined]) {
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
  for (const t of ["a", "/"]) assert.equal(C.dispatch({ palette: false, view: "settings" }, text(t)), null, t);
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

test("t on a manga opens tracking; there j/k move, Enter finds the manga, s S c x change the track, and Esc or t closes it", () => {
  assert.equal(C.dispatch(screen("manga"), text("t")), "manga.track");
  const t = screen("manga-track");
  assert.equal(C.dispatch(t, text("j")), "track.down");
  assert.equal(C.dispatch(t, key(C.KEY.Up)), "track.up");
  assert.equal(C.dispatch(t, key(C.KEY.Return)), "track.search");
  assert.equal(C.dispatch(t, text("s")), "track.status");
  assert.equal(C.dispatch(t, text("S")), "track.score");
  assert.equal(C.dispatch(t, text("c")), "track.chapters");
  assert.equal(C.dispatch(t, text("x")), "track.unbind");
  for (const close of [text("t"), key(C.KEY.Escape), key(C.KEY.Backspace)]) assert.equal(C.dispatch(t, close), "track.close");
  assert.equal(C.dispatch(t, text("a")), null, "the manga's keys wait while tracking shows");
  const pick = screen("manga-track-pick");
  assert.equal(C.dispatch(pick, text("k")), "track.up");
  assert.equal(C.dispatch(pick, key(C.KEY.Return)), "track.choose");
  assert.equal(C.dispatch(pick, key(C.KEY.Escape)), "track.back");
  assert.equal(C.dispatch(pick, text("x")), null);
  const field = { palette: false, view: "manga-track", editing: "track" };
  assert.equal(C.dispatch(field, key(C.KEY.Return)), "track.commit");
  assert.equal(C.dispatch(field, key(C.KEY.Escape)), "track.cancel");
  assert.equal(C.dispatch(field, text("t")), null);
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
  assert.equal(C.dispatch(l, key(C.KEY.Escape)), "library.clearSearch");
});

test("on the library, / searches, Esc clears the search, and F opens sort and filter; there j/k move, Enter or Space change a row, Esc or F closes", () => {
  const l = screen("library");
  assert.equal(C.dispatch(l, text("/")), "library.search");
  assert.equal(C.dispatch(l, text("F")), "library.options");
  assert.equal(C.dispatch(l, text("f")), "window.fullscreen");
  const typing = { palette: false, view: "library", editing: "library" };
  assert.equal(C.dispatch(typing, key(C.KEY.Return)), "library.commit");
  assert.equal(C.dispatch(typing, key(C.KEY.Escape)), "library.cancel");
  assert.equal(C.dispatch(typing, text("x")), null);
  const o = screen("library-options");
  assert.equal(C.dispatch(o, text("j")), "library.optionsDown");
  assert.equal(C.dispatch(o, key(C.KEY.Up)), "library.optionsUp");
  assert.equal(C.dispatch(o, key(C.KEY.Return)), "library.optionsChoose");
  assert.equal(C.dispatch(o, C.keyEvent(C.KEY.Space, " ", 0)), "library.optionsChoose");
  assert.equal(C.dispatch(o, key(C.KEY.Escape)), "library.optionsClose");
  assert.equal(C.dispatch(o, text("F")), "library.optionsClose");
  assert.equal(C.dispatch(o, text("x")), null, "x does not remove a manga behind the panel");
  assert.equal(C.dispatch(o, text("q")), "window.quit");
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

test("in the reader, ] and [ change chapter, Home and End go to the first and last page, g goes to a page, z changes the fit and + - the webtoon width", () => {
  const r = screen("reader");
  assert.equal(C.dispatch(r, text("]")), "reader.nextChapter");
  assert.equal(C.dispatch(r, text("[")), "reader.previousChapter");
  assert.equal(C.dispatch(r, key(C.KEY.Home)), "reader.first");
  assert.equal(C.dispatch(r, key(C.KEY.End)), "reader.last");
  assert.equal(C.dispatch(r, text("g")), "reader.goto");
  assert.equal(C.dispatch(r, text("z")), "reader.fit");
  assert.equal(C.dispatch(r, text("+")), "reader.zoomIn");
  assert.equal(C.dispatch(r, text("=")), "reader.zoomIn", "= is + without Shift");
  assert.equal(C.dispatch(r, text("-")), "reader.zoomOut");
  assert.equal(C.dispatch(r, text("0")), "reader.zoomReset");
  assert.equal(C.dispatch(r, text("b")), "reader.bookmark");
  assert.equal(C.dispatch(r, text("S")), "reader.savePage");
  assert.equal(C.dispatch(r, text("Y")), "reader.copyPage");
  assert.equal(C.dispatch(screen("library"), key(C.KEY.Home)), null);
  const field = { palette: false, view: "reader", editing: "reader" };
  assert.equal(C.dispatch(field, key(C.KEY.Return)), "reader.commit");
  assert.equal(C.dispatch(field, key(C.KEY.Escape)), "reader.cancel");
  assert.equal(C.dispatch(field, text("7")), null, "digits type into the go-to field");
});

test("in the reader, s opens its settings panel; there j/k move, Enter or Space change a row, and Esc, s or q close it", () => {
  assert.equal(C.dispatch(screen("reader"), text("s")), "reader.settings");
  const p = screen("reader-settings");
  assert.equal(C.dispatch(p, text("j")), "reader.settingsDown");
  assert.equal(C.dispatch(p, key(C.KEY.Down)), "reader.settingsDown");
  assert.equal(C.dispatch(p, text("k")), "reader.settingsUp");
  assert.equal(C.dispatch(p, key(C.KEY.Return)), "reader.settingsChoose");
  assert.equal(C.dispatch(p, C.keyEvent(C.KEY.Space, " ", 0)), "reader.settingsChoose");
  for (const t of ["s", "q"]) assert.equal(C.dispatch(p, text(t)), "reader.settingsClose", t);
  assert.equal(C.dispatch(p, key(C.KEY.Escape)), "reader.settingsClose", "Esc closes the panel, not the window");
  assert.equal(C.dispatch(p, text("l")), null, "the panel holds the page still");
});

test("f toggles fullscreen everywhere, but types in an edit field or the palette", () => {
  for (const v of ["library", "settings", "sources", "source", "global", "manga", "reader"]) assert.equal(C.dispatch(screen(v), text("f")), "window.fullscreen", v);
  assert.equal(C.dispatch(palette, text("f")), null);
  assert.equal(C.dispatch({ palette: false, view: "source", editing: "browse" }, text("f")), null);
  assert.ok(C.paletteRows("full").some((c) => c.id === "window.fullscreen"));
});

test("on History, j/k move, Enter resumes, x removes an entry, X clears it all and r reloads", () => {
  const h = screen("history");
  assert.equal(C.dispatch(h, text("j")), "history.down");
  assert.equal(C.dispatch(h, key(C.KEY.Down)), "history.down");
  assert.equal(C.dispatch(h, text("k")), "history.up");
  assert.equal(C.dispatch(h, key(C.KEY.Up)), "history.up");
  assert.equal(C.dispatch(h, key(C.KEY.Return)), "history.open");
  assert.equal(C.dispatch(h, text("x")), "history.remove");
  assert.equal(C.dispatch(h, text("X")), "history.clear");
  assert.equal(C.dispatch(h, text("r")), "history.reload");
  assert.equal(C.dispatch(h, text("/")), "history.search");
  assert.equal(C.dispatch(h, key(C.KEY.Escape)), "history.clearSearch", "it clears a search; with none, shell.qml quits");
  assert.equal(C.dispatch({ ...h, editing: "history" }, key(C.KEY.Escape)), "history.cancel");
  assert.equal(C.dispatch({ ...h, editing: "history" }, key(C.KEY.Return)), "history.commit");
  assert.equal(C.dispatch({ ...h, editing: "history" }, text("x")), null, "the field types x");
  assert.equal(C.dispatch(screen("library"), text("x")), "library.remove");
  assert.equal(C.dispatch(screen("settings"), text("x")), null);
  assert.equal(C.dispatch(screen("library"), text("r")), "library.reload");
});

test("in each view a key has one command, and a view's own command comes before the global one it shadows", () => {
  const scopes = new Set(["library", "updates", "history", "browse", "settings", "setup"]);
  C.commands.forEach((c) => [].concat(c.view || []).forEach((v) => scopes.add(v)));
  for (const v of scopes) {
    const seen = {};
    for (const c of C.commands) {
      if (c.view && ![].concat(c.view).includes(v)) continue;
      for (const k of c.keys) {
        const kind = (c.view ? "scoped " : "global ") + k;
        assert.ok(!seen[kind], v + ": " + k + " is both " + seen[kind] + " and " + c.id);
        assert.ok(!(c.view && seen["global " + k]), v + ": " + c.id + " comes after " + seen["global " + k]);
        seen[kind] = c.id;
      }
    }
  }
});

test("on Updates, j/k move, Enter reads the chapter, u checks for updates and r reloads", () => {
  const updates = screen("updates");
  assert.equal(C.dispatch(updates, text("j")), "updates.down");
  assert.equal(C.dispatch(updates, key(C.KEY.Down)), "updates.down");
  assert.equal(C.dispatch(updates, text("k")), "updates.up");
  assert.equal(C.dispatch(updates, key(C.KEY.Up)), "updates.up");
  assert.equal(C.dispatch(updates, key(C.KEY.Return)), "updates.open");
  assert.equal(C.dispatch(updates, text("u")), "updates.check");
  assert.equal(C.dispatch(updates, text("r")), "library.reload");
  assert.equal(C.dispatch(updates, key(C.KEY.Escape)), "updates.clearSelection", "Esc ends a selection, else quits");
  assert.equal(C.dispatch(screen("reader"), text("u")), "reader.halfUp", "u still goes half a view up in the reader");
  assert.equal(C.dispatch(screen("library"), text("u")), "library.update", "u on the Library checks the shown category");
  assert.equal(C.dispatch(screen("categories"), text("u")), "categories.update");
});

test("on Updates, Space selects, A selects all, I inverts, and R U b d x act on the selection", () => {
  const updates = screen("updates");
  assert.equal(C.dispatch(updates, key(C.KEY.Space)), "updates.select");
  assert.equal(C.dispatch(updates, text("A")), "updates.selectAll");
  assert.equal(C.dispatch(updates, text("I")), "updates.invert");
  assert.equal(C.dispatch(updates, text("R")), "updates.markRead");
  assert.equal(C.dispatch(updates, text("U")), "updates.markUnread");
  assert.equal(C.dispatch(updates, text("b")), "updates.bookmark");
  assert.equal(C.dispatch(updates, text("d")), "updates.download");
  assert.equal(C.dispatch(updates, text("x")), "updates.deleteDownload");
  assert.equal(C.dispatch(screen("library"), text("R")), "library.markRead");
});

test("on the Library, Space reads on, v selects, and the selection keys act; the categories panel takes j k and Esc", () => {
  const lib = screen("library");
  assert.equal(C.dispatch(lib, key(C.KEY.Space)), "library.continue");
  assert.equal(C.dispatch(lib, text("v")), "library.select");
  assert.equal(C.dispatch(lib, text("A")), "library.selectAll");
  assert.equal(C.dispatch(lib, text("I")), "library.invert");
  assert.equal(C.dispatch(lib, text("U")), "library.markUnread");
  assert.equal(C.dispatch(lib, text("u")), "library.update", "u still checks for new chapters");
  assert.equal(C.dispatch(lib, text("d")), "library.download");
  assert.equal(C.dispatch(lib, text("X")), "library.deleteDownloads");
  assert.equal(C.dispatch(lib, text("x")), "library.remove");
  assert.equal(C.dispatch(lib, text("C")), "library.setCategories");
  assert.equal(C.dispatch(lib, text("c")), "library.categories");
  const pick = screen("library-categories");
  assert.equal(C.dispatch(pick, text("j")), "library.pickDown");
  assert.equal(C.dispatch(pick, key(C.KEY.Space)), "library.pickToggle");
  assert.equal(C.dispatch(pick, key(C.KEY.Escape)), "library.pickClose");
  assert.equal(C.dispatch(pick, text("x")), null, "no library action runs under the panel");
});

test("an armed remove takes x to keep the downloads and d to delete them; Esc keeps the manga and does not quit", () => {
  const armed = screen("library-remove");
  assert.equal(C.dispatch(armed, text("x")), "library.remove");
  assert.equal(C.dispatch(armed, text("d")), "library.removeWithDownloads");
  assert.equal(C.dispatch(armed, key(C.KEY.Escape)), "library.disarm");
  assert.equal(C.dispatch(armed, text("j")), null, "any other key only disarms");
  assert.equal(C.dispatch(screen("library"), text("d")), "library.download", "unarmed, d downloads");
});

test("on a manga, d downloads, U opens the download menu, x deletes downloads and v starts a selection", () => {
  const m = screen("manga");
  assert.equal(C.dispatch(m, text("d")), "manga.download");
  assert.equal(C.dispatch(m, text("U")), "manga.downloads");
  assert.equal(C.dispatch(m, text("x")), "manga.deleteDownload");
  assert.equal(C.dispatch(m, text("v")), "manga.select");
  assert.equal(C.dispatch(m, text("D")), "downloads.open");
});

test("in the download menu j/k move, Enter or Space downloads, Esc or U closes; its number field commits on Enter", () => {
  const d = screen("manga-download");
  assert.equal(C.dispatch(d, text("j")), "manga.downloadsDown");
  assert.equal(C.dispatch(d, text("k")), "manga.downloadsUp");
  assert.equal(C.dispatch(d, key(C.KEY.Return)), "manga.downloadsChoose");
  assert.equal(C.dispatch(d, C.keyEvent(C.KEY.Space, " ", 0)), "manga.downloadsChoose");
  assert.equal(C.dispatch(d, key(C.KEY.Escape)), "manga.downloadsClose");
  assert.equal(C.dispatch(d, text("U")), "manga.downloadsClose");
  assert.equal(C.dispatch(d, text("R")), null, "the chapter keys wait while the menu shows");
  const field = { palette: false, view: "manga-download", editing: "manga" };
  assert.equal(C.dispatch(field, key(C.KEY.Return)), "manga.commit");
  assert.equal(C.dispatch(field, key(C.KEY.Escape)), "manga.cancel");
  assert.equal(C.dispatch(field, text("7")), null, "digits type into the field");
});

test("o opens and y copies the link: the manga's on a manga, the chapter's in the reader", () => {
  assert.equal(C.dispatch(screen("manga"), text("o")), "manga.openWeb");
  assert.equal(C.dispatch(screen("manga"), text("y")), "manga.copyLink");
  assert.equal(C.dispatch(screen("reader"), text("o")), "reader.openWeb");
  assert.equal(C.dispatch(screen("reader"), text("y")), "reader.copyLink");
  assert.equal(C.dispatch(screen("library"), text("o")), null);
});

test("on a manga, Y copies the title and / searches every source for it", () => {
  assert.equal(C.dispatch(screen("manga"), text("Y")), "manga.copyTitle");
  assert.equal(C.dispatch(screen("manga"), text("/")), "manga.searchTitle");
  assert.equal(C.dispatch(screen("sources"), text("/")), "global.search", "/ on Browse still opens the search field");
});

test("on a manga, n opens the notes; while they are written, Enter saves and Esc drops the edit", () => {
  assert.equal(C.dispatch(screen("manga"), text("n")), "manga.notes");
  const field = { palette: false, view: "manga", editing: "manga" };
  assert.equal(C.dispatch(field, key(C.KEY.Return)), "manga.commit");
  assert.equal(C.dispatch(field, key(C.KEY.Escape)), "manga.cancel");
  assert.equal(C.dispatch(field, text("q")), null, "letters type into the notes");
});

test("on a manga, R marks read, u marks unread and P marks every chapter below the cursor read; R and u act on a selection too", () => {
  const m = screen("manga");
  assert.equal(C.dispatch(m, text("R")), "manga.markRead");
  assert.equal(C.dispatch(m, text("u")), "manga.markUnread");
  assert.equal(C.dispatch(m, text("P")), "manga.markPrevious");
  assert.equal(C.dispatch(m, text("r")), "manga.refresh", "r still refreshes");
  const s = screen("manga-select");
  assert.equal(C.dispatch(s, text("R")), "manga.markRead");
  assert.equal(C.dispatch(s, text("u")), "manga.markUnread");
  assert.equal(C.dispatch(s, text("P")), null, "below the cursor means nothing in a selection");
  assert.equal(C.dispatch(screen("updates"), text("u")), "updates.check");
  assert.equal(C.dispatch(screen("reader"), text("u")), "reader.halfUp");
});

test("on a manga, b bookmarks, Space resumes, F opens the chapter filter and sort; there j/k move, Enter or Space changes, Esc or F closes", () => {
  const m = screen("manga");
  assert.equal(C.dispatch(m, text("b")), "manga.bookmark");
  assert.equal(C.dispatch(screen("manga-select"), text("b")), "manga.bookmark", "b acts on a selection too");
  assert.equal(C.dispatch(m, C.keyEvent(C.KEY.Space, " ", 0)), "manga.resume");
  assert.equal(C.dispatch(m, key(C.KEY.Return)), "manga.read", "Enter still reads the chapter under the cursor");
  assert.equal(C.dispatch(m, text("F")), "manga.options");
  const o = screen("manga-options");
  assert.equal(C.dispatch(o, text("j")), "manga.optionsDown");
  assert.equal(C.dispatch(o, text("k")), "manga.optionsUp");
  assert.equal(C.dispatch(o, key(C.KEY.Return)), "manga.optionsChoose");
  assert.equal(C.dispatch(o, C.keyEvent(C.KEY.Space, " ", 0)), "manga.optionsChoose");
  assert.equal(C.dispatch(o, key(C.KEY.Escape)), "manga.optionsClose");
  assert.equal(C.dispatch(o, text("F")), "manga.optionsClose");
  assert.equal(C.dispatch(o, text("R")), null, "the chapter keys wait while the panel shows");
});

test("in a selection, j/k extend it, d and x act on it, and v or Esc ends it without leaving the manga", () => {
  const s = screen("manga-select");
  assert.equal(C.dispatch(s, text("j")), "manga.down");
  assert.equal(C.dispatch(s, key(C.KEY.Up)), "manga.up");
  assert.equal(C.dispatch(s, text("d")), "manga.download");
  assert.equal(C.dispatch(s, text("x")), "manga.deleteDownload");
  assert.equal(C.dispatch(s, text("v")), "manga.selectEnd");
  assert.equal(C.dispatch(s, key(C.KEY.Escape)), "manga.selectEnd");
  for (const t of ["a", "c", "U"]) assert.equal(C.dispatch(s, text(t)), null, t);
  assert.equal(C.dispatch(s, key(C.KEY.Return)), null, "Enter does not read a range");
});

test("the download queue opens from the palette or D on the Library and a manga; there j/k move, x dequeues, Space starts or stops, Esc or D closes", () => {
  assert.ok(C.paletteRows("download").some((c) => c.id === "downloads.open"));
  assert.equal(C.dispatch(screen("library"), text("D")), "downloads.open");
  assert.equal(C.dispatch(screen("settings"), text("D")), null);
  const q = screen("downloads");
  assert.equal(C.dispatch(q, text("j")), "downloads.down");
  assert.equal(C.dispatch(q, text("k")), "downloads.up");
  assert.equal(C.dispatch(q, text("x")), "downloads.dequeue");
  assert.equal(C.dispatch(q, C.keyEvent(C.KEY.Space, " ", 0)), "downloads.toggle");
  assert.equal(C.dispatch(q, key(C.KEY.Escape)), "downloads.close");
  assert.equal(C.dispatch(q, text("D")), "downloads.close");
  assert.equal(C.dispatch(q, text("q")), "window.quit");
});

test("d on the categories screen flags a category for auto-download", () => {
  assert.equal(C.dispatch(screen("categories"), text("d")), "categories.autoDownload");
});

test("Sync now runs from the palette or s on the Library and Updates; its result closes with Esc, q or Enter", () => {
  assert.ok(C.paletteRows("sync").some((c) => c.id === "sync.now"));
  assert.equal(C.dispatch(screen("library"), text("s")), "sync.now");
  assert.equal(C.dispatch(screen("updates"), text("s")), "sync.now");
  assert.equal(C.dispatch(screen("reader"), text("s")), "reader.settings", "s in the reader opens its settings, not a sync");
  const result = screen("sync");
  for (const k of [key(C.KEY.Escape), text("q"), key(C.KEY.Return)]) assert.equal(C.dispatch(result, k), "sync.close");
  assert.equal(C.dispatch(result, text("s")), null, "a second s does not start another sync over the result");
});

test("M on a manga migrates it; M on the sources screen or the palette migrates a whole source", () => {
  assert.equal(C.dispatch(screen("manga"), text("M")), "manga.migrate");
  assert.equal(C.dispatch(screen("manga"), text("m")), null);
  assert.equal(C.dispatch(screen("sources"), text("M")), "migrate.batch");
  assert.ok(C.paletteRows("migrate").some((c) => c.id === "migrate.batch"));
  assert.equal(C.dispatch(screen("library"), text("M")), null);
});

test("every migration step takes Esc as back, never quit, even while it runs", () => {
  for (const step of ["search", "from", "to", "match", "confirm", "busy", "done"]) {
    assert.equal(C.dispatch(screen("migrate-" + step), key(C.KEY.Escape)), "migrate.back", step);
  }
  assert.equal(C.dispatch(screen("migrate-busy"), key(C.KEY.Return)), null, "Enter does not start a second run");
});

test("migrating: hjkl pick a result, / searches another title, Enter chooses; the confirm takes Enter to migrate, c to copy, d for downloads", () => {
  const s = screen("migrate-search");
  assert.equal(C.dispatch(s, text("l")), "migrate.right");
  assert.equal(C.dispatch(s, text("j")), "migrate.down");
  assert.equal(C.dispatch(s, text("/")), "migrate.search");
  assert.equal(C.dispatch(s, text("r")), "migrate.retry");
  assert.equal(C.dispatch(s, key(C.KEY.Return)), "migrate.open");
  const m = screen("migrate-match");
  assert.equal(C.dispatch(m, text("h")), "migrate.left", "h/l pick another result for the row");
  assert.equal(C.dispatch(m, key(C.KEY.Return)), "migrate.open");
  const c = screen("migrate-confirm");
  assert.equal(C.dispatch(c, key(C.KEY.Return)), "migrate.open");
  assert.equal(C.dispatch(c, text("c")), "migrate.copy");
  assert.equal(C.dispatch(c, text("d")), "migrate.downloads");
  assert.equal(C.dispatch(c, text("j")), null);
  const typing = { palette: false, view: "migrate-search", editing: "migrate" };
  assert.equal(C.dispatch(typing, key(C.KEY.Return)), "migrate.commit");
  assert.equal(C.dispatch(typing, key(C.KEY.Escape)), "migrate.cancel");
});

test("F on a source opens its filters; there j/k move, Enter or Space change a row, a applies, x resets, Esc or F closes", () => {
  assert.equal(C.dispatch(screen("source"), text("F")), "source.filters");
  const f = screen("source-filters");
  assert.equal(C.dispatch(f, text("j")), "panel.down");
  assert.equal(C.dispatch(f, key(C.KEY.Up)), "panel.up");
  assert.equal(C.dispatch(f, key(C.KEY.Return)), "panel.choose");
  assert.equal(C.dispatch(f, key(C.KEY.Space)), "panel.choose");
  assert.equal(C.dispatch(f, text("a")), "panel.apply");
  assert.equal(C.dispatch(f, text("x")), "panel.reset");
  assert.equal(C.dispatch(f, key(C.KEY.Escape)), "panel.closeFilters");
  assert.equal(C.dispatch(f, text("F")), "panel.closeFilters");
  assert.equal(C.dispatch(f, text("S")), null);
});

test("S on the sources screen or a source opens its settings; there j/k move, Enter or Space change a row, Esc or S closes", () => {
  assert.equal(C.dispatch(screen("sources"), text("S")), "source.settings");
  assert.equal(C.dispatch(screen("source"), text("S")), "source.settings");
  const s = screen("source-settings");
  assert.equal(C.dispatch(s, text("k")), "panel.up");
  assert.equal(C.dispatch(s, key(C.KEY.Return)), "panel.choose");
  assert.equal(C.dispatch(s, key(C.KEY.Escape)), "panel.closeSettings");
  assert.equal(C.dispatch(s, text("S")), "panel.closeSettings");
  assert.equal(C.dispatch(s, text("a")), null, "settings save as they change");
  assert.equal(C.dispatch(s, text("x")), null);
});

test("a panel's text field commits and cancels as panel.*", () => {
  const e = { palette: false, view: "source-filters", editing: "panel" };
  assert.equal(C.dispatch(e, key(C.KEY.Return)), "panel.commit");
  assert.equal(C.dispatch(e, key(C.KEY.Escape)), "panel.cancel");
  assert.equal(C.dispatch(e, text("F")), null);
});

test("a double click sends Enter, which opens the item on every list", () => {
  const enter = (view) => C.dispatch({ palette: false, view }, C.keyEvent(C.enter().key, C.enter().text, C.enter().modifiers));
  assert.equal(enter("library"), "library.open");
  assert.equal(enter("updates"), "updates.open");
  assert.equal(enter("history"), "history.open");
  assert.equal(enter("sources"), "sources.open");
  assert.equal(enter("source"), "source.open");
  assert.equal(enter("global"), "global.open");
  assert.equal(enter("extensions"), "extensions.activate");
  assert.equal(enter("manga"), "manga.read");
  assert.equal(enter("settings"), "settings.activate");
  assert.equal(enter("setup"), "setup.activate");
  assert.equal(enter("migrate-from"), "migrate.open");
  assert.equal(C.dispatch({ palette: true }, C.enter()), "palette.run");
});

test("a hint part a click can press sends its key; movement and counts stay plain", () => {
  const keys = (hint) => C.hintParts(hint).map((p) => p.key && p.key.text);
  assert.deepEqual(keys("j k move   enter read   space select   A all   R read   x delete download   esc clear   "),
    [null, "\r", " ", "A", "R", "x", "\u001b"]);
  assert.deepEqual(keys("3 selected   space select   "), [null, " "], "a count is no key");
  assert.deepEqual(keys("hjkl move   / search   F sort & filter   tab category   : commands   q quit"),
    [null, "/", "F", "\t", ":", "q"]);
  assert.deepEqual(keys("J K reorder   h l another match or skip   "), [null, null]);
  assert.deepEqual(keys("x again to delete the downloads, any other key keeps them   "), ["x"]);
  assert.deepEqual(keys("Checking Action for new chapters. Updates shows the progress.   "), [null]);
  assert.deepEqual(C.hintParts("enter open   ").map((p) => p.text), ["enter open"]);
  assert.deepEqual(keys(""), []);
});

test("every key a hint part sends reaches the command the hint names", () => {
  const press = (view, hint, label) => {
    const part = C.hintParts(hint).find((p) => p.text === label);
    return C.dispatch({ palette: false, view }, C.keyEvent(part.key.key, part.key.text, 0));
  };
  assert.equal(press("library", "x remove   F sort & filter   ", "x remove"), "library.remove");
  assert.equal(press("library", "F sort & filter   ", "F sort & filter"), "library.options");
  assert.equal(press("updates", "space select   ", "space select"), "updates.select");
  assert.equal(press("library", "tab category   ", "tab category"), "library.nextCategory");
  assert.equal(press("manga", "esc back   ", "esc back"), "manga.back");
  assert.equal(press("manga", "a add   ", "a add"), "manga.library");
  assert.equal(press("library", ": commands   ", ": commands"), "palette.open");
  for (const view of ["library", "manga", "reader", "updates", "source"]) {
    assert.equal(press(view, "new version   Q restart", "Q restart"), "window.restart", view);
  }
});
