pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import "Setup.js" as Setup
import "Settings.js" as Settings
import "Session.js" as Session
import "Commands.js" as Commands

// The setup screen: one row per Setup.STEPS entry. It owns the one Process
// that runs checks and confirmed steps, and sends its own server reads and
// writes. The window's dispatcher hands it keys through run().
Item {
  id: view

  required property Theme theme
  property var config: null
  property string configPath: ""
  property string home: ""

  property var setup: Setup.initial()
  property int cursor: 0
  property bool editing: false
  property string message: ""
  readonly property bool confirming: setup.confirm !== null
  // The folder waiting on its existence check.
  property string folder: ""
  property bool checked: false
  property bool offered: false
  // The window runs from the repo's window/, beside server/ and sync/.
  readonly property string serverScript: Quickshell.shellPath("../server/miharchy-server")
  readonly property string syncDir: Quickshell.shellPath("../sync")
  readonly property var current: Setup.STEPS[cursor]
  readonly property var currentStatus: Setup.status(setup, current.id)

  signal key(var event)
  // The first check found a required step not done.
  signal needed()
  // A step changed the server's config or settings.
  signal wrote()
  signal editEnded()

  // A click moves the cursor as j and k do; a double click then sends Enter.
  function point(index, twice) {
    if (editing || confirming) return
    cursor = index
    if (twice) key(Commands.enter())
  }

  Component.onCompleted: check()
  onConfigChanged: readServer()

  function start(id, command) {
    message = ""
    setup = Setup.reduce(setup, { type: "start", id: id })
    proc.job = id
    proc.command = command
    proc.running = true
  }

  function check() {
    if (!setup.job) start("probe", Setup.probeCommand(configPath, syncDir, Quickshell.shellDir))
  }

  function post(payload, done) {
    return Session.send(config, payload, done)
  }

  function readServer() {
    if (config) post({ query: Setup.SERVER_QUERY }, function(reply) {
      view.setup = Setup.reduce(view.setup, { type: "server", reply: reply })
      view.offer()
    })
  }

  // Once a session: open on optional steps the user has not been shown, then
  // record them so a skipped step stays quiet until it changes.
  function offer() {
    if (offered || !Setup.unoffered(setup).length) return
    offered = true
    needed()
    post(Setup.offerPayload(setup), function() {})
  }

  function finished(id, text) {
    setup = Setup.reduce(setup, { type: "finish", id: id, text: text })
    if (id === "probe") {
      readServer()
      if (checked) return
      checked = true
      cursor = Setup.next(setup)
      if (Setup.incomplete(setup)) needed()
      return
    }
    var save = Setup.savePayload(id, setup.results[id], folder)
    if (save) {
      post(save, function(reply) {
        if (reply.state !== "ok") view.message = "Saving to the server failed: " + (reply.message || reply.state) + "."
        view.wrote()
        view.readServer()
      })
    }
    if (id === "server") wrote()
    check()
  }

  function endEdit() {
    editing = false
    message = ""
    editEnded()
  }

  // id: a setup.* command id from Commands.js.
  function run(id) {
    switch (id) {
      case "setup.up":
      case "setup.down":
        cursor = Commands.moveCursor(cursor, id === "setup.up" ? -1 : 1, Setup.STEPS.length)
        break
      case "setup.activate":
        var act = Setup.action(setup, current.id)
        if (act === "check") check()
        if (act === "confirm") setup = Setup.reduce(setup, { type: "confirm", id: current.id })
        if (act === "edit") {
          field.text = setup.server.syncFolder || home + "/"
          editing = true
          field.forceActiveFocus()
        }
        break
      case "setup.confirm":
        start(setup.confirm, Setup.runCommand(setup.confirm, { serverScript: serverScript, syncDir: syncDir, windowDir: Quickshell.shellDir }))
        break
      case "setup.cancel":
        if (editing) endEdit()
        else setup = Setup.reduce(setup, { type: "cancel" })
        break
      case "setup.commit":
        var c = Settings.commitFolder(field.text, home)
        if ("error" in c) {
          message = c.error
        } else {
          endEdit()
          folder = c.folder
          start("syncFolder", Setup.runCommand("syncFolder", { folder: folder }))
        }
        break
    }
  }

  Process {
    id: proc
    property string job: ""
    stdout: StdioCollector {
      id: output
      // Live text, so a long step such as the helper build shows progress.
      waitForEnd: false
      onStreamFinished: view.finished(proc.job, text)
    }
  }

  Column {
    anchors.fill: parent
    anchors.margins: view.theme.fontSize * 2
    spacing: view.theme.fontSize

    Text {
      text: "Miharchy needs these pieces. Nothing on the system changes until you confirm a step."
      color: view.theme.muted
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSize
    }

    Text {
      width: Math.min(parent.width, view.theme.fontSize * 60)
      visible: text !== ""
      wrapMode: Text.Wrap
      text: Setup.warning(view.setup)
      color: view.theme.urgent
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSize
    }

    Column {
      width: Math.min(parent.width, view.theme.fontSize * 60)

      Repeater {
        model: Setup.STEPS

        Rectangle {
          id: row
          required property var modelData
          required property int index
          readonly property bool current: index === view.cursor
          readonly property string status: Setup.status(view.setup, modelData.id).state
          width: parent.width
          height: view.theme.fontSize * 2.4
          color: current ? view.theme.selected : "transparent"

          MouseArea {
            anchors.fill: parent
            onClicked: view.point(row.index, false)
            onDoubleClicked: view.point(row.index, true)
          }

          Text {
            anchors.left: parent.left
            anchors.leftMargin: view.theme.fontSize * 0.75
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.StyledText
            text: "<font color='" + view.theme.muted + "'>" + (row.index + 1) + "</font> " + row.modelData.title
            color: row.current ? view.theme.selectedText : view.theme.foreground
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSize
          }

          Text {
            anchors.right: parent.right
            anchors.rightMargin: view.theme.fontSize * 0.75
            anchors.verticalCenter: parent.verticalCenter
            text: ({ todo: "to do", outdated: "out of date", unavailable: "no docker" })[row.status] || row.status
            color: row.status === "todo" || row.status === "outdated" ? view.theme.urgent : row.status === "done" ? view.theme.accent : view.theme.muted
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSize
          }
        }
      }
    }

    Column {
      width: Math.min(parent.width, view.theme.fontSize * 60)
      spacing: view.theme.fontSize * 0.5

      Text {
        width: parent.width
        wrapMode: Text.Wrap
        visible: text !== ""
        text: view.currentStatus.detail
        color: view.theme.foreground
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
      }

      Text {
        visible: view.current.kind === "install" && view.currentStatus.state === "todo"
        text: "$ " + (view.current.command || "")
        color: view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
      }

      Text {
        visible: view.confirming
        text: (view.current.prompt || "") + "  y run   n cancel"
        color: view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
      }

      TextInput {
        id: field
        width: parent.width
        visible: view.editing
        clip: true
        color: view.theme.selectedText
        selectionColor: view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
        Keys.onPressed: function(event) { view.key(event) }
      }

      Text {
        width: parent.width
        visible: text !== ""
        wrapMode: Text.Wrap
        text: view.message
        color: view.theme.urgent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }

      Text {
        width: parent.width
        visible: view.currentStatus.state === "running" && text !== ""
        text: output.text.replace(/\s+$/, "").split("\n").slice(-12).join("\n")
        color: view.theme.muted
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }

      Text {
        readonly property var result: view.setup.results[view.current.id] || null
        width: parent.width
        visible: result !== null && view.currentStatus.state !== "running"
        wrapMode: Text.Wrap
        text: result ? (result.code === 0 ? "" : "Failed with exit status " + result.code + ".\n") + result.output : ""
        color: result && result.code !== 0 ? view.theme.urgent : view.theme.muted
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }
    }
  }
}
