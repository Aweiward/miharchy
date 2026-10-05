pragma ComponentBehavior: Bound

import QtQuick
import "Model.js" as Model
import "Downloads.js" as Downloads

// The download queue over the whole window, and the poll behind it. The
// window has no WebSocket module for Suwayomi's downloadStatusChanged
// subscription, so it asks for the status each second while the overlay
// shows or anything waits in the queue. Downloads.js decides; shell.qml
// forwards every "downloads." command to run().
Rectangle {
  id: view

  required property Theme theme
  property var config: null
  property string configPath: ""
  property bool open: false
  property var queue: Downloads.initial()
  property int cursor: 0
  // Only the latest request may update the queue.
  property int seq: 0

  readonly property var problem: Model.problem(queue, configPath)
  readonly property string hint: "j k move   x take out   space " + (queue.running ? "pause" : "start") + "   esc close"

  // Items gone from the queue since the last reply: finished or taken out.
  signal leftQueue(var items)
  // A click on a key in the hint sends that key, as typed.
  signal key(var event)

  visible: open
  color: theme.background

  onConfigChanged: {
    seq++
    queue = Downloads.initial()
    if (config) poll()
  }

  // Any reply that carries the download status: a poll's, or a mutation's
  // sent from here or from the manga detail.
  function apply(reply) {
    var next = Downloads.reduce(queue, { type: "reply", reply: reply })
    var gone = Downloads.left(queue.items, next.items)
    queue = next
    cursor = Math.max(0, Math.min(cursor, queue.items.length - 1))
    if (gone.length) leftQueue(gone)
  }

  function send(payload) {
    if (!config) return
    var req = Model.request(config, payload)
    var s = ++seq
    var xhr = new XMLHttpRequest()
    xhr.onreadystatechange = function() {
      if (xhr.readyState === XMLHttpRequest.DONE && s === view.seq) view.apply(Model.reply(xhr.status, xhr.responseText))
    }
    xhr.open("POST", req.url)
    xhr.setRequestHeader("Content-Type", "application/json")
    xhr.setRequestHeader("Authorization", req.authorization)
    xhr.send(req.body)
  }

  function poll() {
    send({ query: Downloads.STATUS_QUERY })
  }

  function run(id) {
    var item = queue.items[cursor]
    switch (id) {
      case "downloads.open":
        open = true
        poll()
        break
      case "downloads.close":
        open = false
        break
      case "downloads.up":
      case "downloads.down":
        cursor = Math.max(0, Math.min(queue.items.length - 1, cursor + (id === "downloads.up" ? -1 : 1)))
        break
      case "downloads.dequeue":
        if (item) send(Downloads.dequeuePayload(item.chapterId))
        break
      case "downloads.toggle":
        send(Downloads.togglePayload(queue))
        break
    }
  }

  Timer {
    interval: 1000
    repeat: true
    running: view.config !== null && Downloads.polling(view.queue, view.open)
    onTriggered: view.poll()
  }

  // Over the whole window: a click never reaches the view below.
  MouseArea {
    anchors.fill: parent
  }

  Text {
    id: title
    anchors.top: parent.top
    anchors.left: parent.left
    anchors.margins: view.theme.fontSize * 2
    text: "Download queue"
    color: view.theme.accent
    font.family: view.theme.fontFamily
    font.pixelSize: view.theme.fontHeading
  }

  Text {
    anchors.right: parent.right
    anchors.baseline: title.baseline
    anchors.rightMargin: view.theme.fontSize * 2
    text: !view.queue.items.length ? "" : view.queue.items.length + " chapters   " + (view.queue.running ? "downloading" : "paused")
    color: view.theme.muted
    font.family: view.theme.fontFamily
    font.pixelSize: view.theme.fontSmall
  }

  ListView {
    id: list
    anchors.top: title.bottom
    anchors.bottom: hintText.top
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    clip: true
    model: view.queue.items
    currentIndex: view.cursor

    delegate: Rectangle {
      id: row
      required property var modelData
      required property int index
      readonly property bool current: index === view.cursor
      width: list.width
      height: view.theme.fontSize * 2.4
      color: current ? view.theme.selected : "transparent"

      // The queue has no Enter, so a double click only moves the cursor.
      MouseArea {
        anchors.fill: parent
        onClicked: view.cursor = row.index
      }

      Text {
        anchors.left: parent.left
        anchors.leftMargin: view.theme.fontSize * 0.5
        anchors.right: progressLabel.left
        anchors.rightMargin: view.theme.fontSize
        anchors.verticalCenter: parent.verticalCenter
        elide: Text.ElideRight
        text: row.modelData.manga + "   " + row.modelData.chapter
        color: row.current ? view.theme.selectedText : view.theme.foreground
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
      }

      Text {
        id: progressLabel
        anchors.right: parent.right
        anchors.rightMargin: view.theme.fontSize * 0.5
        anchors.verticalCenter: parent.verticalCenter
        text: Downloads.progressText(row.modelData)
        color: row.modelData.state === "ERROR" ? view.theme.urgent : row.current ? view.theme.selectedText : view.theme.muted
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }

      Rectangle {
        anchors.left: parent.left
        anchors.bottom: parent.bottom
        width: parent.width * row.modelData.progress
        height: 2
        visible: row.modelData.state === "DOWNLOADING"
        color: view.theme.accent
      }
    }
  }

  Text {
    anchors.centerIn: list
    width: list.width
    horizontalAlignment: Text.AlignHCenter
    wrapMode: Text.Wrap
    visible: !view.queue.items.length
    text: view.problem ? view.problem.title + ". " + view.problem.detail : view.queue.state === "loading" ? "Loading the queue" : "Nothing to download. Press d on a chapter to queue it."
    color: view.problem ? view.theme.urgent : view.theme.muted
    font.family: view.theme.fontFamily
    font.pixelSize: view.theme.fontSize
  }

  HintBar {
    id: hintText
    anchors.bottom: parent.bottom
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    theme: view.theme
    text: view.hint
    onKey: function(event) { view.key(event) }
  }
}
