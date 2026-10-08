pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import "Sync.js" as Sync

// Sync now: runs the sync helper and shows its result in a panel over the
// window. Sync.js decides; shell.qml forwards every "sync." command to
// run(). Closing the panel leaves a running sync to finish.
Rectangle {
  id: view

  required property Theme theme
  property bool open: false
  property var sync: Sync.initial()
  readonly property string devHelper: Quickshell.shellPath(Sync.DEV_HELPER)
  readonly property var report: sync.state === "done" || sync.state === "held" ? Sync.report(sync) : []

  // A sync finished and changed the desktop library.
  signal synced()
  // A click on a key in the hint sends that key, as typed.
  signal key(var event)

  visible: open
  color: theme.scrim

  function run(id) {
    switch (id) {
      case "sync.now":
        open = true
        if (sync.state === "running") return
        sync = Sync.reduce(sync, { type: "start" })
        proc.command = Sync.command(devHelper)
        proc.running = true
        break
      case "sync.apply":
        if (sync.state !== "held") return
        sync = Sync.reduce(sync, { type: "apply" })
        proc.command = Sync.command(devHelper, true)
        proc.running = true
        break
      case "sync.close":
        open = false
        break
    }
  }

  Process {
    id: proc
    stdout: StdioCollector {
      onStreamFinished: {
        view.sync = Sync.reduce(view.sync, { type: "finish", text: text })
        if (view.sync.state === "done") view.synced()
      }
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

    Column {
      id: content
      anchors.fill: parent
      anchors.margins: view.theme.fontSize * 1.5
      spacing: view.theme.fontSize * 0.75

      Text {
        text: "Sync"
        color: view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontHeading
      }

      Text {
        width: parent.width
        visible: !view.report.length
        wrapMode: Text.Wrap
        text: view.sync.state === "running" ? "Syncing with the sync folder. This takes a few seconds." : view.sync.message || ""
        color: view.sync.state === "failed" ? view.theme.urgent : view.theme.muted
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
      }

      Repeater {
        model: view.report

        Text {
          required property string modelData
          width: content.width
          wrapMode: Text.Wrap
          text: modelData
          color: view.theme.foreground
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize
        }
      }

      ListView {
        id: list
        width: parent.width
        height: Math.min(contentHeight, view.height * 0.76 - y - hint.height - view.theme.fontSize * 4)
        visible: view.sync.state === "done" && view.sync.unreachable.length > 0
        clip: true
        model: view.sync.state === "done" ? view.sync.unreachable : []

        delegate: Text {
          required property var modelData
          width: list.width
          elide: Text.ElideRight
          text: "  " + modelData.manga + (modelData.chapter ? ", " + modelData.chapter : "") + ": " + modelData.change
          color: view.theme.urgent
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize
        }
      }

      HintBar {
        id: hint
        theme: view.theme
        text: view.sync.state === "running" ? "esc hide (the sync goes on)" : view.sync.state === "held" ? "y apply   esc keep" : "esc close"
        onKey: function(event) { view.key(event) }
      }
    }
  }
}
