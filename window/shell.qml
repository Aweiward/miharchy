pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model
import "Commands.js" as Commands
import "Settings.js" as Settings
import "Setup.js" as Setup

// The Miharchy window, run as its own Quickshell process (ADR 0003):
// `quickshell -p window`. Decisions live in Model.js and Commands.js; this
// file wires them to the server, the theme and the views.
ShellRoot {
  id: root

  readonly property string configPath: Quickshell.env("MIHARCHY_SERVER_JSON") || Quickshell.env("HOME") + "/.config/miharchy/server.json"

  property string view: "library"
  property var config: null
  property var connection: Model.initial()
  property bool paletteOpen: false
  property int libraryCursor: 0
  // The shown category's id in Model.switcher(); a deleted one falls back to All.
  property int libraryCategory: -1
  // "grid" | "categories"
  property string libraryScreen: "grid"
  readonly property var switcher: Model.switcher(connection)
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

  onSwitcherIndexChanged: libraryCursor = 0

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

  IpcHandler {
    target: "miharchy"

    function openChapter(mangaId: int, chapterId: int): void {
      root.openChapter({ mangaId: mangaId, chapterId: chapterId })
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
    var editing = settingsEditing ? "settings" : extensionsView.editing ? "extensions" : setupView.editing ? "setup" : categoriesView.editing ? "categories" : browseView.editing
    // An open sync result, download queue, reader or manga detail decides
    // which keys apply, in that order; on Browse, the screen does.
    var scope = syncView.open ? "sync" : downloadsView.open ? "downloads" : reader.open ? "reader"
      : mangaDetail.open ? (mangaDetail.picking ? "manga-categories" : mangaDetail.selecting ? "manga-select" : "manga")
      : view === "browse" ? browseView.screen : view === "library" && libraryScreen === "categories" ? "categories" : view
    var id = Commands.dispatch({ palette: paletteOpen, view: scope, editing: editing, confirming: setupView.confirming }, Commands.keyEvent(event.key, event.text, event.modifiers))
    if (id !== null) run(id)
    return id !== null
  }

  function closePalette() {
    paletteOpen = false
    keyRoot.forceActiveFocus()
  }

  function run(id) {
    if (id.indexOf("view.") === 0) {
      syncView.open = false
      if (reader.open) reader.close()
      mangaDetail.close()
      downloadsView.open = false
      view = id.slice(5)
      return
    }
    if (id.indexOf("extensions.") === 0) {
      extensionsView.run(id)
      return
    }
    if (/^(browse|sources|source|global)\./.test(id)) {
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
    if (id.indexOf("history.") === 0) {
      historyView.run(id)
      return
    }
    if (id.indexOf("setup.") === 0) {
      setupView.run(id)
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
    switch (id) {
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
        settingsCursor = Commands.moveCursor(settingsCursor, id === "settings.up" ? -1 : 1, Settings.ROWS.length)
        break
      case "settings.activate":
        var srow = Settings.ROWS[settingsCursor]
        var act = Settings.activate(srow, settingsState.values[srow.key])
        if ("save" in act) {
          saveSetting(srow, act.save)
        } else {
          settingsView.editStart = act.edit
          settingsEditing = true
        }
        break
      case "settings.commit":
        var erow = Settings.ROWS[settingsCursor]
        var done = Settings.commit(erow, settingsView.editValue, Quickshell.env("HOME"))
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
      case "library.open":
        var m = shown.manga[libraryCursor]
        if (m) mangaDetail.openManga(m.id, false)
        break
      case "library.reload":
        if (config) {
          fetchLibrary()
          sendSettings(Settings.loadPayload())
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
        Qt.quit()
        break
    }
  }

  FloatingWindow {
    id: window
    title: "Miharchy"
    color: theme.background
    implicitWidth: 1280
    implicitHeight: 800
    minimumSize: Qt.size(560, 360)

    onVisibleChanged: if (!visible) Qt.quit()

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
          switcher: root.switcher
          switcherIndex: root.switcherIndex
          cursor: root.libraryCursor
          notice: Model.notice(root.connection, root.configPath, root.shown)
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
          values: root.settingsState.values
          cursor: root.settingsCursor
          editing: root.settingsEditing
          problem: Model.problem(root.settingsState, root.configPath)
          editError: root.settingsError
          onKey: function(event) { event.accepted = root.handleKey(event) }
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
        }

        BrowseView {
          id: browseView
          anchors.fill: parent
          visible: root.view === "browse" && screen !== "extensions"
          theme: theme
          config: root.config
          configPath: root.configPath
          active: root.view === "browse"
          showNsfw: root.settingsState.values.showNsfw
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
        }

        UpdatesView {
          id: updatesView
          anchors.fill: parent
          visible: root.view === "updates"
          theme: theme
          config: root.config
          configPath: root.configPath
          active: visible
          onRead: function(manga, chapters, chapterId) { reader.start(manga, chapters, chapterId, root.settingsState.values.defaultReadingMode) }
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
          configPath: root.configPath
          categories: root.connection.categories
          onCategorized: if (root.config) root.fetchLibrary()
          onLibraryChanged: function(mangaId, inLibrary) {
            browseView.markInLibrary(mangaId, inLibrary)
            if (root.config) root.fetchLibrary()
          }
          queue: downloadsView.queue.items
          onDownloads: function(reply) { downloadsView.apply(reply) }
          onRead: function(chapters, chapterId) { reader.start(mangaDetail.manga, chapters, chapterId, root.settingsState.values.defaultReadingMode) }
        }
      }

      Item {
        id: status
        anchors.bottom: parent.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.leftMargin: theme.fontSize * 2
        anchors.rightMargin: theme.fontSize * 2
        height: theme.fontSize * 2.5

        Text {
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
          text: ({ loading: "connecting", ok: "connected", "no-config": "no server config", down: "server down", unauthorized: "unauthorized", error: "server error" })[root.connection.state]
          color: root.connection.state === "ok" || root.connection.state === "loading" ? theme.muted : theme.urgent
          font.family: theme.fontFamily
          font.pixelSize: theme.fontSmall
        }

        Text {
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          text: syncView.open ? "" : root.settingsEditing || extensionsView.editing || setupView.editing || categoriesView.editing || browseView.editing ? "enter save   esc cancel" : setupView.confirming ? "y run   n cancel" : mangaDetail.open ? mangaDetail.hint + ": commands   q quit" : (({ library: root.libraryScreen === "categories" ? categoriesView.hint : "hjkl move   enter open   " + (root.switcher.length > 1 ? "tab category   " : "") + "c categories   D downloads   s sync   ", updates: "j k move   enter read   u check   s sync   ", history: historyView.hint, settings: "j k move   enter change   ", browse: (browseView.screen === "extensions" ? extensionsView.hint : "") + browseView.hint, setup: "j k move   enter act   " })[root.view] || "") + ": commands   " + (root.view === "browse" ? "" : "r reload   ") + "q quit"
          color: theme.muted
          font.family: theme.fontFamily
          font.pixelSize: theme.fontSmall
        }
      }

      ReaderView {
        id: reader
        anchors.fill: parent
        theme: theme
        config: root.config
        configPath: root.configPath
        deleteAfterRead: root.settingsState.values.deleteAfterRead
        onClosed: function(chapterId) {
          mangaDetail.reread(chapterId)
          updatesView.load()
        }
        onDeleted: mangaDetail.reload()
      }

      DownloadsView {
        id: downloadsView
        anchors.fill: parent
        theme: theme
        config: root.config
        configPath: root.configPath
        onLeftQueue: function(items) { mangaDetail.downloadsLeft(items) }
      }

      SyncView {
        id: syncView
        anchors.fill: parent
        theme: theme
        onSynced: if (root.config) {
          root.fetchLibrary()
          root.sendSettings(Settings.loadPayload())
          updatesView.load()
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
