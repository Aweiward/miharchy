pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import "Restore.js" as Restore
import "Sync.js" as Sync

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
  readonly property string devHelper: Quickshell.shellPath(Sync.DEV_HELPER)
  readonly property alias pathField: field

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

  function run(id) {
    switch (id) {
      case "restore.open":
        open = true
        restore = Restore.reduce(restore, { type: "open", folder: folder })
        if (editing) {
          field.text = restore.path
          field.forceActiveFocus()
        }
        break
      case "restore.commit":
        restore = Restore.reduce(restore, { type: "check", text: field.text, home: Quickshell.env("HOME") })
        if (restore.step !== "checking") break
        editEnded()
        proc.command = Restore.command(devHelper, "check", restore.path)
        proc.running = true
        break
      case "restore.confirm":
        restore = Restore.reduce(restore, { type: "start" })
        proc.command = Restore.command(devHelper, "restore", restore.path)
        proc.running = true
        break
      case "restore.cancel":
      case "restore.close":
        close()
        break
    }
  }

  // One process for both jobs: the check ends before the restore starts.
  Process {
    id: proc
    property string output: ""
    onStarted: output = ""
    stdout: SplitParser {
      onRead: function(line) {
        proc.output += line + "\n"
        if (view.restore.step === "running") view.restore = Restore.reduce(view.restore, { type: "line", text: line })
      }
    }
    onRunningChanged: {
      if (running) return
      var step = view.restore.step
      view.restore = Restore.reduce(view.restore, { type: step === "checking" ? "checked" : "finish", text: proc.output })
      if (view.restore.step === "done") view.restored()
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
