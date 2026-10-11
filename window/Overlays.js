.pragma library

// The overlay stack (GLOSSARY.md): which overlay is on top, and so which
// command scope, editing prefix and hint the window uses. Pure, so
// tests/overlays.test.js pins it; shell.qml passes its items as s, keyed by
// their ids, and plain objects of the same shape stand in for them in tests.
//
// A new overlay is one row in ROWS. A row is open(s) and scope(s); hint(s,
// edit) gives the hint text, or undefined to fall through to the next open
// row. edit is the editing or confirming hint, or "" when nothing edits.

var SUFFIX = ": commands   q quit"

function own(text) {
  return function(s, edit) { return edit || text(s) + SUFFIX }
}

// Top first.
var ROWS = [
  { open: function(s) { return !!s.trackAsk },
    scope: function() { return "track-ask" },
    hint: function() { return "y update   n keep" } },
  { open: function(s) { return s.readingCard.open },
    scope: function() { return "reading-card" } },
  { open: function(s) { return s.nextChapters.open },
    scope: function() { return "next-chapters" },
    hint: own(function(s) { return s.nextChapters.hint }) },
  { open: function(s) { return s.restoreView.open },
    scope: function(s) { return "restore-" + s.restoreView.restore.step },
    hint: function() { return "" } },
  { open: function(s) { return s.syncView.open },
    scope: function(s) { return s.syncView.sync.state === "held" && !s.syncView.healthMode ? "sync-held" : "sync" },
    hint: function() { return "" } },
  { open: function(s) { return s.downloadsView.open },
    scope: function() { return "downloads" } },
  { open: function(s) { return s.reader.open },
    scope: function(s) { return s.reader.panelOpen ? "reader-settings" : "reader" } },
  { open: function(s) { return s.migrateView.open },
    scope: function(s) { return "migrate-" + s.migrateView.step },
    hint: own(function(s) { return s.migrateView.hint }) },
  { open: function(s) { return s.trackPanel.open },
    scope: function(s) { return s.trackPanel.picking ? "manga-track-pick" : "manga-track" },
    hint: own(function(s) { return s.trackPanel.hint }) },
  { open: function(s) { return s.mangaDetail.open },
    scope: function(s) {
      var m = s.mangaDetail
      return m.dupesOpen ? "manga-duplicates" : m.picking ? "manga-categories" : m.optionsOpen ? "manga-options" : m.downloadsOpen ? "manga-download" : m.selecting ? "manga-select" : "manga"
    },
    hint: own(function(s) { return s.mangaDetail.hint }) }
]

// The scope with no overlay open: the view, or a screen or panel inside it.
function viewScope(s) {
  var v = s.view
  if (v === "browse") return s.browseView.scope === "extensions" && s.extensionsView.details ? "extension" : s.browseView.scope
  if (v === "library" && s.libraryScreen === "categories") return "categories"
  if (v === "check" && s.checkView.merging) return "check-merge"
  if (v === "library" && s.libraryArmed === "remove") return "library-remove"
  if (v === "library" && s.libraryPickIds.length) return "library-categories"
  if (v === "library" && s.libraryOptions) return "library-options"
  if (v === "updates" && s.updatesView.filterOpen) return "updates-filter"
  return v
}

function viewHint(s) {
  var b = s.browseView
  var text = ({
    library: s.libraryHint,
    updates: s.updatesView.hint,
    history: s.historyView.hint,
    settings: "j k move   enter change   ",
    browse: b.panel || b.screen !== "extensions" ? b.hint : s.extensionsView.hint + (s.extensionsView.details ? "" : b.hint),
    setup: "j k move   enter act   ",
    check: s.checkView.hint
  })[s.view] || ""
  return text + ": commands   " + (s.view === "browse" ? "" : "r reload   ") + "q quit"
}

// Every field that takes typed text: its command prefix when it edits, and
// the hint while it does. A field can edit while its overlay or view is not
// on top, so the walk reads all of them.
var KEEP = "enter keep   esc clear"
var SAVE = "enter save   esc cancel"
var EDITORS = [
  { on: function(s) { return s.nextChapters.editing }, name: "nextChapters", hint: SAVE },
  { on: function(s) { return s.restoreView.editing }, name: "restore", hint: "" },
  { on: function(s) { return s.reader.editing }, name: "reader", hint: "" },
  { on: function(s) { return s.settingsEditing }, name: "settings", hint: SAVE },
  { on: function(s) { return s.libraryView.editing }, name: "library", hint: KEEP },
  { on: function(s) { return s.historyView.editing }, name: "history", hint: KEEP },
  { on: function(s) { return s.settingsView.loginEditing }, name: "login", hint: SAVE },
  { on: function(s) { return s.trackPanel.editing }, name: "track", hint: SAVE },
  { on: function(s) { return s.mangaDetail.editing }, name: "manga", hint: SAVE },
  { on: function(s) { return s.migrateView.editing }, name: "migrate", hint: SAVE },
  { on: function(s) { return s.extensionsView.editing }, name: "extensions", hint: SAVE },
  { on: function(s) { return s.setupView.editing }, name: "setup", hint: SAVE },
  { on: function(s) { return s.categoriesView.editing }, name: "categories", hint: SAVE },
  // Browse edits under the prefix of its screen or panel.
  { on: function(s) { return s.browseView.editing }, name: function(s) { return s.browseView.editing }, hint: SAVE }
]

function editor(s) {
  for (var i = 0; i < EDITORS.length; i++) if (EDITORS[i].on(s)) return EDITORS[i]
  return null
}

function editHint(s, e) {
  if (e && e.name === "manga" && s.mangaDetail.writing) return "enter save   shift+enter new line   esc cancel"
  if (e && e.hint) return e.hint
  return s.setupView.confirming ? "y run   n cancel" : ""
}

// { scope, editing, hint } for the window state s.
function top(s) {
  var e = editor(s)
  var edit = editHint(s, e)
  var scope = null, hint
  for (var i = 0; i < ROWS.length; i++) {
    var row = ROWS[i]
    if (!row.open(s)) continue
    if (scope === null) scope = row.scope(s)
    if (hint === undefined && row.hint) hint = row.hint(s, edit)
    if (scope !== null && hint !== undefined) break
  }
  return {
    scope: scope === null ? viewScope(s) : scope,
    editing: e ? (typeof e.name === "function" ? e.name(s) : e.name) : "",
    hint: hint === undefined ? edit || viewHint(s) : hint
  }
}

if (typeof module !== "undefined") {
  module.exports = {
    ROWS: ROWS,
    top: top
  }
}
