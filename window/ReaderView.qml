pragma ComponentBehavior: Bound

import QtQuick
import "Chapters.js" as Chapters
import "Model.js" as Model
import "Prefs.js" as Prefs
import "Reader.js" as Reader
import "Settings.js" as Settings

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
  // The pageFit and webtoonWidth settings.
  property string pageFit: "screen"
  property string webtoonWidth: "60"
  // The skipRead, skipFiltered and skipDupe settings, as Chapters.readingOrder() takes them.
  property var skip: ({ read: false, filtered: true, dupe: false })
  // Only the latest start may set the chapter list.
  property int startSeq: 0
  // Whether the go-to-page field is open.
  property bool editing: false
  readonly property alias pageField: field
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
  signal key(var event)
  signal editEnded()
  // z, + and - change a Settings row; shell.qml saves it.
  signal setting(var row, var value)

  visible: open
  color: theme.background

  // The chapter ids belong to the old server, so nothing saves.
  onConfigChanged: {
    endEdit()
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
  // setting: miharchy.defaultReadingMode. The pages load at once with the
  // default chapter choices; the manga's own sort and filters follow.
  function start(manga, chapters, chapterId, setting) {
    var skip = view.skip
    var defaults = Prefs.defaults(Chapters.PREFS)
    reader = Reader.open(manga.id, Chapters.readingOrder(chapters, defaults, chapterId, skip), chapterId, Reader.mode(manga, setting))
    loadPages()
    var seq = ++startSeq
    send(Prefs.loadPayload(Chapters.PREFS, manga.id), function(reply) {
      if (seq !== view.startSeq || !view.reader || reply.state !== "ok") return
      var prefs = Prefs.read(Chapters.PREFS, reply.data, defaults)
      // The chapter open now, which a quick ] may have moved, is the one kept.
      view.reader = Reader.reduce(view.reader, { type: "chapters", chapters: Chapters.readingOrder(chapters, prefs, Reader.chapterId(view.reader), skip) })
    })
  }

  function close() {
    endEdit()
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
    var push = Reader.trackPayload(reader)
    reader = Reader.reduce(reader, { type: "saving" })
    exitStep("write")
    send(payload, function(reply) {
      if (reply.state !== "ok" && view.reader) view.reader = Reader.reduce(view.reader, { type: "save-failed", chapterId: id })
      // The push waits for the save: the server reads the chapters it marked.
      if (reply.state === "ok" && push) {
        view.exitStep("write")
        view.send(push, function() { view.exitStep("wrote") })
      }
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

  // A page change saves after a pause; leaving the chapter saves it first.
  function go(event) {
    var next = Reader.reduce(reader, event)
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

  // In webtoon the strip moves there and track() then takes the page at
  // the middle of the view, as for any scroll.
  function jump(page) {
    var before = reader
    go({ type: "goto", page: page })
    if (!webtoon || reader === before) return
    scrollAnimation.stop()
    strip.pinToEnd = reader.page === reader.pages.length - 1
    if (strip.pinToEnd) strip.positionViewAtEnd()
    else strip.positionViewAtIndex(reader.page, ListView.Beginning)
  }

  // The page or the strip, whichever shows.
  function flick() {
    return webtoon ? strip : pager
  }

  function scroll(part) {
    var f = flick()
    var from = scrollAnimation.running && scrollAnimation.target === f ? scrollAnimation.to : f.contentY
    var top = f.originY
    var bottom = f.originY + f.contentHeight - f.height
    scrollAnimation.stop()
    strip.pinToEnd = false
    scrollAnimation.target = f
    scrollAnimation.to = Math.max(top, Math.min(bottom, from + part * f.height))
    scrollAnimation.start()
  }

  function openEdit() {
    if (!reader || reader.state !== "ok") return
    editing = true
    field.text = ""
    field.forceActiveFocus()
  }

  function endEdit() {
    if (!editing) return
    editing = false
    editEnded()
  }

  function row(key) {
    return Settings.ROWS.filter(function(r) { return r.key === key })[0]
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
      case "reader.nextChapter":
      case "reader.previousChapter":
        go({ type: "chapter", delta: id === "reader.nextChapter" ? 1 : -1 })
        return
      case "reader.first":
        jump(0)
        return
      case "reader.last":
        jump(Infinity)
        return
      case "reader.goto":
        openEdit()
        return
      case "reader.commit":
        var page = Reader.pageNumber(field.text)
        endEdit()
        jump(page)
        return
      case "reader.cancel":
        endEdit()
        return
      case "reader.fit":
        if (!webtoon) setting(row("pageFit"), Settings.activate(row("pageFit"), pageFit).save)
        return
      case "reader.wider":
      case "reader.narrower":
        if (webtoon) setting(row("webtoonWidth"), Reader.step(row("webtoonWidth").options, webtoonWidth, id === "reader.wider" ? 1 : -1))
        return
    }
    if (webtoon) track()
    var f = flick()
    var act = Reader.action(reader, id, f.atYEnd, f.atYBeginning)
    if (!act) return
    if ("scroll" in act) scroll(act.scroll)
    else go({ type: "turn", delta: act.turn, chapter: act.chapter === true })
  }

  function tap(x, y) {
    if (editing) return
    var id = Reader.tapZone(reader.mode, x, y, width, height)
    if (id) run(id)
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

  // The page shown, sized by the page fit. A page larger than the view
  // scrolls; a new page starts at its top, and on the side the reading
  // starts from (Mihon's automatic zoom start).
  Flickable {
    id: pager
    property Item page: null
    anchors.fill: parent
    visible: view.open && !view.webtoon
    contentWidth: page ? Math.max(width, page.width) : width
    contentHeight: page ? Math.max(height, page.height) : height
    boundsBehavior: Flickable.StopAtBounds
    clip: true

    function place() {
      contentY = 0
      contentX = view.reader && view.reader.mode === "paged-rtl" ? contentWidth - width : 0
    }

    // Each slot keeps its page while that page stays within the two before
    // and three after the one shown, so a live Image holds it decoded and a
    // turn shows it at once.
    Repeater {
      model: Reader.SLOTS

      ServerImage {
        id: slot
        required property int index
        readonly property var held: view.reader && view.reader.state === "ok" && !view.webtoon ? Reader.slots(view.reader)[index] : null
        readonly property bool current: held !== null && held.page === view.reader.page
        readonly property var size: Reader.fit(view.pageFit, { width: implicitWidth, height: implicitHeight }, { width: pager.width, height: pager.height })
        x: Math.max(0, (pager.width - width) / 2)
        y: Math.max(0, (pager.height - height) / 2)
        width: size.width
        height: size.height
        visible: current
        onCurrentChanged: if (current) {
          pager.page = slot
          Qt.callLater(pager.place)
        }
        onSizeChanged: if (current) Qt.callLater(pager.place)
        config: view.config
        url: held ? held.url : ""
        // Decoded at the size shown, not the scan's: six full-size scans
        // would hold hundreds of megabytes. Stretch, as the size already
        // keeps the aspect.
        sourceSize: Qt.size(size.sourceWidth, size.sourceHeight)
        asynchronous: true
        cache: true
        smooth: true
        mipmap: true
      }
    }
  }

  // One vertical strip, as wide as the webtoon width setting. A ListView creates
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
    width: Reader.stripWidth(view.webtoonWidth, parent.width)
    visible: view.webtoon
    cacheBuffer: height
    boundsBehavior: Flickable.StopAtBounds
    onContentYChanged: view.track()
    onContentHeightChanged: if (pinToEnd) positionViewAtEnd()
    onMovementStarted: pinToEnd = false

    delegate: ServerImage {
      required property string modelData
      width: strip.width
      // A page still loading takes room, so the strip never asks for every
      // page at once.
      height: implicitWidth > 0 ? width * implicitHeight / implicitWidth : width * 1.4
      config: view.config
      url: modelData
      sourceSize.width: width
      fillMode: Image.PreserveAspectFit
      asynchronous: true
      smooth: true
    }

  }

  // The mouse runs the reader's own commands: a click the one its zone
  // stands for (Reader.tapZone), as h, l, d or u would; in paged mode the
  // wheel j and k, so a tall page scrolls before it turns. In webtoon the
  // wheel falls through to the strip, which scrolls. While the go-to field
  // types, as for keys, neither acts. It also keeps clicks off the views
  // below the reader.
  MouseArea {
    property real wheelRest: 0
    anchors.fill: parent
    enabled: view.open
    onClicked: function(mouse) { view.tap(mouse.x, mouse.y) }
    // Each click of a quick pair turns, as each tap does in Mihon.
    onDoubleClicked: function(mouse) { view.tap(mouse.x, mouse.y) }
    onWheel: function(wheel) {
      if (view.editing) return
      if (view.webtoon) {
        wheel.accepted = false
        return
      }
      var w = Reader.wheel(wheelRest, wheel.angleDelta.y)
      wheelRest = w.acc
      for (var i = 0; i < Math.abs(w.steps); i++) view.run(w.steps > 0 ? "reader.down" : "reader.up")
    }
  }

  NumberAnimation {
    id: scrollAnimation
    property: "contentY"
    duration: 120
    easing.type: Easing.OutQuad
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
    text: view.reader ? Reader.indicator(view.reader, view.pageFit, view.webtoonWidth) : ""
    color: view.theme.muted
    font.family: view.theme.fontFamily
    font.pixelSize: view.theme.fontSmall
  }

  Rectangle {
    anchors.horizontalCenter: parent.horizontalCenter
    anchors.bottom: parent.bottom
    anchors.margins: view.theme.fontSize
    width: goTo.width + view.theme.fontSize * 2
    height: goTo.height + view.theme.fontSize
    visible: view.editing
    color: view.theme.background
    border.color: view.theme.accent

    Row {
      id: goTo
      anchors.centerIn: parent
      spacing: view.theme.fontSize / 2

      Text {
        text: "Go to page"
        color: view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }

      TextInput {
        id: field
        width: view.theme.fontSize * 4
        clip: true
        color: view.theme.foreground
        selectionColor: view.theme.selected
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
        validator: IntValidator { bottom: 1 }
        Keys.onPressed: function(event) { view.key(event) }
      }

      Text {
        text: view.reader && view.reader.state === "ok" ? "of " + view.reader.pages.length + "   enter go   esc cancel" : ""
        color: view.theme.muted
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }
    }
  }
}
