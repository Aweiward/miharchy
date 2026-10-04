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
  // Only the latest page fetch may update the reader.
  property int pagesSeq: 0

  readonly property bool open: reader !== null
  readonly property var problem: reader ? Model.problem(reader, configPath) : null

  // The chapter the reader showed last, when it closed.
  signal closed(int chapterId)

  visible: open
  color: theme.background

  // The chapter ids belong to the old server, so nothing saves.
  onConfigChanged: {
    saveTimer.stop()
    pagesSeq++
    reader = null
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

  // chapters: newest first, as the manga detail lists them.
  function start(chapters, chapterId, mode) {
    reader = Reader.open(chapters, chapterId, mode)
    loadPages()
  }

  function close() {
    save()
    pagesSeq++
    var id = Reader.chapterId(reader)
    reader = null
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
      view.save()
    })
  }

  function save() {
    saveTimer.stop()
    var payload = Reader.savePayload(reader)
    if (!payload) return
    var id = Reader.chapterId(reader)
    reader = Reader.reduce(reader, { type: "saving" })
    send(payload, function(reply) {
      if (reply.state !== "ok" && view.reader) view.reader = Reader.reduce(view.reader, { type: "save-failed", chapterId: id })
    })
  }

  // A page turn saves after a pause; leaving the chapter saves it first.
  function turn(delta) {
    var next = Reader.reduce(reader, { type: "turn", delta: delta })
    if (next.index === reader.index) {
      reader = next
      saveTimer.restart()
      return
    }
    save()
    reader = next
    loadPages()
  }

  function run(id) {
    switch (id) {
      case "reader.left":
        turn(Reader.delta(reader.mode, "left"))
        break
      case "reader.right":
        turn(Reader.delta(reader.mode, "right"))
        break
      case "reader.next":
        turn(1)
        break
      case "reader.retry":
        reader = Reader.reduce(reader, { type: "retry" })
        loadPages()
        break
      case "reader.close":
        close()
        break
    }
  }

  Timer {
    id: saveTimer
    interval: 1000
    onTriggered: view.save()
  }

  // Each slot keeps its page while that page stays within the two before
  // and three after the one shown, so a live Image holds it decoded and a
  // turn shows it at once.
  Repeater {
    model: Reader.SLOTS

    Image {
      id: slot
      required property int index
      readonly property var held: view.reader && view.reader.state === "ok" ? Reader.slots(view.reader)[index] : null
      anchors.fill: parent
      visible: held !== null && held.page === view.reader.page
      source: held ? held.url : ""
      fillMode: Image.PreserveAspectFit
      asynchronous: true
      cache: true
      smooth: true
      mipmap: true
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
