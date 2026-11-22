pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import "Restore.js" as Restore
import "Session.js" as Session

// Restore a backup: a panel over the window, the same shape as the sync
// result. Restore.js decides; shell.qml forwards every "restore." command
// to run(). Closing the panel leaves a running restore to finish.
Rectangle {
  id: view

  required property Theme theme
  // The sync folder, where the path starts.
  property string folder: ""
  property bool open: false
  property var restore: Restore.initial()
  readonly property bool editing: open && restore.step === "path"
  readonly property alias pathField: field
  property string backend: "core"
  property var config: null

  signal key(var event)
  signal editEnded()
  // A restore finished and changed the desktop library.
  signal restored()

  visible: open
  color: theme.scrim

  function close() {
    open = false
    editEnded()
  }

  // Opens the panel; a path fills the field over the last one.
  function openFile(path) {
    open = true
    restore = Restore.reduce(restore, { type: "open", folder: folder, path: path })
    if (editing) {
      field.text = restore.path
      field.forceActiveFocus()
    }
  }

  // Core's undo of the last sync: core names the file, which lives in its data folder.
  function openPreSync() {
    if (restore.step === "checking" || restore.step === "running") {
      open = true
      return
    }
    open = true
    restore = Restore.reduce(restore, { type: "check-presync" })
    coreSend(Restore.checkPayload(restore), "checked-reply")
  }

  function coreSend(payload, type) {
    var done = function(reply) {
      view.restore = Restore.reduce(view.restore, { type: type, reply: reply })
      if (view.restore.step === "done") view.restored()
    }
    // A missing core.json leaves config null: say so, never "Reading" for ever.
    if (!config) return done({ state: "no-config" })
    Session.send(config, payload, done)
  }

  function run(id) {
    switch (id) {
      case "restore.open":
        openFile("")
        break
      case "restore.commit":
        restore = Restore.reduce(restore, { type: "check", text: field.text, home: Quickshell.env("HOME") })
        if (restore.step !== "checking") break
        editEnded()
        coreSend(Restore.checkPayload(restore), "checked-reply")
        break
      case "restore.confirm":
        if (restore.step !== "confirm") break
        restore = Restore.reduce(restore, { type: "start" })
        coreSend(Restore.importPayload(restore), "finish-reply")
        break
      case "restore.cancel":
      case "restore.close":
        close()
        break
    }
  }

  MouseArea {
    anchors.fill: parent
  }

  Rectangle {
    anchors.horizontalCenter: parent.horizontalCenter
    y: parent.height * 0.12
    width: Math.min(parent.width - view.theme.fontSize * 4, view.theme.fontSize * 56)
    height: Math.min(parent.height * 0.76, content.implicitHeight + view.theme.fontSize * 3)
    color: view.theme.panel
    border.color: view.theme.panelBorder
    border.width: 1
    clip: true

    Column {
      id: content
      anchors.fill: parent
      anchors.margins: view.theme.fontSize * 1.5
      spacing: view.theme.fontSize * 0.75

      Text {
        textFormat: Text.PlainText
        text: "Restore a backup"
        color: view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontHeading
      }

      TextInput {
        id: field
        width: parent.width
        visible: view.restore.step === "path"
        clip: true
        color: view.theme.foreground
        selectionColor: view.theme.selected
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
        Keys.onPressed: function(event) { view.key(event) }
      }

      Repeater {
        model: Restore.lines(view.restore)

        Text {
          textFormat: Text.PlainText
          required property string modelData
          width: content.width
          wrapMode: Text.Wrap
          text: modelData
          color: view.restore.step === "failed" || view.restore.error ? view.theme.urgent : view.theme.foreground
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize
        }
      }

      HintBar {
        theme: view.theme
        text: Restore.hint(view.restore)
        onKey: function(event) { view.key(event) }
      }
    }
  }
}
