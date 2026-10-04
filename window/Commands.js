.pragma library

// The window's command table and its pure key dispatcher. shell.qml calls
// dispatch() from its one key handler and runs the returned command id;
// the palette lists the same table, so a command has one definition.

// Qt::Key values as QML's event.key delivers them.
var KEY = {
  Escape: 0x01000000,
  Tab: 0x01000001,
  Backtab: 0x01000002,
  Backspace: 0x01000003,
  Return: 0x01000004,
  Enter: 0x01000005,
  Left: 0x01000012,
  Up: 0x01000013,
  Right: 0x01000014,
  Down: 0x01000015,
  Space: 0x20,
  N: 0x4e,
  P: 0x50
}

// keys: printable characters match event.text; "Esc", "Enter", "Space",
// "Tab", "Backtab" (Shift-Tab), "Backspace" and the arrows match the key code.
// hidden: reachable by key only, never listed in the palette.
// view: the command works only while that view (or Browse screen:
// sources, extensions, source, global; Library screen: categories; or
// overlay: manga, manga-categories, reader) shows; an array allows several.
var commands = [
  { id: "view.library", title: "Library", keys: ["1"] },
  { id: "view.updates", title: "Updates", keys: ["2"] },
  { id: "view.history", title: "History", keys: ["3"] },
  { id: "view.browse", title: "Browse", keys: ["4"] },
  { id: "view.settings", title: "Settings", keys: ["5"] },
  { id: "view.setup", title: "Setup", keys: [] },
  // Before library.reload and window.quit: on these screens r and Esc mean
  // something else.
  { id: "extensions.refresh", title: "Refresh extensions", keys: ["r"], view: "extensions", hidden: true },
  { id: "sources.refresh", title: "Refresh sources", keys: ["r"], view: "sources", hidden: true },
  { id: "source.retry", title: "Load again", keys: ["r"], view: "source", hidden: true },
  { id: "manga.refresh", title: "Refresh from the source", keys: ["r"], view: "manga", hidden: true },
  { id: "global.retry", title: "Search failed sources again", keys: ["r"], view: "global", hidden: true },
  { id: "browse.back", title: "Back", keys: ["Esc", "Backspace"], view: ["source", "global"], hidden: true },
  { id: "manga.back", title: "Back", keys: ["Esc", "Backspace"], view: "manga", hidden: true },
  { id: "manga.categoriesClose", title: "Close categories", keys: ["Esc", "Backspace", "c"], view: "manga-categories", hidden: true },
  { id: "categories.back", title: "Back", keys: ["Esc", "Backspace"], view: "categories", hidden: true },
  { id: "reader.close", title: "Close the reader", keys: ["Esc", "q"], view: "reader", hidden: true },
  { id: "reader.retry", title: "Load again", keys: ["r"], view: "reader", hidden: true },
  { id: "library.reload", title: "Reload library", keys: ["r"] },
  { id: "window.quit", title: "Quit", keys: ["q", "Esc"] },
  { id: "palette.open", title: "Command palette", keys: [":"], hidden: true },
  { id: "settings.up", title: "Previous setting", keys: ["k", "Up"], view: "settings", hidden: true },
  { id: "settings.down", title: "Next setting", keys: ["j", "Down"], view: "settings", hidden: true },
  { id: "settings.activate", title: "Change setting", keys: ["Enter", "Space"], view: "settings", hidden: true },
  { id: "extensions.up", title: "Previous row", keys: ["k", "Up"], view: "extensions", hidden: true },
  { id: "extensions.down", title: "Next row", keys: ["j", "Down"], view: "extensions", hidden: true },
  { id: "extensions.activate", title: "Install or update extension", keys: ["Enter"], view: "extensions", hidden: true },
  { id: "extensions.remove", title: "Uninstall extension or remove repo", keys: ["x"], view: "extensions", hidden: true },
  { id: "extensions.addRepo", title: "Add extension repo", keys: ["a"], view: "extensions", hidden: true },
  { id: "extensions.filter", title: "Filter extensions", keys: ["/"], view: "extensions", hidden: true },
  { id: "extensions.languages", title: "English or every language", keys: ["l"], view: "extensions", hidden: true },
  { id: "browse.tab", title: "Sources or extensions", keys: ["Tab"], view: ["sources", "extensions"], hidden: true },
  { id: "sources.up", title: "Previous source", keys: ["k", "Up"], view: "sources", hidden: true },
  { id: "sources.down", title: "Next source", keys: ["j", "Down"], view: "sources", hidden: true },
  { id: "sources.languages", title: "English or every language", keys: ["l"], view: "sources", hidden: true },
  { id: "sources.open", title: "Open source", keys: ["Enter"], view: "sources", hidden: true },
  { id: "source.left", title: "Previous manga", keys: ["h"], view: "source", hidden: true },
  { id: "source.right", title: "Next manga", keys: ["l"], view: "source", hidden: true },
  { id: "source.up", title: "Row up", keys: ["k", "Up"], view: "source", hidden: true },
  { id: "source.down", title: "Row down", keys: ["j", "Down"], view: "source", hidden: true },
  { id: "source.popular", title: "Popular", keys: ["p"], view: "source", hidden: true },
  { id: "source.latest", title: "Latest", keys: ["n"], view: "source", hidden: true },
  { id: "source.search", title: "Search this source", keys: ["/"], view: "source", hidden: true },
  { id: "source.open", title: "Open manga", keys: ["Enter"], view: "source", hidden: true },
  // / searches what the screen shows: one source there, every source here.
  { id: "global.search", title: "Search every source", keys: ["/"], view: ["sources", "global"], hidden: true },
  { id: "global.left", title: "Previous result", keys: ["h"], view: "global", hidden: true },
  { id: "global.right", title: "Next result", keys: ["l"], view: "global", hidden: true },
  { id: "global.up", title: "Previous source", keys: ["k", "Up"], view: "global", hidden: true },
  { id: "global.down", title: "Next source", keys: ["j", "Down"], view: "global", hidden: true },
  { id: "global.open", title: "Open manga", keys: ["Enter"], view: "global", hidden: true },
  { id: "manga.up", title: "Previous chapter", keys: ["k", "Up"], view: "manga", hidden: true },
  { id: "manga.down", title: "Next chapter", keys: ["j", "Down"], view: "manga", hidden: true },
  { id: "manga.library", title: "Add to or remove from library", keys: ["a"], view: "manga", hidden: true },
  { id: "manga.read", title: "Read chapter", keys: ["Enter"], view: "manga", hidden: true },
  { id: "manga.categories", title: "Categories", keys: ["c"], view: "manga", hidden: true },
  { id: "manga.categoryUp", title: "Previous category", keys: ["k", "Up"], view: "manga-categories", hidden: true },
  { id: "manga.categoryDown", title: "Next category", keys: ["j", "Down"], view: "manga-categories", hidden: true },
  { id: "manga.categoryToggle", title: "In or out of category", keys: ["Space", "Enter"], view: "manga-categories", hidden: true },
  { id: "reader.left", title: "Page to the left", keys: ["h", "Left"], view: "reader", hidden: true },
  { id: "reader.right", title: "Page to the right", keys: ["l", "Right"], view: "reader", hidden: true },
  { id: "reader.next", title: "Next page", keys: ["Space"], view: "reader", hidden: true },
  { id: "library.left", title: "Previous manga", keys: ["h", "Left"], view: "library", hidden: true },
  { id: "library.right", title: "Next manga", keys: ["l", "Right"], view: "library", hidden: true },
  { id: "library.up", title: "Row up", keys: ["k", "Up"], view: "library", hidden: true },
  { id: "library.down", title: "Row down", keys: ["j", "Down"], view: "library", hidden: true },
  { id: "library.open", title: "Open manga", keys: ["Enter"], view: "library", hidden: true },
  { id: "library.nextCategory", title: "Next category", keys: ["Tab"], view: "library", hidden: true },
  { id: "library.previousCategory", title: "Previous category", keys: ["Backtab"], view: "library", hidden: true },
  { id: "library.categories", title: "Categories", keys: ["c"], view: "library", hidden: true },
  { id: "categories.up", title: "Previous category", keys: ["k", "Up"], view: "categories", hidden: true },
  { id: "categories.down", title: "Next category", keys: ["j", "Down"], view: "categories", hidden: true },
  { id: "categories.moveUp", title: "Move category up", keys: ["K"], view: "categories", hidden: true },
  { id: "categories.moveDown", title: "Move category down", keys: ["J"], view: "categories", hidden: true },
  { id: "categories.add", title: "Add category", keys: ["a"], view: "categories", hidden: true },
  { id: "categories.rename", title: "Rename category", keys: ["Enter"], view: "categories", hidden: true },
  { id: "categories.remove", title: "Delete category", keys: ["x"], view: "categories", hidden: true },
  { id: "setup.up", title: "Previous step", keys: ["k", "Up"], view: "setup", hidden: true },
  { id: "setup.down", title: "Next step", keys: ["j", "Down"], view: "setup", hidden: true },
  { id: "setup.activate", title: "Run step", keys: ["Enter", "Space"], view: "setup", hidden: true }
]

