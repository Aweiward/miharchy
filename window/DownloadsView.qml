pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import "Model.js" as Model
import "Session.js" as Session
import "Downloads.js" as Downloads
import "Failure.js" as Failure
import "NextChapters.js" as NextChapters

// The download queue over the whole window, kept live by Suwayomi's
// downloadStatusChanged subscription while the overlay shows or anything
// waits in the queue. Downloads.js decides; shell.qml forwards every
// "downloads." command to run(). The last next-chapters run (NextChapters.js)
// shows as a summary line above the queue, at cursor -1.
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
  // Why each failed download failed (Downloads.failed).
  property var reasons: ({})
  // The server's flareSolverrEnabled: a Cloudflare row hints at Setup
  // while it is off.
  property bool flareOn: false
  // nextChapters.lastRun; what the queue has shown of it (NextChapters.track),
  // and whether its end has notified.
  property var lastRun: null
  property var marks: ({})
  property bool notified: false
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
    send({ query: Downloads.STATUS_QUERY })
  }

  onLastRunChanged: {
    if (lastRun && lastRun.state === "refreshing") {
      marks = {}
      notified = false
    }
    follow([])
  }

  function update(event) {
    var next = Downloads.reduce(queue, event)
    var gone = Downloads.left(queue.items, next.items)
    queue = next
    cursor = Math.max(summaryShown ? -1 : 0, Math.min(cursor, queue.items.length - 1))
    var f = Downloads.failed(queue.items, reasons)
    reasons = f.reasons
    f.probe.forEach(probe)
    var live = event.type === "live" && event.data.downloadStatusChanged
    follow(live && !live.initial ? live.updates || [] : [])
    if (gone.length) leftQueue(gone)
  }

  // Once per run: a retry after its end shows in the summary line only.
  function follow(updates) {
    if (!lastRun) return
    marks = NextChapters.track(marks, lastRun, queue.items, updates)
    if (notified || !NextChapters.ended(lastRun, tally)) return
    notified = true
    var command = NextChapters.notifyCommand(lastRun, tally)
    if (command) Quickshell.execDetached(command)
  }

  // A retried chapter loses its reason, so its next failure is probed again.
  function retry(chapterIds) {
    var payload = Downloads.retryPayload(chapterIds)
    if (!payload) return
    var r = Object.assign({}, reasons)
    chapterIds.forEach(function(id) { delete r[id] })
    reasons = r
    send(payload)
  }

  // Outside seq: a probe never touches the queue.
  function probe(chapterId) {
    Session.send(config, Downloads.probePayload(chapterId), function(reply) {
      view.reasons = Downloads.probed(view.reasons, chapterId, reply)
    })
  }

  // Any reply that carries the download status: the first look's, or a
  // mutation's sent from here or from the manga detail. While the
  // subscription runs it carries every change, and a reply's status can be
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
        if (armed) send(Downloads.CLEAR_PAYLOAD)
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

  // A result that left changes out restarts the subscription, whose first
  // result holds the whole queue.
  LiveSocket {
    id: live
    config: view.config
    query: Downloads.LIVE_QUERY
    running: view.config !== null && Downloads.live(view.queue, view.open)
    onResult: function(data) {
      view.update({ type: "live", data: data })
      if (Downloads.omitted(data)) Qt.callLater(live.restart)
    }
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
