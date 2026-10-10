pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model
import "Session.js" as Session
import "Reader.js" as Reader
import "ReadingCard.js" as ReadingCard

// The reading card over the window: c on History or the palette. It pages
// History's chapters itself; ReadingCard.js decides. S saves the card at 2x
// into the "Save pages to" folder, Y copies it, as the reader's page
// actions; h hides the covers, remembered in global meta.
Rectangle {
  id: view

  required property Theme theme
  property var config: null
  property string configPath: ""
  // The "Save pages to" setting; empty for ~/Pictures/Miharchy.
  property string folder: ""
  property bool open: false

  // "loading" | "ok" | a failed connection state.
  property string phase: "loading"
  property string message: ""
  property var rows: []
  property var card: null
  property real now: 0
  property string note: ""
  // The S or Y that waits for the covers to load.
  property string pending: ""
  // Only the latest load may set the card.
  property int seq: 0

  readonly property bool coversShown: prefs.values.readingCardCovers !== "hidden"
  readonly property string grabFile: Quickshell.env("XDG_RUNTIME_DIR") + "/miharchy-reading-card.png"
  readonly property var problem: Model.problem({ state: phase, message: message }, configPath)
  readonly property string hint: "S save   Y copy   h " + (coversShown ? "hide" : "show") + " covers   esc close"

  // A click on a key in the hint sends that key, as typed.
  signal key(var event)

  visible: open
  color: theme.scrim

  // The window's views stay out of reach while the card shows.
  MouseArea { anchors.fill: parent }

  PrefStore {
    id: prefs
    config: view.config
    table: ReadingCard.PREFS
    onConfigChanged: load()
  }

  function run(id) {
    switch (id) {
      case "readingCard.open":
        open = true
        note = ""
        load()
        break
      case "readingCard.close":
        open = false
        pending = ""
        break
      case "readingCard.covers":
        prefs.set([{ key: "readingCardCovers", value: coversShown ? "hidden" : "shown" }])
        break
      case "readingCard.save":
      case "readingCard.copy":
        if (!card) {
          note = "The card has not loaded yet"
          break
        }
        pending = id
        note = ""
        waitTimer.restart()
        flush()
        break
    }
  }

  function load() {
    if (!config) {
      phase = "no-config"
      return
    }
    var s = ++seq
    now = Date.now() / 1000
    phase = "loading"
    rows = []
    card = null
    page(null, s)
  }

  function page(after, s) {
    Session.send(config, ReadingCard.payload(after), function(reply) {
      if (s !== view.seq) return
      if (reply.state !== "ok") {
        view.message = reply.message || ""
        view.phase = reply.state
        return
      }
      view.rows = view.rows.concat(ReadingCard.rows(reply.data))
      var info = reply.data.chapters.pageInfo
      if (ReadingCard.more(view.rows, info, view.now)) return view.page(info.endCursor, s)
      view.card = ReadingCard.card(view.rows, view.now, view.config)
      view.phase = "ok"
    })
  }

  function coversLoaded() {
    for (var i = 0; i < covers.count; i++) {
      var image = covers.itemAt(i) as ServerImage
      if (image && image.status !== Image.Ready && !image.failed) return false
    }
    return true
  }

  // Runs the waiting S or Y once the covers loaded, or after waitTimer
  // gives up on them.
  function flush(force) {
    if (!pending || pageProcess.running || !(force || !coversShown || coversLoaded())) return
    var id = pending
    pending = ""
    waitTimer.stop()
    face.grabToImage(function(result) {
      if (!result.saveToFile(view.grabFile)) {
        view.note = "Could not draw the card"
        return
      }
      if (id === "readingCard.save") {
        var target = ReadingCard.target(view.folder, Quickshell.env("HOME"), view.now)
        pageProcess.done = "Saved to " + target.dir + "/" + target.name
        pageProcess.failed = "Saving failed"
        pageProcess.command = Reader.saveCommand(view.grabFile, target)
      } else {
        pageProcess.done = "Card copied"
        pageProcess.failed = "Copying failed"
        pageProcess.command = Reader.copyCommand(view.grabFile, "image/png")
      }
      pageProcess.running = true
    }, Qt.size(face.width * 2, face.height * 2))
  }

  Timer {
    id: waitTimer
    interval: 10000
    onTriggered: view.flush(true)
  }

  Process {
    id: pageProcess
    property string done: ""
    property string failed: ""
    stdout: StdioCollector {
      onStreamFinished: view.note = Reader.pageResult(text, pageProcess.done, pageProcess.failed)
    }
  }

  // The card at its own size, 1200 x 675, scaled down to fit the window.
  // The grab takes it unscaled.
  Rectangle {
    id: face
    width: 1200
    height: 675
    anchors.centerIn: parent
    anchors.verticalCenterOffset: -view.theme.fontSize * 1.5
    scale: Math.min(1, (view.width - view.theme.fontSize * 4) / width, (view.height - view.theme.fontSize * 8) / height)
    color: view.theme.background
    border.width: 1
    border.color: view.theme.panelBorder

    Row {
      id: brand
      x: 64
      y: 56
      spacing: 16

      // icons/miharchy.svg in the theme's colors: rays in the accent, the
      // M in the foreground.
      Item {
        width: 40
        height: 40
        Repeater {
          model: [[1, 5, 12, 4, 1], [1, 11, 12, 4, 1], [1, 33, 12, 4, 1], [1, 39, 12, 4, 1], [35, 5, 12, 4, 1], [35, 11, 12, 4, 1], [35, 33, 12, 4, 1], [35, 39, 12, 4, 1], [15, 3, 18, 42, 0], [2, 18, 44, 12, 0]]
          Rectangle {
            required property var modelData
            x: modelData[0] * 40 / 48
            y: modelData[1] * 40 / 48
            width: modelData[2] * 40 / 48
            height: modelData[3] * 40 / 48
            color: modelData[4] ? view.theme.accent : view.theme.foreground
          }
        }
      }

      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: "Miharchy"
        color: view.theme.foreground
        font.family: view.theme.fontFamily
        font.pixelSize: 28
      }
    }

    Text {
      anchors.right: parent.right
      anchors.rightMargin: 64
      anchors.verticalCenter: brand.verticalCenter
      text: view.card ? view.card.range : ""
      color: view.theme.muted
      font.family: view.theme.fontFamily
      font.pixelSize: 24
    }

    // The body: one band centered under the header. With covers, the
    // numbers column and the covers share its top and bottom; without, the
    // numbers stand in one row.
    Item {
      id: band
      x: 64
      width: parent.width - 128
      height: view.coversShown ? 336 : numbers.implicitHeight
      y: brand.y + brand.height + (parent.height - brand.y - brand.height - height) / 2
      visible: view.card !== null

      Grid {
        id: numbers
        columns: view.coversShown ? 1 : 3
        columnSpacing: 96

        Repeater {
          model: view.card ? [
            [view.card.chapters, (view.card.chapters === 1 ? "chapter" : "chapters") + ", last 7 days"],
            [view.card.inProgress, "manga in progress"],
            [view.card.streak, "day streak"]
          ] : []

          Column {
            required property var modelData
            height: view.coversShown ? band.height / 3 : implicitHeight
            Text {
              text: String(parent.modelData[0])
              color: view.theme.accent
              font.family: view.theme.fontFamily
              font.pixelSize: view.coversShown ? 64 : 104
              font.bold: true
            }
            Text {
              text: parent.modelData[1]
              color: view.theme.muted
              font.family: view.theme.fontFamily
              font.pixelSize: view.coversShown ? 22 : 28
            }
          }
        }
      }

      Row {
        anchors.right: parent.right
        height: parent.height
        spacing: 20
        visible: view.coversShown

        Repeater {
          id: covers
          model: view.card ? view.card.covers : []

          ServerImage {
            required property var modelData
            width: height / 1.5
            height: band.height
            config: view.config
            url: modelData
            fillMode: Image.PreserveAspectCrop
            sourceSize.width: width * 2
            sourceSize.height: height * 2
            onStatusChanged: view.flush()
            onFailedChanged: view.flush()
          }
        }
      }
    }

    Text {
      x: 64
      anchors.bottom: parent.bottom
      anchors.bottomMargin: 48
      visible: text !== ""
      text: view.card ? view.card.line : view.problem ? view.problem.title : "Reading the history"
      color: view.problem ? view.theme.urgent : view.theme.foreground
      font.family: view.theme.fontFamily
      font.pixelSize: 26
    }
  }

  Column {
    anchors.top: face.verticalCenter
    anchors.topMargin: face.height * face.scale / 2 + view.theme.fontSize
    anchors.horizontalCenter: parent.horizontalCenter
    spacing: view.theme.fontSize * 0.5

    HintBar {
      anchors.horizontalCenter: parent.horizontalCenter
      theme: view.theme
      text: view.hint
      onKey: function(event) { view.key(event) }
    }

    Text {
      anchors.horizontalCenter: parent.horizontalCenter
      visible: text !== ""
      text: view.pending ? "Waiting for the covers" : view.note
      color: view.theme.foreground
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }
  }
}
