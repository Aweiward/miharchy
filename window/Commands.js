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
  Home: 0x01000010,
  End: 0x01000011,
  Space: 0x20,
  N: 0x4e,
  P: 0x50
}

// keys: printable characters match event.text; "Esc", "Enter", "Space",
// "Tab", "Backtab" (Shift-Tab), "Backspace", "Home", "End" and the arrows
// match the key code.
// hidden: reachable by key only, never listed in the palette.
// view: the command works only while that view (or Browse screen:
// sources, extensions, extension (an extension's details), source,
// global, or its panel: source-filters,
// source-settings, sources-languages; Library screen: categories; or
// overlay: library-options, updates-filter, library-categories, library-remove, manga, manga-categories, manga-options,
// manga-download, manga-duplicates, manga-select, manga-track,
// manga-track-pick, track-ask, downloads, reader, reader-settings, sync,
// sync-held,
// or a restore step: restore-confirm, -checking, -running, -done, -failed,
// or a migration step: migrate-search, -from, -to, -match, -confirm, -busy,
// -done) shows;
// an array allows several.
var commands = [
  { id: "view.library", title: "Library", keys: ["1"] },
  { id: "view.updates", title: "Updates", keys: ["2"] },
  { id: "view.history", title: "History", keys: ["3"] },
  { id: "view.browse", title: "Browse", keys: ["4"] },
  { id: "view.settings", title: "Settings", keys: ["5"] },
  { id: "view.setup", title: "Setup", keys: [] },
  { id: "downloads.open", title: "Download queue", keys: [] },
  { id: "sync.now", title: "Sync now", keys: [] },
  { id: "sync.undo", title: "Undo the last sync", keys: [] },
  { id: "sync.health", title: "Show what the phone lacks", keys: [] },
  { id: "restore.open", title: "Restore a backup", keys: [] },
  { id: "backup.create", title: "Create a backup", keys: [] },
  { id: "mode.incognito", title: "Incognito mode on or off", keys: [] },
  { id: "mode.downloadedOnly", title: "Downloaded only on or off", keys: [] },
  { id: "migrate.batch", title: "Migrate a source", keys: [] },
  // Before library.reload and window.quit: on these screens r and Esc mean
  // something else.
  { id: "extensions.refresh", title: "Refresh extensions", keys: ["r"], view: "extensions", hidden: true },
  { id: "sources.refresh", title: "Refresh sources", keys: ["r"], view: "sources", hidden: true },
  { id: "source.retry", title: "Load again", keys: ["r"], view: "source", hidden: true },
  { id: "manga.refresh", title: "Refresh from the source", keys: ["r"], view: "manga", hidden: true },
  { id: "global.retry", title: "Search failed sources again", keys: ["r"], view: "global", hidden: true },
  { id: "migrate.retry", title: "Search failed again", keys: ["r"], view: ["migrate-search", "migrate-match"], hidden: true },
  // Every step answers Esc, so it never falls through to quit, even while
  // a migration runs.
  { id: "migrate.back", title: "Back", keys: ["Esc", "Backspace"], view: ["migrate-search", "migrate-from", "migrate-to", "migrate-match", "migrate-confirm", "migrate-busy", "migrate-done"], hidden: true },
  // Asked after a mark read, as Mihon's snackbar; only y, n and Esc answer.
  { id: "trackAsk.yes", title: "Update the trackers", keys: ["y"], view: "track-ask", hidden: true },
  { id: "trackAsk.no", title: "Keep the trackers as they are", keys: ["n", "Esc"], view: "track-ask", hidden: true },
  { id: "browse.back", title: "Back", keys: ["Esc", "Backspace"], view: ["source", "global"], hidden: true },
  { id: "extension.back", title: "Back", keys: ["Esc", "Backspace"], view: "extension", hidden: true },
  // F and S close the panel they open, as F does on the Library.
  { id: "panel.closeFilters", title: "Close filters", keys: ["Esc", "Backspace", "F"], view: "source-filters", hidden: true },
  { id: "sources.languagesClose", title: "Close languages", keys: ["Esc", "Backspace", "l"], view: "sources-languages", hidden: true },
  { id: "sources.languagesUp", title: "Previous row", keys: ["k", "Up"], view: "sources-languages", hidden: true },
  { id: "sources.languagesDown", title: "Next row", keys: ["j", "Down"], view: "sources-languages", hidden: true },
  { id: "sources.languagesChoose", title: "Show or hide", keys: ["Enter", "Space"], view: "sources-languages", hidden: true },
  { id: "panel.closeSettings", title: "Close source settings", keys: ["Esc", "Backspace", "S"], view: "source-settings", hidden: true },
  { id: "manga.back", title: "Back", keys: ["Esc", "Backspace"], view: "manga", hidden: true },
  { id: "manga.categoriesClose", title: "Close categories", keys: ["Esc", "Backspace", "c"], view: "manga-categories", hidden: true },
  { id: "track.close", title: "Close tracking", keys: ["Esc", "Backspace", "t"], view: "manga-track", hidden: true },
  { id: "track.back", title: "Back", keys: ["Esc", "Backspace"], view: "manga-track-pick", hidden: true },
  { id: "categories.back", title: "Back", keys: ["Esc", "Backspace"], view: "categories", hidden: true },
  // Clears a search the field kept; with none, it quits like Esc elsewhere.
  { id: "library.clearSearch", title: "Clear the selection or the search", keys: ["Esc"], view: "library", hidden: true },
  // Ends a selection; with none, it quits like Esc elsewhere.
  { id: "updates.clearSelection", title: "Clear the selection", keys: ["Esc"], view: "updates", hidden: true },
  { id: "library.pickClose", title: "Close categories", keys: ["Esc", "Backspace", "C"], view: "library-categories", hidden: true },
  // Mihon's remove dialog asks whether the downloads go too; any other key
  // keeps the manga.
  { id: "library.disarm", title: "Keep the manga", keys: ["Esc"], view: "library-remove", hidden: true },
  { id: "library.removeWithDownloads", title: "Remove from library and delete downloads", keys: ["d"], view: "library-remove", hidden: true },
  { id: "library.optionsClose", title: "Close sort and filter", keys: ["Esc", "Backspace", "F"], view: "library-options", hidden: true },
  { id: "updates.filterClose", title: "Close the filters", keys: ["Esc", "Backspace", "F"], view: "updates-filter", hidden: true },
  { id: "updates.filterUp", title: "Previous row", keys: ["k", "Up"], view: "updates-filter", hidden: true },
  { id: "updates.filterDown", title: "Next row", keys: ["j", "Down"], view: "updates-filter", hidden: true },
  { id: "updates.filterChoose", title: "Change the filter", keys: ["Enter", "Space"], view: "updates-filter", hidden: true },
  { id: "manga.selectEnd", title: "End the selection", keys: ["Esc", "v"], view: "manga-select", hidden: true },
  { id: "manga.optionsClose", title: "Close chapter filter and sort", keys: ["Esc", "Backspace", "F"], view: "manga-options", hidden: true },
  { id: "manga.downloadsClose", title: "Close the download menu", keys: ["Esc", "Backspace", "U"], view: "manga-download", hidden: true },
  { id: "manga.duplicatesClose", title: "Cancel adding", keys: ["Esc", "Backspace"], view: "manga-duplicates", hidden: true },
  { id: "manga.duplicatesUp", title: "Previous manga", keys: ["k", "Up"], view: "manga-duplicates", hidden: true },
  { id: "manga.duplicatesDown", title: "Next manga", keys: ["j", "Down"], view: "manga-duplicates", hidden: true },
  { id: "manga.duplicateOpen", title: "Open the manga in the library", keys: ["Enter"], view: "manga-duplicates", hidden: true },
  { id: "manga.duplicateMigrate", title: "Migrate the manga in the library to this one", keys: ["M"], view: "manga-duplicates", hidden: true },
  { id: "manga.addAnyway", title: "Add anyway", keys: ["a"], view: "manga-duplicates", hidden: true },
  { id: "downloads.close", title: "Close the download queue", keys: ["Esc", "D"], view: "downloads", hidden: true },
  { id: "reader.close", title: "Close the reader", keys: ["Esc", "q"], view: "reader", hidden: true },
  { id: "sync.close", title: "Close the sync result", keys: ["Esc", "q", "Enter"], view: ["sync", "sync-held"], hidden: true },
  { id: "sync.apply", title: "Apply the held sync", keys: ["y"], view: "sync-held", hidden: true },
  { id: "restore.confirm", title: "Restore", keys: ["Enter"], view: "restore-confirm", hidden: true },
  { id: "restore.close", title: "Close", keys: ["Esc", "q"], view: ["restore-confirm", "restore-checking", "restore-running", "restore-done", "restore-failed"], hidden: true },
  { id: "reader.retry", title: "Load again", keys: ["r"], view: "reader", hidden: true },
  // q too: in the reader, q never quits the window.
  { id: "reader.settingsClose", title: "Close reader settings", keys: ["Esc", "Backspace", "s", "q"], view: "reader-settings", hidden: true },
  { id: "history.reload", title: "Reload history", keys: ["r"], view: "history", hidden: true },
  // With no search, shell.qml quits, as Esc does elsewhere.
  { id: "history.clearSearch", title: "Clear the search", keys: ["Esc"], view: "history", hidden: true },
  { id: "library.reload", title: "Reload library", keys: ["r"] },
  { id: "window.quit", title: "Quit", keys: ["q", "Esc"] },
  // Q, as q quits: quits, then starts a window on the code now on disk.
  { id: "window.restart", title: "Restart the window", keys: ["Q"] },
  { id: "window.fullscreen", title: "Fullscreen", keys: ["f"] },  { id: "palette.open", title: "Command palette", keys: [":"], hidden: true },
  { id: "settings.up", title: "Previous setting", keys: ["k", "Up"], view: "settings", hidden: true },
  { id: "settings.down", title: "Next setting", keys: ["j", "Down"], view: "settings", hidden: true },
  { id: "settings.activate", title: "Change setting", keys: ["Enter", "Space"], view: "settings", hidden: true },
  { id: "extensions.up", title: "Previous row", keys: ["k", "Up"], view: "extensions", hidden: true },
  { id: "extensions.down", title: "Next row", keys: ["j", "Down"], view: "extensions", hidden: true },
  { id: "extensions.activate", title: "Install extension or show its details", keys: ["Enter"], view: "extensions", hidden: true },
  { id: "extensions.update", title: "Update extension", keys: ["u"], view: "extensions", hidden: true },
  { id: "extensions.updateAll", title: "Update all extensions", keys: ["U"], view: "extensions", hidden: true },
  { id: "extensions.remove", title: "Uninstall extension or remove repo", keys: ["x"], view: "extensions", hidden: true },
  { id: "extension.up", title: "Previous source", keys: ["k", "Up"], view: "extension", hidden: true },
  { id: "extension.down", title: "Next source", keys: ["j", "Down"], view: "extension", hidden: true },
  { id: "extension.settings", title: "Source settings", keys: ["Enter", "S"], view: "extension", hidden: true },
  { id: "extension.update", title: "Update extension", keys: ["u"], view: "extension", hidden: true },
  { id: "extension.uninstall", title: "Uninstall extension", keys: ["x"], view: "extension", hidden: true },
  { id: "extensions.addRepo", title: "Add extension repo", keys: ["a"], view: "extensions", hidden: true },
  { id: "extensions.filter", title: "Filter extensions", keys: ["/"], view: "extensions", hidden: true },
  { id: "extensions.languages", title: "English or every language", keys: ["l"], view: "extensions", hidden: true },
  { id: "browse.tab", title: "Sources or extensions", keys: ["Tab"], view: ["sources", "extensions"], hidden: true },
  { id: "sources.up", title: "Previous source", keys: ["k", "Up"], view: "sources", hidden: true },
  { id: "sources.down", title: "Next source", keys: ["j", "Down"], view: "sources", hidden: true },
  { id: "sources.pin", title: "Pin or unpin the source", keys: ["p"], view: "sources", hidden: true },
  { id: "sources.languages", title: "Languages and sources", keys: ["l"], view: "sources", hidden: true },
  { id: "sources.open", title: "Open source", keys: ["Enter"], view: "sources", hidden: true },
  { id: "source.left", title: "Previous manga", keys: ["h"], view: "source", hidden: true },
  { id: "source.right", title: "Next manga", keys: ["l"], view: "source", hidden: true },
  { id: "source.up", title: "Row up", keys: ["k", "Up"], view: "source", hidden: true },
  { id: "source.down", title: "Row down", keys: ["j", "Down"], view: "source", hidden: true },
  { id: "source.popular", title: "Popular", keys: ["p"], view: "source", hidden: true },
  { id: "source.latest", title: "Latest", keys: ["n"], view: "source", hidden: true },
  { id: "source.search", title: "Search this source", keys: ["/"], view: "source", hidden: true },
  { id: "source.open", title: "Open manga", keys: ["Enter"], view: "source", hidden: true },
  // F, as on the Library: f is fullscreen everywhere.
  { id: "source.filters", title: "Filter this source", keys: ["F"], view: "source", hidden: true },
  { id: "source.settings", title: "Source settings", keys: ["S"], view: ["sources", "source"], hidden: true },
  { id: "panel.up", title: "Previous row", keys: ["k", "Up"], view: ["source-filters", "source-settings"], hidden: true },
  { id: "panel.down", title: "Next row", keys: ["j", "Down"], view: ["source-filters", "source-settings"], hidden: true },
  { id: "panel.choose", title: "Change or open a row", keys: ["Enter", "Space"], view: ["source-filters", "source-settings"], hidden: true },
  // Settings save as they change; filters wait for a, as Mihon's Filter button.
  { id: "panel.apply", title: "Apply the filters", keys: ["a"], view: "source-filters", hidden: true },
  { id: "panel.reset", title: "Reset the filters", keys: ["x"], view: "source-filters", hidden: true },
  // / searches what the screen shows: one source there, every source here.
  { id: "global.search", title: "Search every source", keys: ["/"], view: ["sources", "global"], hidden: true },
  { id: "global.left", title: "Previous result", keys: ["h"], view: "global", hidden: true },
  { id: "global.right", title: "Next result", keys: ["l"], view: "global", hidden: true },
  { id: "global.up", title: "Previous source", keys: ["k", "Up"], view: "global", hidden: true },
  { id: "global.down", title: "Next source", keys: ["j", "Down"], view: "global", hidden: true },
  { id: "global.open", title: "Open manga", keys: ["Enter"], view: "global", hidden: true },
  { id: "global.pinnedOnly", title: "Search pinned sources only, or every source", keys: ["p"], view: "global", hidden: true },
  { id: "global.onlyResults", title: "Show only sources with results, or every source", keys: ["F"], view: "global", hidden: true },
  { id: "manga.up", title: "Previous chapter", keys: ["k", "Up"], view: ["manga", "manga-select"], hidden: true },
  { id: "manga.down", title: "Next chapter", keys: ["j", "Down"], view: ["manga", "manga-select"], hidden: true },
  { id: "manga.library", title: "Add to or remove from library", keys: ["a"], view: "manga", hidden: true },
  { id: "manga.read", title: "Read chapter", keys: ["Enter"], view: "manga", hidden: true },
  { id: "manga.categories", title: "Categories", keys: ["c"], view: "manga", hidden: true },
  { id: "manga.download", title: "Download chapters", keys: ["d"], view: ["manga", "manga-select"], hidden: true },
  { id: "manga.deleteDownload", title: "Delete downloads", keys: ["x"], view: ["manga", "manga-select"], hidden: true },
  { id: "manga.select", title: "Select chapters", keys: ["v"], view: "manga", hidden: true },
  // Mihon's download menu: the next 1, 5, 10, 25 or a typed number of
  // unread chapters, all unread, or the bookmarked ones.
  { id: "manga.downloads", title: "Download next, unread or bookmarked chapters", keys: ["U"], view: "manga", hidden: true },
  { id: "manga.downloadsUp", title: "Previous row", keys: ["k", "Up"], view: "manga-download", hidden: true },
  { id: "manga.downloadsDown", title: "Next row", keys: ["j", "Down"], view: "manga-download", hidden: true },
  { id: "manga.downloadsChoose", title: "Download these chapters", keys: ["Enter", "Space"], view: "manga-download", hidden: true },
  // Shift, as r refreshes: R and P write read state.
  { id: "manga.markRead", title: "Mark read", keys: ["R"], view: ["manga", "manga-select"], hidden: true },
  { id: "manga.markUnread", title: "Mark unread", keys: ["u"], view: ["manga", "manga-select"], hidden: true },
  { id: "manga.markPrevious", title: "Mark every chapter before read", keys: ["P"], view: "manga", hidden: true },
  { id: "manga.bookmark", title: "Bookmark or unbookmark", keys: ["b"], view: ["manga", "manga-select"], hidden: true },
  // Mihon's Start / Resume button; Enter reads the chapter under the cursor.
  { id: "manga.resume", title: "Read the next unread chapter", keys: ["Space"], view: "manga", hidden: true },
  // F, as the Library's sort and filter.
  { id: "manga.options", title: "Filter and sort chapters", keys: ["F"], view: "manga", hidden: true },
  { id: "manga.optionsUp", title: "Previous row", keys: ["k", "Up"], view: "manga-options", hidden: true },
  { id: "manga.optionsDown", title: "Next row", keys: ["j", "Down"], view: "manga-options", hidden: true },
  { id: "manga.optionsChoose", title: "Change filter or sort", keys: ["Enter", "Space"], view: "manga-options", hidden: true },
  { id: "downloads.open", title: "Download queue", keys: ["D"], view: ["library", "manga"], hidden: true },
  // The views a sync changes; the palette runs it from anywhere.
  { id: "sync.now", title: "Sync now", keys: ["s"], view: ["library", "updates"], hidden: true },
  { id: "downloads.up", title: "Previous download", keys: ["k", "Up"], view: "downloads", hidden: true },
  { id: "downloads.down", title: "Next download", keys: ["j", "Down"], view: "downloads", hidden: true },
  { id: "downloads.moveUp", title: "Move the download up", keys: ["K"], view: "downloads", hidden: true },
  { id: "downloads.moveDown", title: "Move the download down", keys: ["J"], view: "downloads", hidden: true },
  { id: "downloads.top", title: "Move the download to the top", keys: ["t"], view: "downloads", hidden: true },
  { id: "downloads.bottom", title: "Move the download to the bottom", keys: ["b"], view: "downloads", hidden: true },
  { id: "downloads.sortNumber", title: "Sort the queue by chapter number", keys: ["n"], view: "downloads", hidden: true },
  { id: "downloads.sortDate", title: "Sort the queue by upload date", keys: ["u"], view: "downloads", hidden: true },
  { id: "downloads.dequeue", title: "Take out of the queue", keys: ["x"], view: "downloads", hidden: true },
  { id: "downloads.clear", title: "Cancel all downloads", keys: ["X"], view: "downloads", hidden: true },
  { id: "downloads.toggle", title: "Start or stop downloading", keys: ["Space"], view: "downloads", hidden: true },
  { id: "manga.track", title: "Tracking", keys: ["t"], view: "manga", hidden: true },
  // Mihon's WebView and Share, on a desktop: the browser and the clipboard.
  // y yanks, as in vim. In the reader they act on the chapter.
  { id: "manga.openWeb", title: "Open the manga in the browser", keys: ["o"], view: "manga", hidden: true },
  { id: "manga.copyLink", title: "Copy the manga's link", keys: ["y"], view: "manga", hidden: true },
  { id: "manga.notes", title: "Write notes on the manga", keys: ["n"], view: "manga", hidden: true },
  // Mihon's title: a long press copies it, a tap searches it everywhere.
  { id: "manga.copyTitle", title: "Copy the manga's title", keys: ["Y"], view: "manga", hidden: true },
  { id: "manga.searchTitle", title: "Search every source for the title", keys: ["/"], view: "manga", hidden: true },
  { id: "reader.openWeb", title: "Open the chapter in the browser", keys: ["o"], view: "reader", hidden: true },
  { id: "reader.copyLink", title: "Copy the chapter's link", keys: ["y"], view: "reader", hidden: true },
  // b, as on a manga's chapter list.
  { id: "reader.bookmark", title: "Bookmark or unbookmark the chapter", keys: ["b"], view: "reader", hidden: true },
  // Mihon's page actions. Y yanks the page as y yanks the link.
  { id: "reader.savePage", title: "Save the page to Pictures", keys: ["S"], view: "reader", hidden: true },
  { id: "reader.copyPage", title: "Copy the page image", keys: ["Y"], view: "reader", hidden: true },
  { id: "track.up", title: "Up", keys: ["k", "Up"], view: ["manga-track", "manga-track-pick"], hidden: true },
  { id: "track.down", title: "Down", keys: ["j", "Down"], view: ["manga-track", "manga-track-pick"], hidden: true },
  { id: "track.search", title: "Find the manga on the tracker", keys: ["Enter"], view: "manga-track", hidden: true },
  { id: "track.status", title: "Reading status", keys: ["s"], view: "manga-track", hidden: true },
  { id: "track.chapters", title: "Chapters read", keys: ["c"], view: "manga-track", hidden: true },
  { id: "track.score", title: "Score", keys: ["S"], view: "manga-track", hidden: true },
  { id: "track.unbind", title: "Stop tracking", keys: ["x"], view: "manga-track", hidden: true },
  { id: "track.start", title: "Started reading on", keys: ["d"], view: "manga-track", hidden: true },
  { id: "track.finish", title: "Finished reading on", keys: ["D"], view: "manga-track", hidden: true },
  { id: "track.private", title: "Private or public", keys: ["p"], view: "manga-track", hidden: true },
  { id: "track.openWeb", title: "Open the track in the browser", keys: ["o"], view: "manga-track", hidden: true },
  { id: "track.copyLink", title: "Copy the track's link", keys: ["y"], view: "manga-track", hidden: true },
  { id: "track.choose", title: "Choose", keys: ["Enter"], view: "manga-track-pick", hidden: true },
  { id: "manga.categoryUp", title: "Previous category", keys: ["k", "Up"], view: "manga-categories", hidden: true },
  { id: "manga.categoryDown", title: "Next category", keys: ["j", "Down"], view: "manga-categories", hidden: true },
  { id: "manga.categoryToggle", title: "In or out of category", keys: ["Space", "Enter"], view: "manga-categories", hidden: true },
  { id: "reader.left", title: "Page to the left", keys: ["h", "Left"], view: "reader", hidden: true },
  { id: "reader.right", title: "Page to the right", keys: ["l", "Right"], view: "reader", hidden: true },
  { id: "reader.next", title: "Next page", keys: ["Space"], view: "reader", hidden: true },
  { id: "reader.down", title: "Scroll down", keys: ["j", "Down"], view: "reader", hidden: true },
  { id: "reader.up", title: "Scroll up", keys: ["k", "Up"], view: "reader", hidden: true },
  { id: "reader.halfDown", title: "Half a view down", keys: ["d"], view: "reader", hidden: true },
  { id: "reader.halfUp", title: "Half a view up", keys: ["u"], view: "reader", hidden: true },
  { id: "reader.mode", title: "Next reading mode", keys: ["m"], view: "reader", hidden: true },
  { id: "reader.nextChapter", title: "Next chapter", keys: ["]"], view: "reader", hidden: true },
  { id: "reader.previousChapter", title: "Previous chapter", keys: ["["], view: "reader", hidden: true },
  { id: "reader.first", title: "First page", keys: ["Home"], view: "reader", hidden: true },
  { id: "reader.last", title: "Last page", keys: ["End"], view: "reader", hidden: true },
  { id: "reader.goto", title: "Go to page", keys: ["g"], view: "reader", hidden: true },
  { id: "reader.fit", title: "Next page fit", keys: ["z"], view: "reader", hidden: true },
  // Paged modes zoom the page; the strip's zoom is its width.
  { id: "reader.zoomIn", title: "Zoom in, or a wider strip", keys: ["+", "="], view: "reader", hidden: true },
  { id: "reader.zoomOut", title: "Zoom out, or a narrower strip", keys: ["-"], view: "reader", hidden: true },
  { id: "reader.zoomReset", title: "Reset the zoom", keys: ["0"], view: "reader", hidden: true },
  { id: "reader.settings", title: "Reader settings", keys: ["s"], view: "reader", hidden: true },
  { id: "reader.autoScroll", title: "Auto-scroll on or off", keys: ["a"], view: "reader", hidden: true },
  // Only on the Catch-up stop (Reader.caughtUp); elsewhere they do nothing.
  { id: "reader.catchUpContinue", title: "Continue this manga", keys: ["c"], view: "reader", hidden: true },
  { id: "reader.catchUpNext", title: "Next manga in Up next", keys: ["n"], view: "reader", hidden: true },
  { id: "reader.settingsUp", title: "Previous setting", keys: ["k", "Up"], view: "reader-settings", hidden: true },
  { id: "reader.settingsDown", title: "Next setting", keys: ["j", "Down"], view: "reader-settings", hidden: true },
  { id: "reader.settingsChoose", title: "Change setting", keys: ["Enter", "Space"], view: "reader-settings", hidden: true },
  { id: "library.left", title: "Previous manga", keys: ["h", "Left"], view: "library", hidden: true },
  { id: "library.right", title: "Next manga", keys: ["l", "Right"], view: "library", hidden: true },
  { id: "library.up", title: "Row up", keys: ["k", "Up"], view: "library", hidden: true },
  { id: "library.down", title: "Row down", keys: ["j", "Down"], view: "library", hidden: true },
  { id: "library.open", title: "Open manga", keys: ["Enter"], view: "library", hidden: true },
  { id: "library.nextCategory", title: "Next category", keys: ["Tab"], view: "library", hidden: true },
  { id: "library.previousCategory", title: "Previous category", keys: ["Backtab"], view: "library", hidden: true },
  { id: "library.categories", title: "Categories", keys: ["c"], view: "library", hidden: true },
  // u, as Check for new chapters on Updates: Mihon's Update category.
  { id: "library.update", title: "Check this category for new chapters", keys: ["u"], view: "library", hidden: true },
  // Act on the selection, or on the manga under the cursor, as on Updates:
  // v as on a manga's chapters, since Space reads on; U, not u, which
  // checks for new chapters.
  { id: "library.remove", title: "Remove from library", keys: ["x"], view: ["library", "library-remove"], hidden: true },
  { id: "library.select", title: "Select or deselect the manga", keys: ["v"], view: "library", hidden: true },
  { id: "library.selectAll", title: "Select every manga in the category", keys: ["A"], view: "library", hidden: true },
  { id: "library.invert", title: "Invert the selection", keys: ["I"], view: "library", hidden: true },
  { id: "library.markRead", title: "Mark every chapter read", keys: ["R"], view: "library", hidden: true },
  { id: "library.markUnread", title: "Mark every chapter unread", keys: ["U"], view: "library", hidden: true },
  { id: "library.download", title: "Download unread chapters", keys: ["d"], view: "library", hidden: true },
  { id: "library.deleteDownloads", title: "Delete downloads", keys: ["X"], view: "library", hidden: true },
  { id: "library.setCategories", title: "Change categories", keys: ["C"], view: "library", hidden: true },
  { id: "library.pickUp", title: "Previous category", keys: ["k", "Up"], view: "library-categories", hidden: true },
  { id: "library.pickDown", title: "Next category", keys: ["j", "Down"], view: "library-categories", hidden: true },
  { id: "library.pickToggle", title: "In or out of category", keys: ["Space", "Enter"], view: "library-categories", hidden: true },
  { id: "library.search", title: "Search the library", keys: ["/"], view: "library", hidden: true },
  // F, not f: f is fullscreen everywhere.
  { id: "library.options", title: "Sort and filter", keys: ["F"], view: "library", hidden: true },
  // Space, as a manga's Read the next unread chapter.
  { id: "library.continue", title: "Read the next unread chapter", keys: ["Space"], view: "library", hidden: true },
  { id: "library.display", title: "Switch between the cover grid and the list", keys: ["L"], view: "library", hidden: true },
  { id: "library.optionsUp", title: "Previous row", keys: ["k", "Up"], view: "library-options", hidden: true },
  { id: "library.optionsDown", title: "Next row", keys: ["j", "Down"], view: "library-options", hidden: true },
  { id: "library.optionsChoose", title: "Change filter or sort", keys: ["Enter", "Space"], view: "library-options", hidden: true },
  { id: "categories.up", title: "Previous category", keys: ["k", "Up"], view: "categories", hidden: true },
  { id: "categories.down", title: "Next category", keys: ["j", "Down"], view: "categories", hidden: true },
  { id: "categories.moveUp", title: "Move category up", keys: ["K"], view: "categories", hidden: true },
  { id: "categories.moveDown", title: "Move category down", keys: ["J"], view: "categories", hidden: true },
  { id: "categories.add", title: "Add category", keys: ["a"], view: "categories", hidden: true },
  { id: "categories.rename", title: "Rename category", keys: ["Enter"], view: "categories", hidden: true },
  { id: "categories.remove", title: "Delete category", keys: ["x"], view: "categories", hidden: true },
  { id: "history.up", title: "Previous entry", keys: ["k", "Up"], view: "history", hidden: true },
  { id: "history.down", title: "Next entry", keys: ["j", "Down"], view: "history", hidden: true },
  { id: "history.open", title: "Resume chapter", keys: ["Enter"], view: "history", hidden: true },
  { id: "history.remove", title: "Remove from history", keys: ["x"], view: "history", hidden: true },
  { id: "history.clear", title: "Clear history", keys: ["X"], view: "history", hidden: true },
  { id: "history.search", title: "Search the history", keys: ["/"], view: "history", hidden: true },
  { id: "updates.up", title: "Previous update", keys: ["k", "Up"], view: "updates", hidden: true },
  { id: "updates.down", title: "Next update", keys: ["j", "Down"], view: "updates", hidden: true },
  { id: "updates.open", title: "Read chapter", keys: ["Enter"], view: "updates", hidden: true },
  // Not r: r reloads what a view shows, and a library update asks every
  // source.
  { id: "updates.check", title: "Check for new chapters", keys: ["u"], view: "updates", hidden: true },
  // Act on the selection, or on the update under the cursor. U, not u as on
  // a manga: u checks here.
  { id: "updates.select", title: "Select or deselect the update", keys: ["Space"], view: "updates", hidden: true },
  { id: "updates.selectAll", title: "Select all updates", keys: ["A"], view: "updates", hidden: true },
  { id: "updates.invert", title: "Invert the selection", keys: ["I"], view: "updates", hidden: true },
  { id: "updates.markRead", title: "Mark read", keys: ["R"], view: "updates", hidden: true },
  { id: "updates.markUnread", title: "Mark unread", keys: ["U"], view: "updates", hidden: true },
  { id: "updates.bookmark", title: "Bookmark or unbookmark", keys: ["b"], view: "updates", hidden: true },
  { id: "updates.download", title: "Download chapters", keys: ["d"], view: "updates", hidden: true },
  { id: "updates.deleteDownload", title: "Delete downloads", keys: ["x"], view: "updates", hidden: true },
  { id: "updates.filter", title: "Filter updates", keys: ["F"], view: "updates", hidden: true },
  { id: "updates.stop", title: "Stop the library update", keys: ["C"], view: "updates", hidden: true },
  { id: "categories.autoDownload", title: "Include in or exclude from auto-download", keys: ["d"], view: "categories", hidden: true },
  { id: "categories.update", title: "Include in or exclude from updates", keys: ["u"], view: "categories", hidden: true },
  { id: "categories.keepDownloads", title: "Keep or delete read downloads", keys: ["p"], view: "categories", hidden: true },
  { id: "setup.up", title: "Previous step", keys: ["k", "Up"], view: "setup", hidden: true },
  { id: "setup.down", title: "Next step", keys: ["j", "Down"], view: "setup", hidden: true },
  // M, not m: m is the reader's reading mode, and a migration is a big step.
  { id: "manga.migrate", title: "Migrate to another source", keys: ["M"], view: "manga", hidden: true },
  { id: "migrate.batch", title: "Migrate a source", keys: ["M"], view: "sources", hidden: true },
  { id: "migrate.up", title: "Up", keys: ["k", "Up"], view: ["migrate-search", "migrate-from", "migrate-to", "migrate-match", "migrate-done"], hidden: true },
  { id: "migrate.down", title: "Down", keys: ["j", "Down"], view: ["migrate-search", "migrate-from", "migrate-to", "migrate-match", "migrate-done"], hidden: true },
  { id: "migrate.left", title: "Previous result", keys: ["h", "Left"], view: ["migrate-search", "migrate-match"], hidden: true },
  { id: "migrate.right", title: "Next result", keys: ["l", "Right"], view: ["migrate-search", "migrate-match"], hidden: true },
  { id: "migrate.open", title: "Choose", keys: ["Enter"], view: ["migrate-search", "migrate-from", "migrate-to", "migrate-match", "migrate-confirm", "migrate-done"], hidden: true },
  { id: "migrate.search", title: "Search another title", keys: ["/"], view: "migrate-search", hidden: true },
  { id: "migrate.copy", title: "Copy", keys: ["c"], view: "migrate-confirm", hidden: true },
  { id: "migrate.downloads", title: "Delete or keep the old downloads", keys: ["d"], view: "migrate-confirm", hidden: true },
  { id: "migrate.tracks", title: "Take or leave the old tracks", keys: ["t"], view: "migrate-confirm", hidden: true },
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
  if (["Space", "Tab", "Backtab", "Backspace", "Home", "End", "Left", "Up", "Right", "Down"].indexOf(label) !== -1) return ev.key === KEY[label]
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

// The Enter key as handleKey takes it. A double click on an item puts the
// cursor there and sends this, so it runs what Enter runs on that screen.
// A new object each time: the key handlers set accepted on it.
function enter() {
  return { key: KEY.Return, text: "\r", modifiers: 0 }
}

var HINT_KEYS = { enter: [KEY.Return, "\r"], esc: [KEY.Escape, "\u001b"], space: [KEY.Space, " "], tab: [KEY.Tab, "\t"] }

// A hint line split into its parts ("x remove", "enter open"), each with
// the key event a click on it sends, or key null. A part whose first word
// is a named key or one character is a key; a run of single keys ("j k
// move", "h l another match") is movement, which a click on the item
// does instead; a digit is a count ("3 selected"), not a key.
function hintParts(hint) {
  return String(hint || "").split("   ").filter(function(p) { return p.trim() !== "" }).map(function(part) {
    var words = part.trim().split(" ")
    var named = HINT_KEYS[words[0]]
    var single = words[0].length === 1 && !/[0-9]/.test(words[0]) && !(words.length > 1 && words[1].length === 1)
    var key = named ? { key: named[0], text: named[1], modifiers: 0 }
      : single ? { key: words[0].toUpperCase().charCodeAt(0), text: words[0], modifiers: 0 } : null
    return { text: part.trim(), key: key }
  })
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
    enter: enter,
    hintParts: hintParts,
    paletteRows: paletteRows,
    moveCursor: moveCursor
  }
}