// ev: { key, text, ctrl }. Returns { key, text, ctrl } with defaults so
// callers can pass a QML KeyEvent's fields straight through.
function keyEvent(key, text, modifiers) {
  return { key: key, text: text || "", ctrl: (modifiers & 0x04000000) !== 0 }
}

function matches(label, ev) {
  if (label === "Esc") return ev.key === KEY.Escape
  if (label === "Enter") return ev.key === KEY.Return || ev.key === KEY.Enter
  if (["Space", "Tab", "Backtab", "Backspace", "Left", "Up", "Right", "Down"].indexOf(label) !== -1) return ev.key === KEY[label]
  return !ev.ctrl && ev.text === label
}

// state: { palette: bool, view: view id, editing: "" or the command prefix
// of the open edit field, as "settings", confirming: bool }. Returns a
// command id, or null for no command (in the palette or an edit, null lets
// the field type the key). While a setup step waits for consent, only y, n
// and Esc answer, so a stray key neither runs nor drops it.
function dispatch(state, ev) {
  if (state.editing) {
    if (ev.key === KEY.Escape) return state.editing + ".cancel"
    if (ev.key === KEY.Return || ev.key === KEY.Enter) return state.editing + ".commit"
    return null
  }
  if (state.confirming) {
    if (!ev.ctrl && ev.text === "y") return "setup.confirm"
    if (ev.key === KEY.Escape || (!ev.ctrl && ev.text === "n")) return "setup.cancel"
    return null
  }
  if (state.palette) {
    if (ev.key === KEY.Escape) return "palette.close"
    if (ev.key === KEY.Return || ev.key === KEY.Enter) return "palette.run"
    if (ev.key === KEY.Up || (ev.ctrl && ev.key === KEY.P)) return "palette.up"
    if (ev.key === KEY.Down || (ev.ctrl && ev.key === KEY.N)) return "palette.down"
    return null
  }
  for (var i = 0; i < commands.length; i++) {
    if (commands[i].view && [].concat(commands[i].view).indexOf(state.view) === -1) continue
    for (var j = 0; j < commands[i].keys.length; j++) {
      if (matches(commands[i].keys[j], ev)) return commands[i].id
    }
  }
  return null
}

// The palette's rows for a query: listed commands whose title contains it,
// ignoring case, in table order.
function paletteRows(query) {
  var q = String(query || "").toLowerCase()
  return commands.filter(function(c) {
    return !c.hidden && c.title.toLowerCase().indexOf(q) !== -1
  })
}

// The palette cursor after moving by delta over count rows; it wraps.
function moveCursor(cursor, delta, count) {
  if (count <= 0) return 0
  return ((cursor + delta) % count + count) % count
}

if (typeof module !== "undefined") {
  module.exports = {
    KEY: KEY,
    commands: commands,
    keyEvent: keyEvent,
    dispatch: dispatch,
    paletteRows: paletteRows,
    moveCursor: moveCursor
  }
}
