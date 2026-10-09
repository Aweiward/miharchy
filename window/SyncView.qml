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
  // "sync" shows the last sync; "health" shows sync health (Enter on its Settings row).
  property string mode: "sync"
  property var health: ({ state: "idle" })
  readonly property bool healthMode: mode === "health"
  readonly property string devHelper: Quickshell.shellPath(Sync.DEV_HELPER)
  readonly property var report: healthMode ? (health.state === "ready" ? [Sync.healthSummary(health.health, Date.now())] : [])
    : sync.state === "done" || sync.state === "held" ? Sync.report(sync) : []

  // A sync finished and changed the desktop library.
  signal synced()
  // A click on a key in the hint sends that key, as typed.
  signal key(var event)

  visible: open
  color: theme.scrim

  function run(id) {
    switch (id) {
      case "sync.health":
        mode = "health"
        open = true
        refreshHealth()
        break
      case "sync.now":
        mode = "sync"
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
        view.refreshHealth()
      }
    }
  }

  // Reads only, so it may run beside a sync; the Settings row shows the result too.
  function refreshHealth() {
    if (healthProc.running) return
    healthProc.command = Sync.healthCommand(devHelper)
    healthProc.running = true
  }

  Process {
    id: healthProc
    stdout: StdioCollector {
      onStreamFinished: view.health = Sync.parseHealth(text)
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
        text: view.healthMode ? "Phone sync" : "Sync"
        color: view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontHeading
      }

      Text {
        width: parent.width
        visible: !view.report.length
        wrapMode: Text.Wrap
        text: view.healthMode ? (view.health.state === "failed" ? view.health.message : "Reading the newest phone backup.")
          : view.sync.state === "running" ? "Syncing with the sync folder. This takes a few seconds." : view.sync.message || ""
        color: (view.healthMode ? view.health.state : view.sync.state) === "failed" ? view.theme.urgent : view.theme.muted
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
        visible: model.length > 0
        clip: true
        model: view.healthMode ? (view.health.state === "ready" ? Sync.healthLines(view.health.health) : [])
          : view.sync.state === "done" ? view.sync.unreachable.map(function(u) {
            return { text: "  " + u.manga + (u.chapter ? ", " + u.chapter : "") + ": " + u.change, urgent: true }
          }) : []

        delegate: Text {
          required property var modelData
          width: list.width
          wrapMode: Text.Wrap
          text: modelData.text
          color: modelData.urgent ? view.theme.urgent : view.theme.foreground
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize
        }
      }

      HintBar {
        id: hint
        theme: view.theme
        text: view.healthMode ? "esc close" : view.sync.state === "running" ? "esc hide (the sync goes on)" : view.sync.state === "held" ? "y apply   esc keep" : "esc close"
        onKey: function(event) { view.key(event) }
      }
    }
  }
}
