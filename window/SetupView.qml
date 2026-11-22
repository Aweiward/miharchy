pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import "Setup.js" as Setup
import "Settings.js" as Settings
import "Session.js" as Session
import "Commands.js" as Commands
import "Runtime.js" as Runtime
import "Storage.js" as Storage

// The setup screen: one row per Setup.steps() entry. It owns the one Process
// that runs checks and confirmed steps, and sends its own server reads and
// writes. The window's dispatcher hands it keys through run().
Item {
  id: view

  required property Theme theme
  // Setup's server reads and writes: core's config.
  property var config: null
  // Suwayomi's server.json: the probe checks it, and the move reads it.
  property string configPath: ""
  property string home: ""
  property string backend: ""
  readonly property bool core: backend === "core"
  property string coreConfigPath: ""

  property var setup: Setup.initial(core)
  property int cursor: 0
  property bool editing: false
  property string message: ""
  readonly property bool confirming: setup.confirm !== null
  // The folder waiting on its existence check.
  property string folder: ""
  property bool checked: false
  property bool offered: false
  // Setup.offersOnStart() for this window.
  property bool offers: true
  // The window runs from the repo's window/, beside server/ and sync/.
  readonly property var steps: Setup.steps(setup)
  readonly property var current: steps[cursor]
  readonly property var currentStatus: Setup.status(setup, current.id)

  signal key(var event)
  // The first check found a required step not done.
  signal needed()
  // A step changed the server's config or settings.
  signal wrote()
  // The move filled core's library and settings.
  signal moved()
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
    if (!setup.job) start("probe", Setup.probeCommand(configPath, "", Quickshell.shellDir, false, coreConfigPath))
  }

  function post(payload, done) {
    return Session.send(config, payload, done)
  }

  function readServer() {
    if (!config) return
    post(Setup.serverPayload(core), function(reply) {
      view.setup = Setup.reduce(view.setup, { type: "server", reply: reply })
      view.checkPhones()
      view.offer()
    })
    // A move core runs goes on while the window is closed: read where it stands.
    readMove()
  }

  function readMove() {
    if (!config) return
    post(Setup.MOVE_STATUS, function(reply) {
      var was = view.setup.move && view.setup.move.state
      view.setup = Setup.reduce(view.setup, { type: "move", reply: reply })
      if (was !== "running" || view.setup.move.state === "running") return
      // The move wrote core's metas (the sync folder too) and library.
      if (view.setup.move.state === "done") view.moved()
      view.check()
    })
  }

  function startMove() {
    setup = Setup.reduce(setup, { type: "start", id: "move" })
    if (!config) return setup = Setup.reduce(setup, { type: "move", reply: { state: "no-config", message: "" } })
    post(Setup.movePayload({
      serverConfig: configPath,
      serverRoot: Storage.root({ HOME: home, MIHARCHY_SERVER_ROOT: Quickshell.env("MIHARCHY_SERVER_ROOT") }),
      home: home
    }), function(reply) {
      view.setup = Setup.reduce(view.setup, { type: "move", reply: reply })
    })
  }

  // Core runs the move as a job: follow it until it ends.
  Timer {
    interval: 1000
    repeat: true
    running: !!view.setup.move && view.setup.move.state === "running"
    onTriggered: view.readMove()
  }

  // Core does not answer yet, as right after its unit starts: read again.
  Timer {
    interval: 3000
    repeat: true
    running: view.visible && !!view.setup.move && view.setup.move.state === "unknown"
    onTriggered: view.readServer()
  }

  // The sync folder lives in server meta, so the phone check follows the
  // server reply; the offer waits for it (Setup.offers). Never over a y/n
  // prompt or the folder field: a job start would clear them.
  function checkPhones() {
    if (!setup.job && !setup.confirm && !editing && setup.server && setup.server.syncFolder) start("phones", Setup.phoneProbeCommand(setup.server.syncFolder))
  }

  // Where Syncthing stands, while no phone backup has landed: the step's text,
  // its y and the QR code of this desktop's ID follow from it. With no
  // runtime folder (Runtime.js) the ID shows as text only.
  function checkSyncthing() {
    var p = setup.phones
    if (setup.job || setup.confirm || editing || !p || p.count || p.autobackup) return
    start("syncthing", Setup.syncthingProbeCommand(setup.server.syncFolder, Runtime.folder() ? Runtime.folder() + "/syncthing-id.png" : ""))
  }

  // The install terminal returns at once: check again until the packages are in.
  Timer {
    interval: 5000
    repeat: true
    running: view.visible && Setup.installing(view.setup)
    onTriggered: if (!view.setup.confirm && !view.editing) view.check()
  }

  // A phone backup lands while Setup is open: check again on our own. Also
  // while still checking, in case the first check was skipped over a prompt.
  Timer {
    interval: 15000
    repeat: true
    running: view.visible && ["todo", "checking"].indexOf(Setup.status(view.setup, "phoneBackups").state) !== -1
    onTriggered: view.checkPhones()
  }

  // Once a session: open on optional steps the user has not been shown, then
  // record them so a skipped step stays quiet until it changes.
  function offer() {
    if (offered || !offers || !Setup.unoffered(setup).length) return
    offered = true
    needed()
    post(Setup.offerPayload(setup), function() {})
  }

  function finished(id, text) {
    setup = Setup.reduce(setup, { type: "finish", id: id, text: text })
    if (id === "phones") {
      checkSyncthing()
      return offer()
    }
    if (id === "syncthing") return
    if (id === "probe") {
      readServer()
      if (checked) return
      checked = true
      cursor = Setup.next(setup)
      if (Setup.incomplete(setup)) needed()
      return
    }
    var save = Setup.savePayload(id, setup.results[id], folder, core)
    if (save) {
      post(save, function(reply) {
        if (reply.state !== "ok") view.message = "Saving to the server failed: " + (reply.message || reply.state) + "."
        view.wrote()
        view.readServer()
      })
    }
    if (id === "coreService") wrote()
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
        cursor = Commands.moveCursor(cursor, id === "setup.up" ? -1 : 1, steps.length)
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
        if (setup.confirm === "move") return startMove()
        start(setup.confirm, Setup.runCommand(setup.confirm, { windowDir: Quickshell.shellDir, coreConfigPath: coreConfigPath, folder: setup.server ? setup.server.syncFolder : "", pair: Setup.pairing(setup), install: Setup.status(setup, setup.confirm).command || "" }))
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
      // Live text, so a long step such as the core build shows progress.
      waitForEnd: false
      onStreamFinished: view.finished(proc.job, text)
    }
  }

  Column {
    anchors.fill: parent
    anchors.margins: view.theme.fontSize * 2
    spacing: view.theme.fontSize

    Text {
      textFormat: Text.PlainText
      text: "Miharchy needs these pieces. Nothing on the system changes until you confirm a step."
      color: view.theme.muted
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSize
    }

    Column {
      width: Math.min(parent.width, view.theme.fontSize * 60)

      Repeater {
        model: view.steps

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
            // Styled for the number's color; Setup.STEPS titles are constant text.
            textFormat: Text.StyledText
            text: "<font color='" + view.theme.muted + "'>" + (row.index + 1) + "</font> " + row.modelData.title
            color: row.current ? view.theme.selectedText : view.theme.foreground
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSize
          }

          Text {
            textFormat: Text.PlainText
            anchors.right: parent.right
            anchors.rightMargin: view.theme.fontSize * 0.75
            anchors.verticalCenter: parent.verticalCenter
            text: Setup.status(view.setup, row.modelData.id).label || ({ todo: "to do", outdated: "out of date", unavailable: "no docker" })[row.status] || row.status
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
        textFormat: Text.PlainText
        width: parent.width
        wrapMode: Text.Wrap
        visible: text !== ""
        text: view.currentStatus.detail
        color: view.theme.foreground
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
      }

      // This desktop's Syncthing ID, for the phone to scan.
      Image {
        visible: !!view.currentStatus.qr
        source: view.currentStatus.qr ? "file://" + view.currentStatus.qr : ""
        cache: false
        smooth: false
        width: view.theme.fontSize * 12
        height: width
        fillMode: Image.PreserveAspectFit
      }

      Text {
        textFormat: Text.PlainText
        visible: !!view.currentStatus.command && view.currentStatus.state === "todo"
        text: "$ " + (view.currentStatus.command || "")
        color: view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
      }

      Text {
        textFormat: Text.PlainText
        visible: view.confirming
        text: (view.currentStatus.prompt || view.current.prompt || "") + "  y run   n cancel"
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
        textFormat: Text.PlainText
        width: parent.width
        visible: text !== ""
        wrapMode: Text.Wrap
        text: view.message
        color: view.theme.urgent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }

      Text {
        textFormat: Text.PlainText
        width: parent.width
        // The running shell job's output; core runs the move, so it has none here.
        visible: view.currentStatus.state === "running" && view.current.id === proc.job && proc.running && text !== ""
        text: output.text.replace(/\s+$/, "").split("\n").slice(-12).join("\n")
        color: view.theme.muted
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }

      Text {
        textFormat: Text.PlainText
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
