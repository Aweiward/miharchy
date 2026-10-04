pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model
import "Commands.js" as Commands
import "Settings.js" as Settings

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
  property var settingsState: Settings.initial()
  property int settingsCursor: 0
  property bool settingsEditing: false
  property string settingsError: ""
  // Only the latest library request may update the connection.
  property int requestSeq: 0

  Theme { id: theme }

  FileView {
    id: configFile
    path: root.configPath
    watchChanges: true
    printErrors: false
    onLoaded: root.applyConfig(text())
    onLoadFailed: root.applyConfig("")
    onFileChanged: reload()
  }

  function applyConfig(text) {
    config = Model.parseConfig(text)
    if (!config) {
      requestSeq++
      connection = Model.reduce(connection, { type: "config-missing" })
      settingsState = Settings.reduce(settingsState, { type: "config-missing" })
      return
    }
    fetchLibrary()
    sendSettings(Settings.loadPayload())
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
    var editing = settingsEditing ? "settings" : extensionsView.editing ? "extensions" : setupView.editing ? "setup" : browseView.editing
    // On Browse, the screen decides which keys apply.
    var scope = view === "browse" ? browseView.screen : view
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
      view = id.slice(5)
      return
    }
    if (id.indexOf("extensions.") === 0) {
      extensionsView.run(id)
      return
    }
    if (/^(browse|sources|source|manga)\./.test(id)) {
      browseView.run(id)
      return
    }
    if (id.indexOf("setup.") === 0) {
      setupView.run(id)
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
        var done = Settings.commit(erow, settingsView.editValue)
        if ("error" in done) {
          settingsError = done.error
        } else {
          endEdit()
          saveSetting(erow, done.save)
        }
        break
      case "settings.cancel":
        endEdit()
        break
      case "library.reload":
        configFile.reload()
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
          anchors.fill: parent
          visible: root.view === "library"
          theme: theme
          manga: root.connection.manga
          notice: Model.notice(root.connection, root.configPath)
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
          onLibraryChanged: if (root.config) root.fetchLibrary()
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
          visible: Model.viewIndex(root.view) !== -1 && ["library", "settings", "browse"].indexOf(root.view) === -1
          text: visible ? Model.VIEWS[Model.viewIndex(root.view)].title + " comes in a later version" : ""
          color: theme.muted
          font.family: theme.fontFamily
          font.pixelSize: theme.fontSize
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
          text: root.settingsEditing || extensionsView.editing || setupView.editing || browseView.editing ? "enter save   esc cancel" : setupView.confirming ? "y run   n cancel" : (({ settings: "j k move   enter change   ", browse: (browseView.screen === "extensions" ? extensionsView.hint : "") + browseView.hint, setup: "j k move   enter act   " })[root.view] || "") + ": commands   " + (root.view === "browse" ? "" : "r reload   ") + "q quit"
          color: theme.muted
          font.family: theme.fontFamily
          font.pixelSize: theme.fontSmall
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
