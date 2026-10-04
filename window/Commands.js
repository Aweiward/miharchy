.pragma library

// The window's command table and its pure key dispatcher. shell.qml calls
// dispatch() from its one key handler and runs the returned command id;
// the palette lists the same table, so a command has one definition.

// Qt::Key values as QML's event.key delivers them.
var KEY = {
  Escape: 0x01000000,
  Return: 0x01000004,
  Enter: 0x01000005,
  Up: 0x01000013,
  Down: 0x01000015,
  N: 0x4e,
  P: 0x50
}

// keys: printable characters match event.text; "Esc" matches the key code.
// hidden: reachable by key only, never listed in the palette.
var commands = [
  { id: "view.library", title: "Library", keys: ["1"] },
  { id: "view.updates", title: "Updates", keys: ["2"] },
  { id: "view.history", title: "History", keys: ["3"] },
  { id: "view.browse", title: "Browse", keys: ["4"] },
  { id: "view.settings", title: "Settings", keys: ["5"] },
  { id: "library.reload", title: "Reload library", keys: ["r"] },
  { id: "window.quit", title: "Quit", keys: ["q", "Esc"] },
  { id: "palette.open", title: "Command palette", keys: [":"], hidden: true }
]

// ev: { key, text, ctrl }. Returns { key, text, ctrl } with defaults so
// callers can pass a QML KeyEvent's fields straight through.
function keyEvent(key, text, modifiers) {
  return { key: key, text: text || "", ctrl: (modifiers & 0x04000000) !== 0 }
}

function matches(label, ev) {
  if (label === "Esc") return ev.key === KEY.Escape
  return !ev.ctrl && ev.text === label
}

// state: { palette: bool }. Returns a command id, or null for no command
// (in the palette, null lets the field type the key).
function dispatch(state, ev) {
  if (state.palette) {
    if (ev.key === KEY.Escape) return "palette.close"
    if (ev.key === KEY.Return || ev.key === KEY.Enter) return "palette.run"
    if (ev.key === KEY.Up || (ev.ctrl && ev.key === KEY.P)) return "palette.up"
    if (ev.key === KEY.Down || (ev.ctrl && ev.key === KEY.N)) return "palette.down"
    return null
  }
  for (var i = 0; i < commands.length; i++) {
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
