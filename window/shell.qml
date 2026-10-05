pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import "Model.js" as Model
import "Commands.js" as Commands
import "Settings.js" as Settings
import "Setup.js" as Setup
import "Chapters.js" as Chapters
import "Downloads.js" as Downloads
import "Library.js" as Library
import "Browse.js" as Browse
import "Storage.js" as Storage
import "Prefs.js" as Prefs
import "Updates.js" as Updates

// The Miharchy window, run as its own Quickshell process (ADR 0003):
// `quickshell -p window`. Decisions live in Model.js and Commands.js; this
// file wires them to the server, the theme and the views.
ShellRoot {
  id: root

  readonly property string configPath: Quickshell.env("MIHARCHY_SERVER_JSON") || Quickshell.env("HOME") + "/.config/miharchy/server.json"

  // The launcher's open-updates starts a window on Updates.
  property string view: Quickshell.env("MIHARCHY_OPEN_VIEW") === "updates" ? "updates" : "library"
  property var config: null
  property var connection: Model.initial()
  property bool paletteOpen: false
  property int libraryCursor: 0
  // A mark read's question to the trackers (Chapters.trackAsk), or null.
  property var trackAsk: null
  // The shown category's id in Model.switcher(); a deleted one falls back to All.
  property int libraryCategory: -1
  // "grid" | "categories"
  property string libraryScreen: "grid"
  property string libraryQuery: ""
  // The Library's sort and filters, as server meta holds them.
  // Downloaded only forces the Downloaded filter on, as in Mihon.
  readonly property bool downloadedOnly: settingsState.values.downloadedOnly === true
  readonly property var libraryPrefs: Prefs.force(libraryStore.values, "libraryFilterDownloaded", "include", downloadedOnly)
  property bool libraryOptions: false
  property int libraryOptionsCursor: 0
  readonly property var switcher: Model.switcher({ manga: Library.apply(connection.manga, libraryPrefs, libraryQuery), categories: connection.categories })
  readonly property int switcherIndex: Model.switcherIndex(switcher, libraryCategory)
  readonly property var shown: switcher[switcherIndex]
  property var settingsState: Settings.initial()
  property int settingsCursor: 0
  property bool settingsEditing: false
  property string settingsError: ""
  // Only the latest library request may update the connection.
  property int requestSeq: 0
  // { mangaId, chapterId } to read once the config loads, or null.
  property var pendingChapter: Model.chapterTarget(Quickshell.env("MIHARCHY_OPEN_CHAPTER"))

  // Manga ids picked with v. The actions take these, or the cursor's
  // manga with none, as on Updates.
  property var librarySelected: []
  readonly property var libraryTargets: Updates.chosen(shown.manga, librarySelected, libraryCursor)
  // What a second x ("remove") or X ("delete" the downloads) does to the
  // targets, or "".
  property string libraryArmed: ""
  // The manga the change categories panel changes; [] while it is closed.
  property var libraryPickIds: []
  property int libraryPickCursor: 0
  readonly property var libraryPickRows: Library.categoryRows(connection.categories, connection.manga.filter(function(m) { return root.libraryPickIds.indexOf(m.id) !== -1 }))
  property string libraryError: ""
  // What u on the Library started; in place of the hint until the next key.
  property string libraryNote: ""

  readonly property string libraryHint: libraryScreen === "categories" ? categoriesView.hint
    : libraryPickIds.length ? "j k move   enter in or out   esc close   "
    : libraryOptions ? "j k move   enter change   esc close   "
    : libraryNote ? libraryNote + "   "
    : libraryArmed === "remove" ? "x again to remove " + Library.count(libraryTargets.length) + " from the library   d also delete the downloads   esc keep   "
    : libraryArmed === "delete" ? "X again to delete the downloads of " + Library.count(libraryTargets.length) + ", any other key keeps them   "
    : (libraryError ? libraryError + "   " : "") + (librarySelected.length
      ? librarySelected.length + " selected   v select   A all   I invert   R read   U unread   d download   X delete downloads   C categories   x remove   esc clear   "
      : "enter open   space read   v select   x remove   " + (libraryQuery ? "esc clear search   " : "/ search   ") + "F sort & filter   " + (libraryPrefs.libraryDisplay === "list" ? "L grid   " : "L list   ") + (switcher.length > 1 ? "tab category   " : "") + "u update   c categories   D queue   s sync   ")

  onSwitcherIndexChanged: libraryCursor = 0
  // A removed manga leaves the grid, so the cursor may point past its end.
  onShownChanged: {
    libraryCursor = Math.max(0, Math.min(shown.manga.length - 1, libraryCursor))
    librarySelected = Updates.keep(librarySelected, shown.manga)
  }

  Theme { id: theme }

  FileView {
    id: configFile
    path: root.configPath
    watchChanges: true
    printErrors: false
    onLoaded: root.applyConfig(text())
    onLoadFailed: root.applyConfig("")
    // An editor's save can truncate before it writes; reading at once would
    // see an empty file, drop the config and reset every view.
    onFileChanged: configReload.restart()
  }

  Timer {
    id: configReload
    interval: 300
    onTriggered: configFile.reload()
  }

  function applyConfig(text) {
    var next = Model.parseConfig(text)
    if (next && config && JSON.stringify(next) === JSON.stringify(config)) return
    config = next
    if (!config) {
      requestSeq++
      connection = Model.reduce(connection, { type: "config-missing" })
      settingsState = Settings.reduce(settingsState, { type: "config-missing" })
      return
    }
    fetchLibrary()
    sendSettings(Settings.loadPayload())
    libraryStore.load()
    if (pendingChapter) openChapter(pendingChapter)
  }

  // The mark's update rows land here, through the launcher's open-chapter.
  function openChapter(target) {
    pendingChapter = target
    if (!config) return
    pendingChapter = null
    if (reader.open) reader.close()
    mangaDetail.close()
    downloadsView.open = false
    view = "updates"
    updatesView.openChapter(target.mangaId, target.chapterId)
  }

  // The mark's new-chapter notification lands here, through the
  // launcher's open-updates.
  function openUpdates() {
    if (reader.open) reader.close()
    mangaDetail.close()
    downloadsView.open = false
    view = "updates"
  }

  IpcHandler {
    target: "miharchy"

    function openChapter(mangaId: int, chapterId: int): void {
      root.openChapter({ mangaId: mangaId, chapterId: chapterId })
    }

    function openUpdates(): void {
      root.openUpdates()
    }
  }

  // Loads and saves alike: every reply carries the values it touched.
  function sendSettings(payload) {
    var req = Model.request(config, payload)
    settingsState = Settings.reduce(settingsState, { type: "request" })
    var xhr = new XMLHttpRequest()
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== XMLHttpRequest.DONE) return
      root.settingsState = Settings.reduce(root.settingsState, { type: "response", reply: Model.reply(xhr.status, xhr.responseText) })
    }
    xhr.open("POST", req.url)
    xhr.setRequestHeader("Content-Type", "application/json")
    xhr.setRequestHeader("Authorization", req.authorization)
    xhr.send(req.body)
  }

  PrefStore {
    id: libraryStore
    config: root.config
    table: Library.PREFS
    onFailed: function(reply) { root.libraryError = reply.message || Model.problem(reply, root.configPath).title }
  }

  function saveSetting(row, value) {
    if (config) sendSettings(Settings.savePayload(row, value))
  }

  // A folder row saves once the folder exists, checked as Setup checks it.
  Process {
    id: folderCheck
    property var row: null
    property string folder: ""

    function check(r, f) {
      folderCheck.row = r
      folderCheck.folder = f
      folderCheck.command = Setup.runCommand("syncFolder", { folder: f })
      folderCheck.running = true
    }

    stdout: StdioCollector {
      onStreamFinished: {
        var job = Setup.parseJob(text)
        if (job.code !== 0) {
          root.settingsError = job.output
          return
        }
        root.endEdit()
        root.saveSetting(folderCheck.row, folderCheck.folder)
      }
    }
  }

  function endEdit() {
    settingsEditing = false
    settingsError = ""
    keyRoot.forceActiveFocus()
  }

  function send(payload, done) {
    var req = Model.request(config, payload)
    var xhr = new XMLHttpRequest()
    xhr.onreadystatechange = function() {
      if (xhr.readyState === XMLHttpRequest.DONE) done(Model.reply(xhr.status, xhr.responseText))
    }
    xhr.open("POST", req.url)
    xhr.setRequestHeader("Content-Type", "application/json")
    xhr.setRequestHeader("Authorization", req.authorization)
    xhr.send(req.body)
  }

  // The one path that marks chapters, from any view. action: "read",
  // "unread" or "bookmark" (a toggle). The trackers hear of a mark read, and
  // every view showing read state or bookmarks reloads.
  function markChapters(chapters, action, mangaIds) {
    var payload = action === "bookmark" ? Chapters.bookmarkPayload(chapters) : Chapters.markPayload(chapters, action === "read")
    if (!payload || !config) return
    // Mihon's delete after marked read takes the chapters this mark reads.
    var marked = chapters.filter(function(c) { return !c.read }).map(function(c) { return c.id })
    send(payload, function(reply) {
      // The push waits for the mark: the server reads the chapters it marked.
      var read = reply.state === "ok" && action === "read"
      var after = read ? Chapters.afterMarkRead(root.settingsState.values.trackOnMarkRead) : null
      var check = after === "check" ? Chapters.trackCheckPayload(mangaIds) : null
      if (after === "push") root.pushTrackers(mangaIds)
      if (check) root.send(check, function(r) { root.trackAsk = r.state === "ok" ? Chapters.trackAsk(r.data) : null })
      if (read && root.settingsState.values.deleteAfterMarkRead) root.deleteRead(marked, refresh)
      else refresh()
      function refresh() {
        // Updates marks chapters of many manga; the detail hears only of its own.
        if (mangaDetail.open && mangaIds.indexOf(mangaDetail.detail.mangaId) !== -1) mangaDetail.markReply(reply)
        updatesView.load()
        root.fetchLibrary()
      }
    })
  }

  function pushTrackers(mangaIds) {
    var track = Chapters.trackPayload(mangaIds)
    if (track) send(track, function() {})
  }

  // Deletes the downloads of the read chapters that Downloads.autoDeletePayload
  // lets go, then calls done, whatever happened.
  function deleteRead(chapterIds, done) {
    send(Downloads.autoDeleteQuery(chapterIds), function(reply) {
      var payload = reply.state === "ok" ? Downloads.autoDeletePayload(reply.data, root.settingsState.values.deleteBookmarked, []) : null
      if (payload) root.send(payload, done)
      else done()
    })
  }

  // Mihon's continue reading: the reader opens on the manga's next unread
  // chapter, by its own chapter filters and sort, without the manga detail.
  function continueReading(m) {
    if (!m.unread) {
      libraryNote = "Every chapter of " + m.title + " is read."
      return
    }
    var cfg = config
    var d = Browse.detail(m.id, false)
    send(Browse.detailPayload(d), function(reply) {
      d = Browse.reduceDetail(d, { type: "reply", reply: reply, config: cfg })
      if (!d.manga) {
        root.libraryError = Browse.notice(d, root.configPath).title
        return
      }
      root.send(Prefs.loadPayload(Chapters.PREFS, m.id), function(saved) {
        var prefs = Prefs.read(Chapters.PREFS, saved.state === "ok" ? saved.data : {}, Prefs.defaults(Chapters.PREFS))
        var next = Library.continueChapter(d.chapters, prefs)
        if (next) reader.start(d.manga, d.chapters, next.id, root.settingsState.values.defaultReadingMode)
        else root.libraryNote = "No next chapter of " + m.title + " passes its chapter filters."
      })
    })
  }

  // Mihon's library selection actions, on the targets: "read" and "unread"
  // mark every chapter, "download" queues the unread ones, "delete" takes
  // the downloads off the disk, "remove" takes the manga out of the
  // library, and "removeDeleting" does both, as Mihon's remove dialog with
  // both boxes ticked. The selection ends, as in Mihon.
  function actOnLibrary(action) {
    var ids = libraryTargets.map(function(m) { return m.id })
    librarySelected = []
    if (!ids.length || !config) return
    var failed = function(reply) {
      if (reply.state !== "ok") root.libraryError = reply.message || Model.problem(reply, root.configPath).title
    }
    var remove = function() {
      root.send(Library.removePayload(ids), function(reply) {
        failed(reply)
        root.fetchLibrary()
      })
    }
    if (action === "remove") return remove()
    send(Library.chaptersPayload(ids), function(reply) {
      if (reply.state !== "ok") return failed(reply)
      var chapters = Browse.toChapters(reply.data.chapters.nodes)
      if (action === "read" || action === "unread") return root.markChapters(chapters, action, ids)
      var payload = action === "download" ? Downloads.enqueuePayload(chapters.filter(function(c) { return !c.read && !c.downloaded })) : Downloads.removePayload(chapters, downloadsView.queue.items)
      if (action === "removeDeleting") {
        if (!payload) return remove()
        // The manga leave only once their downloads are gone.
        return root.send(payload, function(done) {
          downloadsView.apply(done)
          if (done.state === "ok") remove()
          else failed(done)
        })
      }
      if (!payload) {
        root.libraryNote = action === "download" ? "Every unread chapter is downloaded already." : "No chapter is downloaded."
        return
      }
      root.send(payload, function(done) {
        failed(done)
        downloadsView.apply(done)
        root.fetchLibrary()
      })
    })
  }

  // Mihon's default category: a manga the detail adds goes to the chosen
  // category, or the detail's categories picker opens to ask.
  function addedToLibrary(mangaId) {
    var to = Library.defaultCategory(settingsState.values.defaultCategory, connection.categories)
    if (to === -1 && mangaDetail.open && mangaDetail.detail.mangaId === mangaId) mangaDetail.run("manga.categories")
    if (to === -1 || !connection.categories.length) return fetchLibrary()
    send(Library.moveToPayload(mangaId, to, connection.categories), function(reply) {
      if (reply.state !== "ok") root.libraryError = reply.message || Model.problem(reply, root.configPath).title
      mangaDetail.reload()
      root.fetchLibrary()
    })
  }

  // x and X ask once; the same key again acts.
  function armLibrary(kind, action) {
    if (libraryArmed === kind) {
      libraryArmed = ""
      actOnLibrary(action)
    } else if (libraryTargets.length && config) {
      libraryArmed = kind
    }
  }

  function fetchLibrary() {
    var cfg = config
    var req = Model.libraryRequest(cfg)
    var seq = ++requestSeq
    connection = Model.reduce(connection, { type: "request" })
    var xhr = new XMLHttpRequest()
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== XMLHttpRequest.DONE || seq !== root.requestSeq) return
      root.connection = Model.reduce(root.connection, { type: "response", status: xhr.status, body: xhr.responseText, config: cfg })
    }
    xhr.open("POST", req.url)
    xhr.setRequestHeader("Content-Type", "application/json")
    xhr.setRequestHeader("Authorization", req.authorization)
    xhr.send(req.body)
  }

  // The one key path: the window and the palette field both land here.
  // Returns whether a command took the key.
  function handleKey(event) {
    var editing = restoreView.editing ? "restore" : reader.editing ? "reader" : settingsEditing ? "settings" : libraryView.editing ? "library" : historyView.editing ? "history" : settingsView.loginEditing ? "login" : trackPanel.editing ? "track" : mangaDetail.editing ? "manga" : migrateView.editing ? "migrate" : extensionsView.editing ? "extensions" : setupView.editing ? "setup" : categoriesView.editing ? "categories" : browseView.editing
    // An open restore, sync result, download queue, reader, migration or manga
    // detail decides which keys apply, in that order; on Browse, the screen
    // or the panel over it does.
    var scope = trackAsk ? "track-ask" : restoreView.open ? "restore-" + restoreView.restore.step : syncView.open ? "sync" : downloadsView.open ? "downloads" : reader.open ? (reader.panelOpen ? "reader-settings" : "reader")
      : migrateView.open ? "migrate-" + migrateView.step
      : trackPanel.open ? (trackPanel.picking ? "manga-track-pick" : "manga-track")
      : mangaDetail.open ? (mangaDetail.dupesOpen ? "manga-duplicates" : mangaDetail.picking ? "manga-categories" : mangaDetail.optionsOpen ? "manga-options" : mangaDetail.downloadsOpen ? "manga-download" : mangaDetail.selecting ? "manga-select" : "manga")
      : view === "browse" ? (browseView.scope === "extensions" && extensionsView.details ? "extension" : browseView.scope) : view === "library" && libraryScreen === "categories" ? "categories"
      : view === "library" && libraryArmed === "remove" ? "library-remove"
      : view === "library" && libraryPickIds.length ? "library-categories"
      : view === "library" && libraryOptions ? "library-options"
      : view === "updates" && updatesView.filterOpen ? "updates-filter" : view
    var id = Commands.dispatch({ palette: paletteOpen, view: scope, editing: editing, confirming: setupView.confirming }, Commands.keyEvent(event.key, event.text, event.modifiers))
    // Any other key disarms a remove or a delete, even one no command takes.
    if (id !== "library.remove" && id !== "library.deleteDownloads") {
      libraryArmed = ""
      libraryError = ""
    }
    libraryNote = ""
    if (id !== "updates.deleteDownload") updatesView.armed = false
    if (id !== "downloads.clear") downloadsView.armed = false
    if (id !== null) run(id)
    return id !== null
  }

  // A sync or a restore changed the library, and the source names in meta.
  function reloadAfterImport() {
    if (!config) return
    fetchLibrary()
    sendSettings(Settings.loadPayload())
    updatesView.load()
  }

  function closePalette() {
    paletteOpen = false
    keyRoot.forceActiveFocus()
  }

  function run(id) {
    if (id.indexOf("view.") === 0) {
      syncView.open = false
      restoreView.close()
      if (reader.open) reader.close()
      migrateView.close()
      mangaDetail.close()
      downloadsView.open = false
      view = id.slice(5)
      return
    }
    if (id.indexOf("extensions.") === 0 || id.indexOf("extension.") === 0) {
      extensionsView.run(id)
      return
    }
    if (/^(browse|sources|source|global|panel)\./.test(id)) {
      browseView.run(id)
      return
    }
    if (id === "categories.back") {
      libraryScreen = "grid"
      return
    }
    if (id.indexOf("categories.") === 0) {
      categoriesView.run(id)
      return
    }
    if (id === "trackAsk.yes" || id === "trackAsk.no") {
      if (id === "trackAsk.yes") pushTrackers(trackAsk.mangaIds)
      trackAsk = null
      return
    }
    if (id === "manga.track") {
      trackPanel.show(mangaDetail.manga)
      return
    }
    if (id.indexOf("track.") === 0) {
      trackPanel.run(id)
      return
    }
    if (id.indexOf("login.") === 0) {
      settingsView.run(id)
      return
    }
    if (id === "manga.searchTitle") {
      var title = mangaDetail.manga ? mangaDetail.manga.title : ""
      if (!title) return
      run("view.browse")
      browseView.searchEverywhere(title)
      return
    }
    if (id === "manga.migrate") {
      migrateView.startSingle(mangaDetail.manga)
      return
    }
    if (id === "manga.duplicateMigrate") {
      var dupe = mangaDetail.dupes[mangaDetail.dupesCursor]
      mangaDetail.dupes = []
      migrateView.startWith(dupe, mangaDetail.manga)
      return
    }
    if (id === "migrate.batch") {
      migrateView.startBatch()
      return
    }
    if (id.indexOf("migrate.") === 0) {
      migrateView.run(id)
      return
    }
    if (id.indexOf("manga.") === 0) {
      mangaDetail.run(id)
      return
    }
    if (id.indexOf("downloads.") === 0) {
      downloadsView.run(id)
      return
    }
    if (id.indexOf("reader.") === 0) {
      reader.run(id)
      return
    }
    if (id === "history.clearSearch" && !historyView.query) {
      run("window.quit")
      return
    }
    if (id.indexOf("history.") === 0) {
      historyView.run(id)
      return
    }
    if (id.indexOf("setup.") === 0) {
      setupView.run(id)
      return
    }
    if (id === "updates.clearSelection" && !updatesView.selected.length) {
      run("window.quit")
      return
    }
    if (id.indexOf("updates.") === 0) {
      updatesView.run(id)
      return
    }
    if (id.indexOf("sync.") === 0) {
      syncView.run(id)
      return
    }
    if (id.indexOf("restore.") === 0) {
      restoreView.run(id)
      return
    }
    switch (id) {
      // Its row in Settings shows the outcome.
      case "backup.create":
        view = "settings"
        settingsCursor = Settings.ROWS.map(function(r) { return r.command }).indexOf(id)
        settingsView.createBackup()
        break
      case "mode.incognito":
      case "mode.downloadedOnly":
        var mode = Settings.toggle(id.slice(5), settingsState.values)
        saveSetting(mode.row, mode.value)
        break
      case "palette.open":
        paletteOpen = true
        palette.open()
        break
      case "palette.close":
        closePalette()
        break
      case "palette.up":
      case "palette.down":
        palette.cursor = Commands.moveCursor(palette.cursor, id === "palette.up" ? -1 : 1, palette.rows.length)
        break
      case "palette.run":
        var row = palette.currentRow()
        closePalette()
        if (row) run(row.id)
        break
      case "settings.up":
      case "settings.down":
        settingsCursor = Commands.moveCursor(settingsCursor, id === "settings.up" ? -1 : 1, Settings.ROWS.length + 1 + settingsView.trackers.list.length)
        break
      case "settings.activate":
        // After the rows: the cache clear, then the trackers.
        if (settingsCursor === Settings.ROWS.length) {
          settingsView.clearCache()
          break
        }
        if (settingsCursor > Settings.ROWS.length) {
          settingsView.startLogin(settingsCursor - Settings.ROWS.length - 1)
          break
        }
        var srow = Settings.ROWS[settingsCursor]
        var act = Settings.activate(srow, settingsState.values[srow.key], connection.categories)
        if ("run" in act) {
          run(act.run)
        } else if ("save" in act) {
          saveSetting(srow, act.save)
        } else {
          settingsView.editStart = act.edit
          settingsEditing = true
        }
        break
      case "settings.commit":
        var erow = Settings.ROWS[settingsCursor]
        var done = Settings.commit(erow, settingsView.editValue, Quickshell.env("HOME"), settingsState.values)
        if ("error" in done) {
          settingsError = done.error
        } else if ("folder" in done) {
          folderCheck.check(erow, done.folder)
        } else {
          endEdit()
          saveSetting(erow, done.save)
        }
        break
      case "settings.cancel":
        endEdit()
        break
      case "library.left":
      case "library.right":
      case "library.up":
      case "library.down":
        var step = ({ "library.left": -1, "library.right": 1, "library.up": -libraryView.columns, "library.down": libraryView.columns })[id]
        libraryCursor = Math.max(0, Math.min(shown.manga.length - 1, libraryCursor + step))
        break
      case "library.nextCategory":
      case "library.previousCategory":
        libraryCategory = switcher[Commands.moveCursor(switcherIndex, id === "library.nextCategory" ? 1 : -1, switcher.length)].id
        break
      case "library.categories":
        libraryScreen = "categories"
        break
      case "library.update":
        // All is the whole library, which skips excluded categories.
        if (!config) break
        var ids = shown.id === Model.ALL ? null : [shown.id]
        libraryNote = updatesView.check(ids) ? "Checking " + (ids ? shown.name : "the library") + " for new chapters. Updates shows the progress." : "A check for new chapters is already running."
        break
      case "library.search":
        libraryView.openSearch()
        break
      case "library.commit":
        libraryView.closeSearch()
        break
      case "library.cancel":
        libraryQuery = ""
        libraryView.closeSearch()
        break
      case "library.clearSearch":
        if (librarySelected.length) librarySelected = []
        else if (libraryQuery) libraryQuery = ""
        else run("window.quit")
        break
      case "library.options":
        libraryOptions = true
        break
      case "library.optionsClose":
        libraryOptions = false
        break
      case "library.optionsUp":
      case "library.optionsDown":
        libraryOptionsCursor = Commands.moveCursor(libraryOptionsCursor, id === "library.optionsUp" ? -1 : 1, Library.rows(libraryPrefs).length)
        break
      case "library.continue":
        if (shown.manga[libraryCursor] && config) continueReading(shown.manga[libraryCursor])
        break
      case "library.display":
        libraryStore.set([Library.toggleDisplay(libraryPrefs)])
        break
      case "library.optionsChoose":
        libraryStore.set([Library.choose(libraryPrefs, Library.rows(libraryPrefs)[libraryOptionsCursor])])
        break
      case "library.remove":
        armLibrary("remove", "remove")
        break
      case "library.removeWithDownloads":
        actOnLibrary("removeDeleting")
        break
      case "library.disarm":
        break
      case "library.deleteDownloads":
        armLibrary("delete", "delete")
        break
      case "library.select":
        if (shown.manga[libraryCursor]) librarySelected = Updates.toggle(librarySelected, shown.manga[libraryCursor].id)
        break
      case "library.selectAll":
        librarySelected = shown.manga.map(function(m) { return m.id })
        break
      case "library.invert":
        librarySelected = Updates.invert(librarySelected, shown.manga)
        break
      case "library.markRead":
      case "library.markUnread":
        actOnLibrary(id === "library.markRead" ? "read" : "unread")
        break
      case "library.download":
        actOnLibrary("download")
        break
      case "library.setCategories":
        if (!connection.categories.length) libraryNote = "No categories yet. Press c to make one."
        else if (libraryTargets.length) {
          libraryPickIds = libraryTargets.map(function(m) { return m.id })
          libraryPickCursor = 0
        }
        break
      case "library.pickUp":
      case "library.pickDown":
        libraryPickCursor = Math.max(0, Math.min(libraryPickRows.length - 1, libraryPickCursor + (id === "library.pickUp" ? -1 : 1)))
        break
      case "library.pickToggle":
        var pick = libraryPickRows[libraryPickCursor]
        if (pick) send(Library.categoryPayload(pick, libraryPickIds), function(reply) {
          if (reply.state !== "ok") root.libraryError = reply.message || Model.problem(reply, root.configPath).title
          root.fetchLibrary()
        })
        break
      case "library.pickClose":
        libraryPickIds = []
        librarySelected = []
        break
      case "library.open":
        var m = shown.manga[libraryCursor]
        if (m) mangaDetail.openManga(m.id, false)
        break
      case "library.reload":
        if (config) {
          fetchLibrary()
          sendSettings(Settings.loadPayload())
          libraryStore.load()
          settingsView.loadTrackers()
          updatesView.load()
        }
        configFile.reload()
        break
      case "window.fullscreen":
        // xdg-shell's own fullscreen request, so the compositor acts on
        // this window and no other.
        window.fullscreen = !window.fullscreen
        break
      case "window.quit":
        reader.quit()
        break
    }
  }

  // Mihon's keep screen on: the compositor's idle inhibit holds hypridle
  // off while the reader shows and the window is visible.
  IdleInhibitor {
    id: idleInhibitor
    window: window
    enabled: reader.open && root.settingsState.values.keepScreenOn
  }

  FloatingWindow {
    id: window
    title: "Miharchy"
    color: theme.background
    implicitWidth: 1280
    implicitHeight: 800
    minimumSize: Qt.size(560, 360)

    onVisibleChanged: if (!visible) reader.quit()

    FocusScope {
      id: keyRoot
      anchors.fill: parent
      focus: true

      Keys.onPressed: function(event) {
        root.handleKey(event)
        event.accepted = true
      }

      Row {
        id: tabs
        x: theme.fontSize * 2
        height: theme.fontSize * 3.5
        spacing: theme.fontSize * 2

        Repeater {
          model: Model.VIEWS

          Item {
            id: tab
            required property var modelData
            readonly property bool current: modelData.id === root.view
            width: label.implicitWidth
            height: tabs.height

            Text {
              id: label
              anchors.verticalCenter: parent.verticalCenter
              textFormat: Text.StyledText
              text: "<font color='" + theme.muted + "'>" + tab.modelData.key + "</font> " + tab.modelData.title
              color: tab.current ? theme.foreground : theme.muted
              font.family: theme.fontFamily
              font.pixelSize: theme.fontSize
            }

            Rectangle {
              anchors.bottom: parent.bottom
              anchors.bottomMargin: theme.fontSize * 0.6
              width: parent.width
              height: 2
              color: theme.accent
              visible: tab.current
            }

            MouseArea {
              anchors.fill: parent
              cursorShape: Qt.PointingHandCursor
              onClicked: root.handleKey({ key: tab.modelData.key.charCodeAt(0), text: tab.modelData.key, modifiers: 0 })
            }
          }
        }
      }

      Item {
        anchors.top: tabs.bottom
        anchors.bottom: status.top
        anchors.left: parent.left
        anchors.right: parent.right

        LibraryView {
          id: libraryView
          anchors.fill: parent
          visible: root.view === "library" && root.libraryScreen === "grid"
          theme: theme
          config: root.config
          switcher: root.switcher
          switcherIndex: root.switcherIndex
          cursor: root.libraryCursor
          armed: root.libraryArmed
          selected: root.librarySelected
          targets: root.libraryTargets.map(function(m) { return m.id })
          picking: root.libraryPickIds.length > 0
          pickRows: root.libraryPickRows
          pickCursor: root.libraryPickCursor
          notice: Model.notice(root.connection, root.configPath, root.shown, Library.narrowed(root.libraryPrefs, root.libraryQuery))
          prefs: root.libraryPrefs
          query: root.libraryQuery
          optionsOpen: root.libraryOptions
          optionsCursor: root.libraryOptionsCursor
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onEditEnded: keyRoot.forceActiveFocus()
          onSearched: function(text) { root.libraryQuery = text }
          // A click moves the targets, so it disarms x and X as a key does.
          onPicked: function(index) {
            root.libraryArmed = ""
            root.libraryCursor = index
          }
          onCategoryPicked: function(index) {
            root.libraryArmed = ""
            root.libraryCategory = root.switcher[index].id
          }
          onOptionPicked: function(index) { root.libraryOptionsCursor = index }
          onPickPicked: function(index) { root.libraryPickCursor = index }
        }

        CategoriesView {
          id: categoriesView
          anchors.fill: parent
          visible: root.view === "library" && root.libraryScreen === "categories"
          theme: theme
          config: root.config
          categories: root.connection.categories
          manga: root.connection.manga
          loading: root.connection.state === "loading"
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onEditEnded: keyRoot.forceActiveFocus()
          onEdited: if (root.config) root.fetchLibrary()
        }

        SettingsView {
          id: settingsView
          anchors.fill: parent
          visible: root.view === "settings"
          theme: theme
          config: root.config
          values: root.settingsState.values
          categories: root.connection.categories
          cursor: root.settingsCursor
          editing: root.settingsEditing
          problem: Model.problem(root.settingsState, root.configPath)
          editError: root.settingsError
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onPicked: function(index) { root.settingsCursor = index }
          onEditEnded: keyRoot.forceActiveFocus()
        }

        ExtensionsView {
          id: extensionsView
          anchors.fill: parent
          visible: root.view === "browse" && browseView.screen === "extensions"
          theme: theme
          config: root.config
          configPath: root.configPath
          active: visible
          showNsfw: root.settingsState.values.showNsfw
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onEditEnded: keyRoot.forceActiveFocus()
          onOpenSettings: function(source) { browseView.openPanel("preferences", source) }
        }

        // Over the extensions, it shows only its settings panel there.
        BrowseView {
          id: browseView
          anchors.fill: parent
          visible: root.view === "browse" && (screen !== "extensions" || panel !== null)
          theme: theme
          config: root.config
          configPath: root.configPath
          active: root.view === "browse"
          showNsfw: root.settingsState.values.showNsfw
          localFolder: Storage.localFolder({ HOME: Quickshell.env("HOME"), MIHARCHY_SERVER_ROOT: Quickshell.env("MIHARCHY_SERVER_ROOT") }, root.settingsState.values.localSourcePath)
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onEditEnded: keyRoot.forceActiveFocus()
          onOpenManga: function(mangaId) { mangaDetail.openManga(mangaId, true) }
        }

        HistoryView {
          id: historyView
          anchors.fill: parent
          visible: root.view === "history"
          theme: theme
          config: root.config
          configPath: root.configPath
          // Off while the reader shows, so closing it reloads what it read.
          active: root.view === "history" && !reader.open
          onResume: function(manga, chapters, chapterId) { reader.start(manga, chapters, chapterId, root.settingsState.values.defaultReadingMode) }
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onEditEnded: keyRoot.forceActiveFocus()
        }

        UpdatesView {
          id: updatesView
          anchors.fill: parent
          visible: root.view === "updates"
          downloadedOnly: root.downloadedOnly
          theme: theme
          config: root.config
          configPath: root.configPath
          active: visible
          queue: downloadsView.queue.items
          categories: root.connection.categories
          onRead: function(manga, chapters, chapterId) { reader.start(manga, chapters, chapterId, root.settingsState.values.defaultReadingMode) }
          onMark: function(chapters, action, mangaIds) { root.markChapters(chapters, action, mangaIds) }
          onDownloads: function(reply) { downloadsView.apply(reply) }
          onKey: function(event) { event.accepted = root.handleKey(event) }
        }

        SetupView {
          id: setupView
          anchors.fill: parent
          visible: root.view === "setup"
          theme: theme
          config: root.config
          configPath: root.configPath
          home: Quickshell.env("HOME")
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onNeeded: if (root.view === "library") root.view = "setup"
          onWrote: configFile.reload()
          onEditEnded: keyRoot.forceActiveFocus()
        }

        Text {
          anchors.centerIn: parent
          visible: Model.viewIndex(root.view) !== -1 && ["library", "updates", "history", "settings", "browse"].indexOf(root.view) === -1
          text: visible ? Model.VIEWS[Model.viewIndex(root.view)].title + " comes in a later version" : ""
          color: theme.muted
          font.family: theme.fontFamily
          font.pixelSize: theme.fontSize
        }

        MangaDetail {
          id: mangaDetail
          anchors.fill: parent
          theme: theme
          config: root.config
          downloadedOnly: root.downloadedOnly
          configPath: root.configPath
          categories: root.connection.categories
          onCategorized: if (root.config) root.fetchLibrary()
          onLibraryChanged: function(mangaId, inLibrary) {
            browseView.markInLibrary(mangaId, inLibrary)
            if (inLibrary) root.addedToLibrary(mangaId)
            else if (root.config) root.fetchLibrary()
          }
          queue: downloadsView.queue.items
          onDownloads: function(reply) { downloadsView.apply(reply) }
          libraryManga: root.connection.manga
          onRead: function(chapters, chapterId) { reader.start(mangaDetail.manga, chapters, chapterId, root.settingsState.values.defaultReadingMode) }
          onMark: function(chapters, action, mangaId) { root.markChapters(chapters, action, [mangaId]) }
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onEditEnded: keyRoot.forceActiveFocus()
          skipFiltered: root.settingsState.values.skipFiltered
        }

        // Under the tracking panel: a click outside it never reaches a chapter.
        MouseArea {
          anchors.fill: parent
          visible: trackPanel.open
        }

        TrackPanel {
          id: trackPanel
          anchors.top: parent.top
          anchors.right: parent.right
          anchors.margins: theme.fontSize * 2
          width: Math.min(parent.width - theme.fontSize * 4, theme.fontSize * 52)
          theme: theme
          config: root.config
          configPath: root.configPath
          active: mangaDetail.open
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onEditEnded: keyRoot.forceActiveFocus()
        }

        MigrateView {
          id: migrateView
          anchors.fill: parent
          theme: theme
          config: root.config
          configPath: root.configPath
          showNsfw: root.settingsState.values.showNsfw
          categories: root.connection.categories
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onEditEnded: keyRoot.forceActiveFocus()
          onLibraryChanged: if (root.config) root.fetchLibrary()
          onMigrated: function(mangaId) { mangaDetail.openManga(mangaId, false) }
        }
      }

      Item {
        id: status
        anchors.bottom: parent.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.leftMargin: theme.fontSize * 2
        anchors.rightMargin: theme.fontSize * 2
        // A hint wider than the space beside the connection state wraps,
        // and the bar grows up to hold it.
        height: Math.max(theme.fontSize * 2.5, hintBar.height + theme.fontSize)

        Text {
          id: connectionText
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
          // The modes on follow, in the accent color, as Mihon's banners.
          textFormat: Text.StyledText
          text: [({ loading: "connecting", ok: "connected", "no-config": "no server config", down: "server down", unauthorized: "unauthorized", error: "server error" })[root.connection.state]].concat(Settings.modes(root.settingsState.values).map(function(m) { return "<font color='" + theme.accent + "'>" + m + "</font>" })).join("&nbsp;&nbsp;&nbsp;")
          color: root.connection.state === "ok" || root.connection.state === "loading" ? theme.muted : theme.urgent
          font.family: theme.fontFamily
          font.pixelSize: theme.fontSmall
        }

        HintBar {
          id: hintBar
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          text: root.trackAsk ? "y update   n keep" : syncView.open || restoreView.open ? "" : libraryView.editing || historyView.editing ? "enter keep   esc clear" : mangaDetail.writing ? "enter save   shift+enter new line   esc cancel" : root.settingsEditing || settingsView.loginEditing || trackPanel.editing || mangaDetail.editing || migrateView.editing || extensionsView.editing || setupView.editing || categoriesView.editing || browseView.editing ? "enter save   esc cancel" : setupView.confirming ? "y run   n cancel" : migrateView.open ? migrateView.hint + ": commands   q quit" : trackPanel.open ? trackPanel.hint + ": commands   q quit" : mangaDetail.open ? mangaDetail.hint + ": commands   q quit" : (({ library: root.libraryHint, updates: updatesView.hint, history: historyView.hint, settings: "j k move   enter change   ", browse: browseView.panel || browseView.screen !== "extensions" ? browseView.hint : extensionsView.hint + (extensionsView.details ? "" : browseView.hint), setup: "j k move   enter act   " })[root.view] || "") + ": commands   " + (root.view === "browse" ? "" : "r reload   ") + "q quit"
          maxWidth: parent.width - connectionText.width - theme.fontSize * 2
          theme: theme
          onKey: function(event) { root.handleKey(event) }
        }
      }

      ReaderView {
        id: reader
        anchors.fill: parent
        theme: theme
        config: root.config
        configPath: root.configPath
        values: root.settingsState.values
        onKey: function(event) { event.accepted = root.handleKey(event) }
        onEditEnded: keyRoot.forceActiveFocus()
        onSetting: function(row, value) { root.saveSetting(row, value) }
        onClosed: function(chapterId) {
          mangaDetail.reread(chapterId)
          updatesView.load()
          if (root.config) root.fetchLibrary()
        }
        onDeleted: mangaDetail.reload()
      }

      DownloadsView {
        id: downloadsView
        anchors.fill: parent
        theme: theme
        config: root.config
        configPath: root.configPath
        onLeftQueue: function(items) {
          mangaDetail.downloadsLeft(items)
          updatesView.load()
        }
        onKey: function(event) { root.handleKey(event) }
      }

      SyncView {
        id: syncView
        anchors.fill: parent
        theme: theme
        onSynced: root.reloadAfterImport()
        onKey: function(event) { root.handleKey(event) }
      }

      RestoreView {
        id: restoreView
        anchors.fill: parent
        theme: theme
        folder: root.settingsState.values.syncFolder
        onKey: function(event) { event.accepted = root.handleKey(event) }
        onEditEnded: keyRoot.forceActiveFocus()
        onRestored: root.reloadAfterImport()
      }

      // Mihon's snackbar after a mark read, kept until answered.
      Rectangle {
        anchors.bottom: status.top
        anchors.horizontalCenter: parent.horizontalCenter
        width: askText.implicitWidth + theme.fontSize * 3
        height: askText.implicitHeight + theme.fontSize * 1.5
        visible: root.trackAsk !== null
        color: theme.panel
        border.width: 1
        border.color: theme.panelBorder

        Text {
          id: askText
          anchors.centerIn: parent
          text: root.trackAsk ? Chapters.trackAskText(root.trackAsk) : ""
          color: theme.foreground
          font.family: theme.fontFamily
          font.pixelSize: theme.fontSize
        }
      }

      CommandPalette {
        id: palette
        anchors.fill: parent
        visible: root.paletteOpen
        theme: theme
        onKey: function(event) { event.accepted = root.handleKey(event) }
      }
    }
  }
}
