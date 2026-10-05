pragma ComponentBehavior: Bound

import QtQuick
import "Model.js" as Model
import "Trackers.js" as Trackers

// The tracking panel over a manga's detail: one row per tracker, its
// status, chapters read and score. It talks to the server itself;
// Trackers.js decides. shell.qml forwards every "track." command to run().
Rectangle {
  id: view

  required property Theme theme
  property var config: null
  property string configPath: ""
  // False once the manga detail closes, which closes the panel too.
  property bool active: false
  property var panel: null
  // Only the latest panel load may update it.
  property int loadSeq: 0

  readonly property bool open: panel !== null
  readonly property bool editing: open && (panel.mode === "query" || panel.mode === "progress")
  readonly property bool picking: open && panel.mode === "pick"
  readonly property var problem: open ? Model.problem(panel, configPath) : null
  readonly property string hint: !open ? ""
    : picking ? "j k move   enter choose   esc back   "
    : "j k trackers   enter find the manga   s status   c chapters   S score   x stop tracking   esc close   "

  signal key(var event)
  signal editEnded()

  visible: open
  color: Qt.alpha(theme.panel, 1)
  border.width: 1
  border.color: theme.panelBorder
  height: Math.min(parent.height - theme.fontSize * 4, body.implicitHeight + theme.fontSize * 2)

  onActiveChanged: if (!active) close()
  onConfigChanged: close()

  function send(payload, done) {
    var req = Model.request(config, payload)
    var xhr = new XMLHttpRequest()
    xhr.onreadystatechange = function() {
      if (xhr.readyState === XMLHttpRequest.DONE) done(Model.reply(xhr.status, xhr.responseText))
    }
    xhr.open("POST", req.url)
    xhr.setRequestHeader("Content-Type", "application/json")
    xhr.setRequestHeader("Authorization", req.authorization)
    xhr.send(req.body)
  }

  function show(manga) {
    if (!manga || !config) return
    panel = Trackers.panel(manga.id, manga.title)
    var seq = ++loadSeq
    send(Trackers.panelPayload(panel), function(reply) {
      if (seq === view.loadSeq && view.panel) view.panel = Trackers.act(view.panel, { type: "loaded", reply: reply }).panel
    })
  }

  function close() {
    loadSeq++
    if (editing) editEnded()
    panel = null
  }

  // A write's reply finds its row by tracker, so a move meanwhile is fine.
  function act(event) {
    var mangaId = panel.mangaId
    var row = panel.rows[panel.cursor]
    var r = Trackers.act(panel, event)
    panel = r.panel
    if (!r.payload) return
    var answer = r.panel.mode === "searching" ? "results" : "written"
    send(r.payload, function(reply) {
      if (!view.panel || view.panel.mangaId !== mangaId) return
      view.panel = Trackers.act(view.panel, { type: answer, trackerId: row.tracker.id, reply: reply }).panel
    })
  }

  function run(id) {
    switch (id) {
      case "track.close":
        close()
        break
      case "track.back":
        act({ type: "back" })
        break
      case "track.up":
      case "track.down":
        act({ type: "move", delta: id === "track.up" ? -1 : 1 })
        break
      case "track.search":
      case "track.status":
      case "track.score":
      case "track.chapters":
      case "track.unbind":
      case "track.choose":
        act({ type: id.slice(6) })
        break
      case "track.commit":
        act({ type: panel.mode === "query" ? "query" : "progress", text: field.text })
        if (!editing) editEnded()
        break
      case "track.cancel":
        act({ type: "back" })
        editEnded()
        break
    }
  }

  onEditingChanged: {
    if (!editing) return
    field.text = Trackers.fieldStart(panel)
    field.selectAll()
    field.forceActiveFocus()
  }

  Column {
    id: body
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.top: parent.top
    anchors.margins: view.theme.fontSize
    spacing: view.theme.fontSize * 0.5

    Text {
      width: parent.width
      elide: Text.ElideRight
      text: !view.open ? "" : view.picking ? ({ results: "Pick the manga", status: "Reading status", score: "Score" })[view.panel.pick.kind] : "Tracking"
      color: view.theme.accent
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }

    Text {
      width: parent.width
      wrapMode: Text.Wrap
      visible: text !== ""
      text: !view.open ? ""
        : view.problem ? view.problem.title + ". " + view.problem.detail
        : view.panel.state === "loading" ? "Loading"
        : view.panel.mode === "searching" ? "Searching"
        : view.panel.rows.length ? "" : "No tracker is logged in. Log in under Settings, Trackers."
      color: view.problem ? view.theme.urgent : view.theme.muted
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }

    Row {
      width: parent.width
      visible: view.editing
      spacing: view.theme.fontSize

      Text {
        id: prompt
        text: view.open && view.panel.mode === "progress" ? "Chapters read" : "Search"
        color: view.theme.muted
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
      }

      TextInput {
        id: field
        width: parent.width - prompt.width - parent.spacing
        clip: true
        color: view.theme.foreground
        selectionColor: view.theme.selected
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
        Keys.onPressed: function(event) { view.key(event) }
      }
    }

    Repeater {
      model: view.open && !view.picking ? view.panel.rows : []

      Rectangle {
        id: row
        required property var modelData
        required property int index
        readonly property bool current: index === view.panel.cursor
        width: body.width
        height: view.theme.fontSize * 3.6
        color: current ? view.theme.selected : "transparent"

        Column {
          anchors.left: parent.left
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          anchors.leftMargin: view.theme.fontSize * 0.5
          anchors.rightMargin: view.theme.fontSize * 0.5

          Item {
            width: parent.width
            height: name.implicitHeight

            Text {
              id: name
              text: row.modelData.tracker.name
              color: row.current ? view.theme.selectedText : view.theme.foreground
              font.family: view.theme.fontFamily
              font.pixelSize: view.theme.fontSize
            }

            Text {
              anchors.left: name.right
              anchors.leftMargin: view.theme.fontSize
              anchors.right: parent.right
              horizontalAlignment: Text.AlignRight
              elide: Text.ElideLeft
              text: Trackers.summary(row.modelData)
              color: row.current ? view.theme.selectedText : view.theme.muted
              font.family: view.theme.fontFamily
              font.pixelSize: view.theme.fontSmall
            }
          }

          Text {
            width: parent.width
            elide: Text.ElideRight
            text: row.modelData.record ? row.modelData.record.title : ""
            color: row.current ? view.theme.selectedText : view.theme.muted
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSmall
          }
        }
      }
    }

    ListView {
      id: pickList
      width: parent.width
      height: Math.min(contentHeight, view.theme.fontSize * 2.2 * 12)
      visible: view.picking
      clip: true
      model: view.picking ? view.panel.pick.items : []
      currentIndex: view.picking ? view.panel.pick.cursor : -1
      onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)

      delegate: Rectangle {
        id: item
        required property var modelData
        required property int index
        readonly property bool current: index === view.panel.pick.cursor
        width: pickList.width
        height: view.theme.fontSize * 2.2
        color: current ? view.theme.selected : "transparent"

        Text {
          id: label
          anchors.left: parent.left
          anchors.leftMargin: view.theme.fontSize * 0.5
          anchors.right: detail.left
          anchors.rightMargin: view.theme.fontSize
          anchors.verticalCenter: parent.verticalCenter
          elide: Text.ElideRight
          text: item.modelData.label
          color: item.current ? view.theme.selectedText : view.theme.foreground
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize
        }

        Text {
          id: detail
          anchors.right: parent.right
          anchors.rightMargin: view.theme.fontSize * 0.5
          anchors.verticalCenter: parent.verticalCenter
          text: item.modelData.detail
          color: view.theme.muted
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSmall
        }
      }
    }

    Text {
      width: parent.width
      wrapMode: Text.Wrap
      visible: text !== ""
      text: !view.open ? "" : view.panel.busy ? "saving" : view.panel.error
      color: view.open && view.panel.busy ? view.theme.muted : view.theme.urgent
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }
  }
}
