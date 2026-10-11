pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import "Model.js" as Model
import "Session.js" as Session
import "Commands.js" as Commands
import "Settings.js" as Settings
import "Setup.js" as Setup
import "Chapters.js" as Chapters
import "Downloads.js" as Downloads
import "Library.js" as Library
import "Browse.js" as Browse
import "Storage.js" as Storage
import "Restart.js" as Restart
import "Images.js" as Images
import "Runtime.js" as Runtime
import "UpNext.js" as UpNext
import "Sync.js" as Sync
import "Overlays.js" as Overlays

// The Miharchy window, run as its own Quickshell process (ADR 0003):
// `quickshell -p window`. Decisions live in Model.js and Commands.js; this
// file wires them to the server, the theme and the views.
ShellRoot {
  id: root

  // Quickshell would reload the window in place when its files change. An
  // update writes them one at a time, so a reload can catch half of it, and
  // it drops the reader without the quit path's save. Q restarts instead.
  settings.watchFiles: false

  readonly property string configPath: Quickshell.env("MIHARCHY_SERVER_JSON") || Quickshell.env("HOME") + "/.config/miharchy/server.json"

  // The launcher's open-updates starts a window on Updates.
  property string view: Quickshell.env("MIHARCHY_OPEN_VIEW") === "updates" ? "updates" : "library"
  property var config: null
  property var connection: Model.initial()
  property bool paletteOpen: false
  // A mark read's question to the trackers (Chapters.trackAsk), or null.
  property var trackAsk: null
  // The top overlay's scope, editing prefix and hint (Overlays.js).
  readonly property var overlay: Overlays.top({ trackAsk: trackAsk, readingCard: readingCard, nextChapters: nextChapters, restoreView: restoreView, syncView: syncView, downloadsView: downloadsView, reader: reader, migrateView: migrateView, trackPanel: trackPanel, mangaDetail: mangaDetail, view: view, browseView: browseView, extensionsView: extensionsView, checkView: checkView, updatesView: updatesView, settingsEditing: settingsEditing, libraryView: libraryView, historyView: historyView, settingsView: settingsView, setupView: setupView, categoriesView: categoriesView })
  readonly property bool downloadedOnly: settingsState.values.downloadedOnly === true
  property var settingsState: Settings.initial()
  property int settingsCursor: 0
  property bool settingsEditing: false
  property string settingsError: ""
  // Only the latest library request may update the connection.
  property int requestSeq: 0
  // { mangaId, chapterId } to read once the config loads, or null.
  property var pendingChapter: Model.chapterTarget(Quickshell.env("MIHARCHY_OPEN_CHAPTER"))
  // The launcher's peek starts a window with MIHARCHY_PEEK=1, its
  // peek-next with MIHARCHY_PEEK=next, its peek-open with
  // MIHARCHY_PEEK="<mangaId> <chapterId>"; "" for none.
  property string pendingPeek: Quickshell.env("MIHARCHY_PEEK") || ""
  // The manga ids of Up next when the run of next presses began
  // (UpNext.after); in memory only.
  property var upNextOrder: []

  Theme { id: theme }

  // Whether the window's code on disk differs from what this process loaded,
  // as after `omarchy plugin update`. Q restarts on the new code.
  property var code: Restart.INITIAL
  property bool restarting: false

  Process {
    id: codeCheck
    command: Restart.fingerprintCommand(Quickshell.shellDir)
    stdout: StdioCollector {
      onStreamFinished: root.code = Restart.check(root.code, text)
    }
  }

  // The runtime folder (Runtime.js) is decided before the config applies:
  // all that writes there (server images, the reading card, Setup's QR
  // code) follows the config. heldConfig waits for it.
  property bool runtimeChecked: runtimeCheck.dir === ""
  property var heldConfig: null

  Process {
    id: runtimeCheck
    readonly property string dir: Runtime.candidate(Quickshell.env("XDG_RUNTIME_DIR"))
    command: Runtime.checkCommand(dir)
    running: dir !== ""
    stdout: StdioCollector {
      onStreamFinished: {
        var folder = Runtime.decide(runtimeCheck.dir, text)
        if (folder) {
          imageSweep.dir = folder + "/images/"
          imageSweep.running = true
        }
        root.runtimeChecked = true
        if (root.heldConfig !== null) root.applyConfig(root.heldConfig)
      }
    }
  }

  // Server images left in the runtime folder by windows that crashed or
  // were killed go at start (Images.sweep).
  Process {
    id: imageSweep
    property string dir: ""
    command: Images.sweepCommand(dir)
    stdout: StdioCollector {
      onStreamFinished: {
        var paths = Images.sweep(text, imageSweep.dir, Quickshell.processId)
        if (paths.length) Quickshell.execDetached(["rm", "-f", "--"].concat(paths))
      }
    }
  }

  Timer {
    interval: 30000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: if (!codeCheck.running) codeCheck.running = true
  }

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
    if (!runtimeChecked) {
      heldConfig = text
      return
    }
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
    libraryView.reload()
    var peekTarget = Model.chapterTarget(pendingPeek)
    if (pendingChapter) openChapter(pendingChapter)
    else if (peekTarget) {
      pendingPeek = ""
      peekOpen(peekTarget)
    }
    else if (pendingPeek) peek(pendingPeek === "next")
  }

  // Every path that opens a view or a chapter closes these first. A running
  // sync or restore goes on under its closed panel; a running migration
  // keeps Migrate open (MigrateView.close).
  function closeOverlays() {
    syncView.open = false
    restoreView.close()
    migrateView.close()
    if (reader.open) reader.close()
    mangaDetail.close()
    downloadsView.open = false
    readingCard.open = false
  }

  // The mark's update rows land here, through the launcher's open-chapter.
  // peek: a peek opens it, so Catch-up counts from 0 in the new reader;
  // every peek that opens a manga comes through here.
  function openChapter(target, peek) {
    pendingChapter = target
    if (!config) return
    pendingChapter = null
    closeOverlays()
    view = "updates"
    updatesView.openChapter(target.mangaId, target.chapterId, peek === true)
  }

  // The mark's new-chapter notification lands here, through the
  // launcher's open-updates.
  function openUpdates() {
    closeOverlays()
    view = "updates"
  }

  // The launcher's peek: the reader on the head of Up next, else the
  // Library with its search open. next (the launcher's peek-next): the
  // manga after the reader's in Up next (UpNext.after).
  function peek(next) {
    pendingPeek = next ? "next" : "1"
    if (!config) return
    pendingPeek = ""
    var library = function(reply) {
      root.closeOverlays()
      root.view = "library"
      if (reply && reply.state !== "ok") libraryView.report(reply)
      else libraryView.openSearch()
    }
    send(UpNext.payload(), function(reply) {
      if (reply.state !== "ok") return library(reply)
      var list = UpNext.list(reply.data, root.downloadedOnly, Date.now())
      if (!next) root.upNextOrder = list.map(function(e) { return e.mangaId })
      var target = next ? root.nextInOrder(list, reader.open ? reader.reader.mangaId : null) : list[0]
      if (target) root.openChapter(target, true)
      else library()
    })
  }

  // The launcher's peek-open (the popup's Up next rows): that chapter as a
  // peek opens it, and the next key starts a new run from it.
  function peekOpen(target) {
    root.upNextOrder = []
    root.openChapter(target, true)
  }

  // The next key's pick from list: the manga after current in the run's
  // order, which starts over when current is not in it.
  function nextInOrder(list, current) {
    if (current === null || root.upNextOrder.indexOf(current) === -1)
      root.upNextOrder = list.map(function(e) { return e.mangaId })
    return UpNext.after(list, root.upNextOrder, current)
  }

  // A Catch-up stop names the manga the next key would open; n then runs
  // the next key (peek(true)). Itself again, or none, is nothing to offer.
  function lookUpNext(mangaId) {
    send(UpNext.payload(), function(reply) {
      if (!reader.open || reader.reader.mangaId !== mangaId) return
      var next = reply.state === "ok" ? root.nextInOrder(UpNext.list(reply.data, root.downloadedOnly, Date.now()), mangaId) : null
      if (next && next.mangaId === mangaId) next = null
      var manga = next ? (root.connection.manga || []).filter(function(m) { return m.id === next.mangaId })[0] : null
      reader.upNext = next ? { target: next, title: manga ? manga.title : "Manga " + next.mangaId } : null
    })
  }

  IpcHandler {
    target: "miharchy"

    function peek(): void {
      root.peek(false)
    }

    function peekNext(): void {
      root.peek(true)
    }

    function peekOpen(mangaId: int, chapterId: int): void {
      root.peekOpen({ mangaId: mangaId, chapterId: chapterId })
    }

    function openChapter(mangaId: int, chapterId: int): void {
      root.openChapter({ mangaId: mangaId, chapterId: chapterId })
    }

    function openUpdates(): void {
      root.openUpdates()
    }
  }

  // Loads and saves alike: every reply carries the values it touched.
  function sendSettings(payload) {
    settingsState = Settings.reduce(settingsState, { type: "request" })
    Session.send(config, payload, function(reply) {
      root.settingsState = Settings.reduce(root.settingsState, { type: "response", reply: reply })
    })
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
        var job = Setup.parseJob(text, Setup.LIMITS.syncFolder[0])
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
    return Session.send(config, payload, done)
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

  // Mihon's default category: a manga the detail adds goes to the chosen
  // category, or the detail's categories picker opens to ask.
  function addedToLibrary(mangaId) {
    var to = Library.defaultCategory(settingsState.values.defaultCategory, connection.categories)
    if (to === -1 && mangaDetail.open && mangaDetail.detail.mangaId === mangaId) mangaDetail.run("manga.categories")
    if (to === -1 || !connection.categories.length) return fetchLibrary()
    send(Library.moveToPayload(mangaId, to, connection.categories), function(reply) {
      libraryView.report(reply)
      mangaDetail.reload()
      root.fetchLibrary()
    })
  }

  function fetchLibrary() {
    var cfg = config
    var seq = ++requestSeq
    connection = Model.reduce(connection, { type: "request" })
    Session.send(cfg, { query: Model.LIBRARY_QUERY }, function(reply) {
      if (seq === root.requestSeq) root.connection = Model.reduce(root.connection, { type: "response", reply: reply, config: cfg })
    })
  }

  // The one key path: the window and the palette field both land here.
  // Returns whether a command took the key.
  function handleKey(event) {
    var id = Commands.dispatch({ palette: paletteOpen, view: overlay.scope, editing: overlay.editing, confirming: setupView.confirming }, Commands.keyEvent(event.key, event.text, event.modifiers))
    // Every key, even one no command takes, clears the Library's note; all
    // but x and X also disarm and clear its error (Library.reduce "key").
    libraryView.keyed(id)
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
      closeOverlays()
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
    if ((id.indexOf("library.") === 0 || id === "categories.back") && libraryView.run(id)) return
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
    if (id === "nextChapters.upNext") {
      nextChapters.openUpNext()
      return
    }
    if (id.indexOf("nextChapters.") === 0) {
      nextChapters.run(id)
      return
    }
    if (id === "migrate.batch") {
      migrateView.startBatch()
      return
    }
    if (id === "check.migrate") {
      migrateView.startList(checkView.migrateList())
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
    if (id.indexOf("readingCard.") === 0) {
      readingCard.run(id)
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
    if (id.indexOf("check.") === 0) {
      checkView.run(id)
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
    if (id === "sync.undo") {
      restoreView.openFile(Quickshell.env("HOME") + "/" + Sync.PRE_SYNC)
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
      case "library.reload":
        if (config) {
          fetchLibrary()
          sendSettings(Settings.loadPayload())
          libraryView.reload()
          settingsView.loadTrackers()
          updatesView.load()
          if (view === "check") checkView.load()
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
      case "window.restart":
        // The new window starts once this process is gone, after the quit
        // path's saves.
        if (restarting) break
        restarting = true
        Quickshell.execDetached(Restart.relaunchCommand(Quickshell.processId, Quickshell.shellPath("miharchy")))
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
              // Styled for the key's color; Model.VIEWS is constant text.
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
          visible: root.view === "library" && screen === "grid"
          theme: theme
          config: root.config
          configPath: root.configPath
          connection: root.connection
          downloadedOnly: root.downloadedOnly
          categoriesHint: categoriesView.hint
          queue: downloadsView.queue.items
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onEditEnded: keyRoot.forceActiveFocus()
          onMark: function(chapters, action, mangaIds) { root.markChapters(chapters, action, mangaIds) }
          onDownloads: function(reply) { downloadsView.apply(reply) }
          onEdited: root.fetchLibrary()
          onRead: function(manga, chapters, chapterId) { reader.start(manga, chapters, chapterId, root.settingsState.values.defaultReadingMode) }
          onOpenManga: function(mangaId) { mangaDetail.openManga(mangaId, false) }
          onDownloadMenu: function(set) { nextChapters.openFor(set) }
          onCheck: function(categories, done) { done(updatesView.check(categories)) }
          onQuit: root.run("window.quit")
        }

        CategoriesView {
          id: categoriesView
          anchors.fill: parent
          visible: root.view === "library" && libraryView.screen === "categories"
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
          health: syncView.health
          onHealthWanted: syncView.refreshHealth()
          checkCount: checkView.countText
          onCheckWanted: checkView.load()
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
          onRead: function(manga, chapters, chapterId, peek) { reader.start(manga, chapters, chapterId, root.settingsState.values.defaultReadingMode, peek) }
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
          offers: Setup.offersOnStart({ MIHARCHY_PEEK: Quickshell.env("MIHARCHY_PEEK"), MIHARCHY_OPEN_CHAPTER: Quickshell.env("MIHARCHY_OPEN_CHAPTER"), MIHARCHY_OPEN_VIEW: Quickshell.env("MIHARCHY_OPEN_VIEW") })
          onNeeded: if (root.view === "library") root.view = "setup"
          onWrote: configFile.reload()
          onEditEnded: keyRoot.forceActiveFocus()
        }

        LibraryCheckView {
          id: checkView
          anchors.fill: parent
          visible: root.view === "check"
          active: visible
          theme: theme
          config: root.config
          configPath: root.configPath
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onMergeChosen: function(job) { migrateView.startWith(job.old, job.kept) }
        }

        Text {
          textFormat: Text.PlainText
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
          pinned: Browse.pinned(browseView.prefs)
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onEditEnded: keyRoot.forceActiveFocus()
          onLibraryChanged: {
            if (root.config) root.fetchLibrary()
            if (checkView.active) checkView.load()
          }
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
          // Styled for that color; the states and Settings.modes are constant text.
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
          text: root.overlay.hint
          maxWidth: parent.width - connectionText.width - theme.fontSize * 2 - (codeHint.visible ? codeHint.width + theme.fontSize * 2 : 0)
          theme: theme
          onKey: function(event) { root.handleKey(event) }
        }

        HintBar {
          id: codeHint
          anchors.left: connectionText.right
          anchors.leftMargin: theme.fontSize * 2
          anchors.verticalCenter: parent.verticalCenter
          visible: root.code.changed
          text: root.code.changed ? "new version   Q restart" : ""
          color: theme.accent
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
        onCaughtUpOn: function(mangaId) { root.lookUpNext(mangaId) }
        onNextManga: root.peek(true)
      }

      DownloadsView {
        id: downloadsView
        anchors.fill: parent
        theme: theme
        config: root.config
        configPath: root.configPath
        flareOn: root.settingsState.values.flareSolverrEnabled === true
        lastRun: nextChapters.lastRun
        onLeftQueue: function(items) {
          mangaDetail.downloadsLeft(items)
          updatesView.load()
        }
        onKey: function(event) { root.handleKey(event) }
      }

      NextChaptersMenu {
        id: nextChapters
        anchors.fill: parent
        theme: theme
        config: root.config
        queueItems: downloadsView.queue.items
        onDownloads: function(reply) { downloadsView.apply(reply) }
        onQueued: {
          downloadsView.cursor = -1
          downloadsView.run("downloads.open")
        }
        onKey: function(event) { event.accepted = root.handleKey(event) }
        onEditEnded: keyRoot.forceActiveFocus()
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

      ReadingCard {
        id: readingCard
        anchors.fill: parent
        theme: theme
        config: root.config
        configPath: root.configPath
        folder: root.settingsState.values.pageFolder || ""
        onKey: function(event) { root.handleKey(event) }
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
          textFormat: Text.PlainText
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
