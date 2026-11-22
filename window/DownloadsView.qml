pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import "Model.js" as Model
import "Session.js" as Session
import "Downloads.js" as Downloads
import "Failure.js" as Failure
import "NextChapters.js" as NextChapters

// The download queue over the whole window, kept live by miharchy-core's
// "downloads" topic while the overlay shows or anything waits in the queue. Downloads.js decides; shell.qml forwards every
// "downloads." command to run(). The last next-chapters run (NextChapters.js)
// shows as a summary line above the queue, at cursor -1.
Rectangle {
  id: view

  required property Theme theme
  property var config: null
  property string configPath: ""
  // Set by shell.qml: the queue is miharchy-core's.
  property bool open: false
  property var queue: Downloads.initial()
  property int cursor: 0
  // Only the latest request may update the queue.
  property int seq: 0
  // Why each failed download failed (Downloads.failed).
  property var reasons: ({})
  // The server's flareSolverrEnabled. Unused: core's failure reasons carry
  // no hint. shell.qml still sets it.
  property bool flareOn: false
  // nextChapters.lastRun; what the queue has shown of it (NextChapters.track),
  // and whether its end has notified.
  property var lastRun: null
  property var marks: ({})
  property bool notified: false
  // A settlePayload request is out.
  property bool settling: false
  readonly property bool summaryShown: NextChapters.shown(lastRun)
  readonly property var tally: lastRun ? NextChapters.tally(lastRun, queue.items, marks) : null

  readonly property var problem: Model.problem(queue, configPath)
  // The first X arms "cancel all"; shell.qml disarms it on any other key.
  property bool armed: false
  readonly property string hint: armed ? "X again to cancel every download, any other key keeps them"
    : "j k move   J K reorder   t top   b bottom   n sort by number   u sort by upload date   x take out   r retry   X cancel all   space " + (queue.running ? "pause" : "start") + "   esc close"

  // Items gone from the queue since the last reply: finished or taken out.
  signal leftQueue(var items)
  // A click on a key in the hint sends that key, as typed.
  signal key(var event)

  visible: open
  color: theme.background

  // The first look at the queue; the subscription takes over once the
  // overlay opens or a download waits.
  onConfigChanged: {
    seq++
    queue = Downloads.initial()
    reasons = {}
    if (!config) queue = { state: "no-config", message: "", running: false, items: [] }
    send(Downloads.statusPayload())
  }
  // A missing core.json leaves config null from the start, so onConfigChanged never fires.
  Component.onCompleted: if (!config) queue = { state: "no-config", message: "", running: false, items: [] }

  onLastRunChanged: {
    if (lastRun && lastRun.state === "refreshing") {
      marks = {}
      notified = false
    }
    follow()
  }

  function update(event) {
    var next = Downloads.reduce(queue, event)
    var gone = Downloads.left(queue.items, next.items)
    queue = next
    cursor = Math.max(summaryShown ? -1 : 0, Math.min(cursor, queue.items.length - 1))
    reasons = Downloads.failed(queue.items, reasons).reasons
    follow()
    settleGone(NextChapters.goneIds(lastRun, gone))
    if (gone.length) leftQueue(gone)
  }

  // A run chapter that left the queue is on disk or taken out.
  function settleGone(ids) {
    if (!ids.length || !config) return
    var run = lastRun
    Session.send(config, { route: "chapter.list", body: { ids: ids } }, function(reply) {
      if (reply.state === "ok" && run === view.lastRun) view.marks = NextChapters.goneMarks(view.marks, reply.data.chapters)
    })
  }

  function follow() {
    if (!lastRun) return
    marks = NextChapters.track(marks, lastRun, queue.items, [])
    if (!notified && NextChapters.looksOver(lastRun, queue.items)) settle()
  }

  // The server decides the end (NextChapters.settle), once per run: a
  // retry after it shows in the summary line only.
  function settle() {
    if (settling || !config) return
    settling = true
    var run = lastRun
    var cfg = config
    NextChapters.settleLoad(function(payload, done) { Session.send(cfg, payload, done) }, run, function(reply) {
      view.settling = false
      if (reply.state !== "ok" || run !== view.lastRun || view.notified) return
      view.marks = NextChapters.settle(view.marks, run, view.queue.items, reply.data)
      if (!NextChapters.ended(run, view.tally)) return
      view.notified = true
      var command = NextChapters.notifyCommand(run, view.tally)
      if (command) Quickshell.execDetached(command)
    })
  }

  // A retried chapter loses its reason, so its next failure is labelled again.
  function retry(chapterIds) {
    var payload = Downloads.retryPayload(chapterIds)
    if (!payload) return
    var r = Object.assign({}, reasons)
    chapterIds.forEach(function(id) { delete r[id] })
    reasons = r
    send(payload)
  }

  // Any reply that carries the download status: the first look's, or a
  // route's reply, sent from here or from the manga detail. While the
  // topic runs it carries every change, and a reply's status can be
  // older than its last result, so the reply is left out.
  function apply(reply) {
    if (!live.subscribed) update({ type: "reply", reply: reply })
  }

  function send(payload) {
    if (!config) return
    var s = ++seq
    Session.send(config, payload, function(reply) {
      if (s === view.seq) view.apply(reply)
    })
  }

  // The cursor stays on its download wherever the new order puts it.
  function reorder(order) {
    var item = queue.items[cursor]
    var payload = Downloads.orderPayload(queue, order)
    if (!payload) return
    cursor = order.indexOf(item.chapterId)
    send(payload)
  }

  function run(id) {
    var item = queue.items[cursor]
    switch (id) {
      case "downloads.open":
        open = true
        break
      case "downloads.close":
        open = false
        break
      case "downloads.up":
      case "downloads.down":
        cursor = Math.max(summaryShown ? -1 : 0, Math.min(queue.items.length - 1, cursor + (id === "downloads.up" ? -1 : 1)))
        break
      case "downloads.retry":
        retry(cursor === -1 && tally ? tally.failed : item && item.state === "ERROR" ? [item.chapterId] : [])
        break
      case "downloads.moveUp":
      case "downloads.moveDown":
      case "downloads.top":
      case "downloads.bottom":
        if (item) reorder(Downloads.moved(queue, cursor, { "downloads.moveUp": cursor - 1, "downloads.moveDown": cursor + 1, "downloads.top": 0, "downloads.bottom": queue.items.length }[id]))
        break
      case "downloads.sortNumber":
      case "downloads.sortDate":
        reorder(Downloads.sorted(queue, id === "downloads.sortNumber" ? "chapterNumber" : "uploadDate"))
        break
      case "downloads.clear":
        if (armed) send(Downloads.clearPayload())
        armed = !armed && queue.items.length > 0
        break
      case "downloads.dequeue":
        if (item) send(Downloads.dequeuePayload(item.chapterId))
        break
      case "downloads.toggle":
        send(Downloads.togglePayload(queue))
        break
    }
  }

  // Every result of the topic holds the whole queue.
  LiveSocket {
    id: live
    config: view.config
    topic: "downloads"
    running: view.config !== null && Downloads.live(view.queue, view.open)
    onResult: function(data) { view.update({ type: "live", data: data }) }
  }

  // Over the whole window: a click never reaches the view below.
  MouseArea {
    anchors.fill: parent
  }

  Text {
    id: title
    textFormat: Text.PlainText
    anchors.top: parent.top
    anchors.left: parent.left
    anchors.margins: view.theme.fontSize * 2
    text: "Download queue"
    color: view.theme.accent
    font.family: view.theme.fontFamily
    font.pixelSize: view.theme.fontHeading
  }

  Text {
    textFormat: Text.PlainText
    anchors.right: parent.right
    anchors.baseline: title.baseline
    anchors.rightMargin: view.theme.fontSize * 2
    text: !view.queue.items.length ? "" : view.queue.items.length + " chapters   " + (view.queue.running ? "downloading" : "paused")
    color: view.theme.muted
    font.family: view.theme.fontFamily
    font.pixelSize: view.theme.fontSmall
  }

  Column {
    id: summary
    anchors.top: title.bottom
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.leftMargin: view.theme.fontSize * 2
    anchors.rightMargin: view.theme.fontSize * 2
    anchors.topMargin: view.theme.fontSize * 2
    visible: view.summaryShown

    Rectangle {
      width: summary.width
      height: view.theme.fontSize * 2.4
      color: view.cursor === -1 ? view.theme.selected : "transparent"

      MouseArea {
        anchors.fill: parent
        onClicked: view.cursor = -1
      }

      Text {
        textFormat: Text.PlainText
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.leftMargin: view.theme.fontSize * 0.5
        anchors.verticalCenter: parent.verticalCenter
        elide: Text.ElideRight
        text: view.summaryShown ? NextChapters.summary(view.lastRun, view.tally) : ""
        color: view.cursor === -1 ? view.theme.selectedText : view.theme.foreground
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
      }
    }

    // The manga whose chapters could not be fetched: not queue rows.
    Repeater {
      model: view.summaryShown ? view.lastRun.failures : []

      Text {
        textFormat: Text.PlainText
        required property var modelData
        width: summary.width
        leftPadding: view.theme.fontSize * 0.5
        elide: Text.ElideRight
        text: modelData.title + "   could not fetch chapters   " + Failure.reason(modelData.message).text
        color: view.theme.urgent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }
    }
  }

  ListView {
    id: list
    anchors.top: view.summaryShown ? summary.bottom : title.bottom
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
        textFormat: Text.PlainText
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
        textFormat: Text.PlainText
        anchors.right: parent.right
        anchors.rightMargin: view.theme.fontSize * 0.5
        anchors.verticalCenter: parent.verticalCenter
        text: Downloads.statusText(row.modelData, view.reasons[row.modelData.chapterId], view.flareOn)
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
    textFormat: Text.PlainText
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
