pragma ComponentBehavior: Bound

import QtQuick
import "Model.js" as Model
import "Reader.js" as Reader

// The reader over the whole window. It fetches pages and saves the read
// state itself; Reader.js decides. shell.qml forwards every "reader."
// command to run().
Rectangle {
  id: view

  required property Theme theme
  property var config: null
  property string configPath: ""
  property var reader: null
  property bool deleteAfterRead: false
  // Only the latest page fetch may update the reader.
  property int pagesSeq: 0
  property var exit: Reader.EXIT

  readonly property bool open: reader !== null
  readonly property bool webtoon: open && reader.mode === "webtoon"
  readonly property var problem: reader ? Model.problem(reader, configPath) : null

  // The chapter the reader showed last, when it closed.
  signal closed(int chapterId)
  // A chapter it finished left the disk, after delete after read.
  signal deleted()

  visible: open
  color: theme.background

  // The chapter ids belong to the old server, so nothing saves.
  onConfigChanged: {
    saveTimer.stop()
    pagesSeq++
    reader = null
    layoutStrip()
  }

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

  // manga: the manga detail's; chapters: newest first, as it lists them;
  // setting: miharchy.defaultReadingMode.
  function start(manga, chapters, chapterId, setting) {
    reader = Reader.open(manga.id, chapters, chapterId, Reader.mode(manga, setting))
    loadPages()
  }

  function close() {
    save()
    leave()
    pagesSeq++
    var id = Reader.chapterId(reader)
    reader = null
    layoutStrip()
    closed(id)
  }

  // The first save after the pages load goes out at once, so the chapter
  // enters the history as it opens.
  function loadPages() {
    var payload = Reader.pagesPayload(reader)
    if (!payload) return
    var seq = ++pagesSeq
    var cfg = config
    send(payload, function(reply) {
      if (seq !== view.pagesSeq) return
      view.reader = Reader.reduce(view.reader, { type: "pages", reply: reply, config: cfg })
      view.layoutStrip()
      view.save()
    })
  }

  function save() {
    saveTimer.stop()
    var payload = Reader.savePayload(reader)
    if (!payload) return
    var id = Reader.chapterId(reader)
    reader = Reader.reduce(reader, { type: "saving" })
    exitStep("write")
    send(payload, function(reply) {
      if (reply.state !== "ok" && view.reader) view.reader = Reader.reduce(view.reader, { type: "save-failed", chapterId: id })
      view.exitStep("wrote")
    })
  }

  function leave() {
    var payload = Reader.deletePayload(reader, deleteAfterRead)
    if (!payload) return
    exitStep("write")
    send(payload, function() {
      view.deleted()
      view.exitStep("wrote")
    })
  }

  // Every way the window exits lands here: the open chapter saves and
  // leaves first, and the window quits once those replies are in.
  function quit() {
    if (exit.quitting) return
    if (open) {
      save()
      leave()
    }
    quitTimeout.start()
    exitStep("quit")
  }

  function exitStep(event) {
    exit = Reader.exit(exit, event)
    if (Reader.canQuit(exit)) Qt.quit()
  }

  // A page turn saves after a pause; leaving the chapter saves it first.
  function turn(delta, chapter) {
    var next = Reader.reduce(reader, { type: "turn", delta: delta, chapter: chapter === true })
    if (next.index === reader.index) {
      reader = next
      saveTimer.restart()
      return
    }
    save()
    leave()
    reader = next
    layoutStrip()
    loadPages()
  }

  // The strip holds the chapter's pages only while webtoon shows them. Set
  // here, not bound: rebinding the model on every read state change would
  // rebuild the strip and lose the scroll position.
  function layoutStrip() {
    scrollAnimation.stop()
    strip.positioned = false
    strip.model = webtoon && reader.state === "ok" ? reader.pages : []
    strip.pinToEnd = strip.count > 0 && reader.toEnd
    if (!strip.count) return
    if (reader.toEnd) strip.positionViewAtEnd()
    else strip.positionViewAtIndex(reader.page, ListView.Beginning)
    strip.positioned = true
  }

  // Positioning moves the strip before it settles; those moves are not
  // reading.
  function track() {
    if (!strip.positioned || !webtoon || reader.state !== "ok") return
    var page = strip.indexAt(strip.width / 2, strip.contentY + strip.height / 2)
    if (page === -1 && !strip.atYBeginning && !strip.atYEnd) return
    var next = Reader.reduce(reader, { type: "scroll", page: page, start: strip.atYBeginning, end: strip.atYEnd })
    if (next === reader) return
    reader = next
    saveTimer.restart()
  }

  function scroll(part) {
    var from = scrollAnimation.running ? scrollAnimation.to : strip.contentY
    var top = strip.originY
    var bottom = strip.originY + strip.contentHeight - strip.height
    scrollAnimation.stop()
    strip.pinToEnd = false
    scrollAnimation.to =Math.max(top, Math.min(bottom, from + part * strip.height))
    scrollAnimation.start()
  }

  function run(id) {
    switch (id) {
      case "reader.retry":
        reader = Reader.reduce(reader, { type: "retry" })
        loadPages()
        return
      case "reader.close":
        close()
        return
      case "reader.mode":
        reader = Reader.reduce(reader, { type: "mode" })
        send(Reader.modePayload(reader), function() {})
        layoutStrip()
        return
    }
    if (webtoon) track()
    var act = Reader.action(reader, id, strip.atYEnd, strip.atYBeginning)
    if (!act) return
    if ("scroll" in act) scroll(act.scroll)
    else turn(act.turn, act.chapter)
  }

  Timer {
    id: saveTimer
    interval: 1000
    onTriggered: view.save()
  }

  // A server that hangs never answers; the window still quits.
  Timer {
    id: quitTimeout
    interval: 2000
    onTriggered: Qt.quit()
  }

  // Each slot keeps its page while that page stays within the two before
  // and three after the one shown, so a live Image holds it decoded and a
  // turn shows it at once.
  Repeater {
    model: Reader.SLOTS

    Image {
      id: slot
      required property int index
      readonly property var held: view.reader && view.reader.state === "ok" && !view.webtoon ? Reader.slots(view.reader)[index] : null
      anchors.fill: parent
      visible: held !== null && held.page === view.reader.page
      source: held ? held.url : ""
      // Decoded at the size shown, not the scan's: six full-size scans
      // would hold hundreds of megabytes.
      sourceSize: Qt.size(width, height)
      fillMode: Image.PreserveAspectFit
      asynchronous: true
      cache: true
      smooth: true
      mipmap: true
    }
  }

  // One vertical strip, no wider than the view is tall. A ListView creates
  // only the pages in view plus a view's height either side and destroys
  // the rest, so a long chapter keeps a few pages decoded, each at the
  // strip's width.
  ListView {
    id: strip
    property bool positioned: false
    // Entered backwards: the pages near the end load after the strip
    // moves there and push the end down, so it follows until the reader
    // scrolls.
    property bool pinToEnd: false
    anchors.top: parent.top
    anchors.bottom: parent.bottom
    anchors.horizontalCenter: parent.horizontalCenter
    width: Math.min(parent.width, parent.height)
    visible: view.webtoon
    cacheBuffer: height
    boundsBehavior: Flickable.StopAtBounds
    onContentYChanged: view.track()
    onContentHeightChanged: if (pinToEnd) positionViewAtEnd()
    onMovementStarted: pinToEnd = false

    delegate: Image {
      required property string modelData
      width: strip.width
      // A page still loading takes room, so the strip never asks for every
      // page at once.
      height: implicitWidth > 0 ? width * implicitHeight / implicitWidth : width * 1.4
      source: modelData
      sourceSize.width: width
      fillMode: Image.PreserveAspectFit
      asynchronous: true
      smooth: true
    }

    NumberAnimation on contentY {
      id: scrollAnimation
      running: false
      duration: 120
      easing.type: Easing.OutQuad
    }
  }

  Text {
    anchors.centerIn: parent
    width: Math.min(parent.width - view.theme.fontSize * 4, view.theme.fontSize * 50)
    horizontalAlignment: Text.AlignHCenter
    wrapMode: Text.Wrap
    visible: text !== ""
    text: !view.reader ? "" : view.problem ? view.problem.title + ". " + view.problem.detail : view.reader.state === "loading" ? "Loading " + Reader.chapterName(view.reader) : ""
    color: view.problem ? view.theme.urgent : view.theme.muted
    font.family: view.theme.fontFamily
    font.pixelSize: view.theme.fontSize
  }

  Text {
    anchors.left: parent.left
    anchors.bottom: parent.bottom
    anchors.margins: view.theme.fontSize
    text: view.reader ? Reader.chapterName(view.reader) + ({ first: "   no previous chapter", last: "   no next chapter" }[view.reader.edge] || "") : ""
    color: view.theme.muted
    font.family: view.theme.fontFamily
    font.pixelSize: view.theme.fontSmall
  }

  Text {
    anchors.right: parent.right
    anchors.bottom: parent.bottom
    anchors.margins: view.theme.fontSize
    text: view.reader ? Reader.indicator(view.reader) : ""
    color: view.theme.muted
    font.family: view.theme.fontFamily
    font.pixelSize: view.theme.fontSmall
  }
}
