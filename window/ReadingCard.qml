pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Shapes
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

      // icons/miharchy.svg in the theme's colors: the burst in the accent, the
      // cross in the foreground. Paths from icons/mark.py (the full mark).
      Shape {
        width: 40
        height: 40
        preferredRendererType: Shape.CurveRenderer
        transform: Scale { xScale: 40 / 48; yScale: 40 / 48 }
        ShapePath {
          fillColor: view.theme.accent
          fillRule: ShapePath.WindingFill
          strokeColor: "transparent"
          strokeWidth: 0
          PathSvg { path: "M13.2 16.4 L13.5 16.0 L14.7 14.7 L16.0 13.5 L16.4 13.2 L16.4 16.4Z M16.4 12.6 L12.7 7.0 L13.3 6.7 L13.8 6.3 L14.4 6.0 L14.9 5.7 L16.4 8.7Z M15.4 16.4 L8.7 10.5 L9.1 10.0 L9.6 9.6 L10.0 9.1 L10.5 8.7 L16.4 15.4 L16.4 16.4Z M8.7 16.4 L5.7 14.9 L6.0 14.4 L6.3 13.8 L6.7 13.3 L7.0 12.7 L12.6 16.4Z M31.6 13.2 L32.0 13.5 L33.3 14.7 L34.5 16.0 L34.8 16.4 L31.6 16.4Z M35.4 16.4 L41.0 12.7 L41.3 13.3 L41.7 13.8 L42.0 14.4 L42.3 14.9 L39.3 16.4Z M31.6 15.4 L37.5 8.7 L38.0 9.1 L38.4 9.6 L38.9 10.0 L39.3 10.5 L32.6 16.4 L31.6 16.4Z M31.6 8.7 L33.1 5.7 L33.6 6.0 L34.2 6.3 L34.7 6.7 L35.3 7.0 L31.6 12.6Z M34.8 31.6 L34.5 32.0 L33.3 33.3 L32.0 34.5 L31.6 34.8 L31.6 31.6Z M31.6 35.4 L35.3 41.0 L34.7 41.3 L34.2 41.7 L33.6 42.0 L33.1 42.3 L31.6 39.3Z M32.6 31.6 L39.3 37.5 L38.9 38.0 L38.4 38.4 L38.0 38.9 L37.5 39.3 L31.6 32.6 L31.6 31.6Z M39.3 31.6 L42.3 33.1 L42.0 33.6 L41.7 34.2 L41.3 34.7 L41.0 35.3 L35.4 31.6Z M16.4 34.8 L16.0 34.5 L14.7 33.3 L13.5 32.0 L13.2 31.6 L16.4 31.6Z M12.6 31.6 L7.0 35.3 L6.7 34.7 L6.3 34.2 L6.0 33.6 L5.7 33.1 L8.7 31.6Z M16.4 32.6 L10.5 39.3 L10.0 38.9 L9.6 38.4 L9.1 38.0 L8.7 37.5 L15.4 31.6 L16.4 31.6Z M16.4 39.3 L14.9 42.3 L14.4 42.0 L13.8 41.7 L13.3 41.3 L12.7 41.0 L16.4 35.4Z" }
        }
        ShapePath {
          fillColor: view.theme.foreground
          strokeColor: "transparent"
          strokeWidth: 0
          PathSvg { path: "M17.4 3H30.6V17.4H45V30.6H30.6V45H17.4V30.6H3V17.4H17.4Z" }
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
