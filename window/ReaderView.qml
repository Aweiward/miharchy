pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import "Chapters.js" as Chapters
import "Commands.js" as Commands
import "Downloads.js" as Downloads
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
  // The Settings values: page fit, webtoon width, skips, delete after read.
  property var values: Settings.initial().values
  readonly property string pageFit: values.pageFit
  readonly property string webtoonWidth: values.webtoonWidth
  // The skips, as Chapters.readingOrder() takes them. A change lists the
  // chapters again at once.
  readonly property var skip: ({ read: values.skipRead, filtered: values.skipFiltered, dupe: values.skipDupe, downloaded: values.downloadedOnly === true })
  readonly property string skipKey: [skip.read, skip.filtered, skip.dupe, skip.downloaded].join()
  readonly property bool deleteBookmarked: values.deleteBookmarked === true
  // What the chapter list comes from: { chapters, prefs }, the manga's
  // chapters newest first and its chapter choices.
  property var source: null
  // Only the latest start may set the chapter list.
  property int startSeq: 0
  // The settings panel (s) and its cursor.
  property bool panelOpen: false
  property int panelCursor: 0
  readonly property var panelRows: reader ? Reader.panelRows(reader, values) : []
  // No default route, checked as each chapter loads: the transition page
  // then warns of a chapter not downloaded.
  property bool offline: false
  // Whether the go-to-page field is open.
  property bool editing: false
  readonly property alias pageField: field
  // Only the latest page fetch may update the reader.
  property int pagesSeq: 0
  property var exit: Reader.EXIT
  // What the last o or y did, until the next reader command.
  property string note: ""

  readonly property bool open: reader !== null
  // Webtoon or continuous vertical: the strip shows, not the pager.
  readonly property bool inStrip: open && Reader.strip(reader.mode)
  // The paged zoom on top of the page fit (Reader.ZOOMS). It holds across
  // pages and chapters, and starts at 1 as the reader opens.
  property real zoom: 1
  // Each page's image size by URL, once its slot decodes it: what spreads
  // and split pages need to know (Reader.spreadAt).
  property var pageSizes: ({})
  // Spreads and split pages, as the turn and the pager take them.
  readonly property var layout: ({ dual: open && Reader.dual(reader.mode, values.dualPageView, { width: width, height: height }), split: values.dualPageSplit === true, sizes: pageSizes })
  // What the pager shows: Reader.spread(), null in the strip or while the
  // pages load.
  readonly property var shown: open && reader.state === "ok" && !inStrip ? Reader.spread(reader, layout, pageFit, { width: width, height: height }, zoom) : null
  // A new page or half, its size known, a fit, a window size or spreads
  // turning on start the page over at its start; a zoom keeps the spot
  // (zoomTo).
  readonly property string placeKey: shown ? [reader.index, reader.page, reader.half, reader.pages[reader.page] in pageSizes, pageFit, width, height, layout.dual].join() : ""
  onPlaceKeyChanged: if (shown) Qt.callLater(pager.place)

  function sized(url, w, h) {
    var s = pageSizes[url]
    if (!url || w <= 0 || h <= 0 || (s && Math.abs(s.width - w) < 2 && Math.abs(s.height - h) < 2)) return
    var next = {}
    for (var k in pageSizes) next[k] = pageSizes[k]
    next[url] = { width: w, height: h }
    pageSizes = next
  }
  readonly property var problem: reader ? Model.problem(reader, configPath) : null

  // The chapter the reader showed last, when it closed.
  signal closed(int chapterId)
  // A chapter left the disk, after delete after reading.
  signal deleted()
  signal key(var event)
  signal editEnded()
  // z, + and - change a Settings row; shell.qml saves it.
  signal setting(var row, var value)

  visible: open
  color: Reader.background(values.readerTheme, theme.background)

  // The chapter ids belong to the old server, so nothing saves.
  onConfigChanged: {
    endEdit()
    panelOpen = false
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
    var table = Chapters.PREFS.concat(Chapters.SCANLATOR_PREFS)
    var defaults = Prefs.defaults(table)
    source = { chapters: chapters, prefs: defaults }
    zoom = 1
    reader = Reader.open(manga.id, Chapters.readingOrder(chapters, defaults, chapterId, skip), chapterId, Reader.mode(manga, setting), values.incognito, manga.title)
    pageSizes = {}
    aheadFor = -1
    loadPages()
    var seq = ++startSeq
    send(Prefs.loadPayload(table, manga.id), function(reply) {
      if (seq !== view.startSeq || !view.reader || reply.state !== "ok") return
      view.source = { chapters: chapters, prefs: Prefs.read(table, reply.data, defaults) }
      view.relist()
    })
  }

  // The chapter open now, which a quick ] may have moved, is the one kept.
  function relist() {
    if (reader) reader = Reader.reduce(reader, { type: "chapters", chapters: Chapters.readingOrder(source.chapters, source.prefs, Reader.chapterId(reader), skip) })
  }

  onSkipKeyChanged: relist()

  function close() {
    endEdit()
    panelOpen = false
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
    route.running = true
    var seq = ++pagesSeq
    var cfg = config
    send(payload, function(reply) {
      if (seq !== view.pagesSeq) return
      view.reader = Reader.reduce(view.reader, { type: "pages", reply: reply, config: cfg })
      view.layoutStrip()
      view.save()
      view.downloadAhead()
    })
  }

  // Once per chapter opened: a retry or a page fetch again queues nothing
  // new. The queue shows any failure; the reader says nothing.
  property int aheadFor: -1
  function downloadAhead() {
    if (reader.state !== "ok" || Reader.chapterId(reader) === aheadFor) return
    aheadFor = Reader.chapterId(reader)
    var payload = Downloads.enqueuePayload(Reader.ahead(reader, values.downloadAhead))
    if (payload) send(payload, function() {})
  }

  function save() {
    saveTimer.stop()
    var payload = Reader.savePayload(reader)
    if (!payload) return
    var id = Reader.chapterId(reader)
    var push = values.trackAfterReading ? Reader.trackPayload(reader) : null
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

  // The chapter left counts as read: its save may still be on the way.
  function leave() {
    var target = Reader.deleteTarget(reader, Downloads.deleteSlots(values.deleteAfterRead))
    if (target === null) return
    var read = [Reader.chapterId(reader)]
    exitStep("write")
    send(Downloads.autoDeleteQuery([target]), function(reply) {
      var payload = reply.state === "ok" ? Downloads.autoDeletePayload(reply.data, view.deleteBookmarked, read) : null
      if (!payload) return view.exitStep("wrote")
      view.send(payload, function() {
        view.deleted()
        view.exitStep("wrote")
      })
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

  // The strip holds the chapter's pages only while it shows. Set
  // here, not bound: rebinding the model on every read state change would
  // rebuild the strip and lose the scroll position.
  function layoutStrip() {
    scrollAnimation.stop()
    strip.positioned = false
    strip.model = inStrip && reader.state === "ok" ? reader.pages : []
    strip.pinToEnd = strip.count > 0 && reader.toEnd
    if (!strip.count) return
    if (reader.toEnd) strip.positionViewAtEnd()
    else strip.positionViewAtIndex(reader.page, ListView.Beginning)
    strip.positioned = true
  }

  // Positioning moves the strip before it settles; those moves are not
  // reading.
  function track() {
    if (!strip.positioned || !inStrip || reader.state !== "ok") return
    var page = strip.indexAt(strip.width / 2, strip.contentY + strip.height / 2)
    if (page === -1 && !strip.atYBeginning && !strip.atYEnd) return
    var next = Reader.reduce(reader, { type: "scroll", page: page, start: strip.atYBeginning, end: strip.atYEnd })
    if (next === reader) return
    reader = next
    saveTimer.restart()
  }

  // In the strip it moves there and track() then takes the page at
  // the middle of the view, as for any scroll.
  function jump(page) {
    var before = reader
    go({ type: "goto", page: page })
    if (!inStrip || reader === before) return
    scrollAnimation.stop()
    strip.pinToEnd = reader.page === reader.pages.length - 1
    if (strip.pinToEnd) strip.positionViewAtEnd()
    else strip.positionViewAtIndex(reader.page, ListView.Beginning)
  }

  // The page or the strip, whichever shows.
  function flick() {
    return inStrip ? strip : pager
  }

  // By part of the view: down, or across for a pan.
  function scroll(part, across) {
    var f = flick()
    var anim = across ? panAnimation : scrollAnimation
    var from = anim.running && anim.target === f ? anim.to : across ? f.contentX : f.contentY
    anim.stop()
    strip.pinToEnd = false
    anim.target = f
    anim.to = across ? Reader.within(from + part * f.width, f.originX, f.contentWidth, f.width) : Reader.within(from + part * f.height, f.originY, f.contentHeight, f.height)
    anim.start()
  }

  // The spot at the middle of the view stays there.
  function zoomTo(z) {
    if (z === zoom) return
    panAnimation.stop()
    scrollAnimation.stop()
    var before = shown
    zoom = z
    if (!before) return
    pager.contentX = Reader.within(Reader.zoomedAt(pager.contentX, pager.width, before.pagesWidth, shown.pagesWidth), 0, pager.contentWidth, pager.width)
    pager.contentY = Reader.within(Reader.zoomedAt(pager.contentY, pager.height, before.pagesHeight, shown.pagesHeight), 0, pager.contentHeight, pager.height)
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
    return Reader.settingRow(key)
  }

  // The manga's reading mode saves to its meta; every other row is a
  // Settings row, which shell.qml saves.
  function choose() {
    var p = panelRows[panelCursor]
    if (p.manga) run("reader.mode")
    else setting(row(p.key), Settings.activate(row(p.key), values[p.key]).save)
  }

  function run(id) {
    note = ""
    switch (id) {
      case "reader.settings":
        panelOpen = true
        return
      case "reader.settingsClose":
        panelOpen = false
        return
      case "reader.settingsUp":
      case "reader.settingsDown":
        panelCursor = Math.max(0, Math.min(panelRows.length - 1, panelCursor + (id === "reader.settingsUp" ? -1 : 1)))
        return
      case "reader.settingsChoose":
        choose()
        return
      case "reader.savePage":
      case "reader.copyPage":
        pageAction(id)
        return
      case "reader.bookmark":
        var chapter = reader.chapters[reader.index]
        var payload = Reader.bookmarkPayload(reader)
        send(payload, function(reply) {
          if (reply.state !== "ok") {
            view.note = "Bookmark failed: " + (reply.message || reply.state)
            return
          }
          // The chapter line then says "bookmarked" while it is.
          if (view.reader) view.reader = Reader.reduce(view.reader, { type: "bookmarked", chapterId: chapter.id, bookmarked: payload.variables.bookmarked })
        })
        return
      case "reader.openWeb":
      case "reader.copyLink":
        var url = reader.chapters[reader.index].url
        if (!url) note = "The server has no link for this chapter"
        else if (id === "reader.openWeb") Quickshell.execDetached(["xdg-open", url])
        else {
          Quickshell.execDetached(["wl-copy", "--", url])
          note = "Link copied"
        }
        return
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
        if (!inStrip) setting(row("pageFit"), Settings.activate(row("pageFit"), pageFit).save)
        return
      case "reader.zoomIn":
      case "reader.zoomOut":
        var dir = id === "reader.zoomIn" ? 1 : -1
        if (inStrip) setting(row("webtoonWidth"), Reader.step(row("webtoonWidth").options, webtoonWidth, dir))
        else zoomTo(Reader.zoomStep(zoom, dir))
        return
      case "reader.zoomReset":
        if (inStrip) setting(row("webtoonWidth"), row("webtoonWidth").default)
        else zoomTo(1)
        return
    }
    if (inStrip) track()
    var f = flick()
    var act = Reader.action(reader, id, f.atYEnd, f.atYBeginning, { left: !f.atXBeginning, right: !f.atXEnd })
    if (!act) return
    if ("scroll" in act) scroll(act.scroll)
    else if ("pan" in act) scroll(act.pan, true)
    else go({ type: "turn", delta: act.turn, chapter: act.chapter === true, always: values.alwaysShowChapterTransition, offline: offline, layout: layout })
  }

  function tap(x, y) {
    if (editing) return
    var id = Reader.tapZone(reader.mode, x, y, width, height)
    if (id) run(id)
  }

  // The image of the page shown (the first of a spread), in the pager or
  // the strip, or null while it is not there.
  function shownImage() {
    if (!reader || reader.state !== "ok") return null
    if (inStrip) return strip.itemAtIndex(reader.page)
    return slotImages[Reader.slotOf(reader.page)] || null
  }

  // Each pager slot's image, by slot index, as the slots are made.
  property var slotImages: []

  // S saves the page shown, Y copies it (Mihon's page actions); the note
  // says how it went.
  function pageAction(id) {
    var image = shownImage()
    if (!image || !image.filePath) {
      note = "The page has not loaded yet"
      return
    }
    if (pageProcess.running) return
    if (id === "reader.savePage") {
      var target = Reader.pageTarget(reader, values.pageFolder, Quickshell.env("HOME"), image.contentType)
      pageProcess.done = "Saved to " + target.dir + "/" + target.name
      pageProcess.failed = "Saving failed"
      pageProcess.command = Reader.saveCommand(image.filePath, target)
    } else {
      pageProcess.done = "Page copied"
      pageProcess.failed = "Copying failed"
      pageProcess.command = Reader.copyCommand(image.filePath, image.contentType)
    }
    pageProcess.running = true
  }

  Process {
    id: pageProcess
    property string done: ""
    property string failed: ""
    stdout: StdioCollector {
      onStreamFinished: view.note = Reader.pageResult(text, pageProcess.done, pageProcess.failed)
    }
  }

  // ponytail: a default route stands for online; a network that routes but
  // reaches nothing still reads as online.
  Process {
    id: route
    command: ["sh", "-c", "command -v ip >/dev/null || echo unknown; ip route show default; ip -6 route show default"]
    stdout: StdioCollector {
      onStreamFinished: view.offline = text.trim() === ""
    }
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
    anchors.fill: parent
    visible: view.open && !view.inStrip
    contentWidth: view.shown ? view.shown.width : width
    contentHeight: view.shown ? view.shown.height : height
    boundsBehavior: Flickable.StopAtBounds
    clip: true

    function place() {
      contentY = 0
      contentX = view.reader && view.reader.mode === "paged-rtl" ? contentWidth - width : 0
    }

    // Each slot keeps its page while that page stays within the two before
    // and three after the one shown, so a live Image holds it decoded and a
    // turn shows it at once. A slot shows its page where view.shown puts
    // it, and clips it: a split page is one half of its image.
    Repeater {
      id: slots
      model: Reader.SLOTS

      Item {
        id: slot
        required property int index
        Component.onCompleted: view.slotImages[index] = image
        readonly property var held: view.shown ? Reader.slots(view.reader)[index] : null
        readonly property var item: held && view.shown ? view.shown.items.filter(function(it) { return it.page === slot.held.page })[0] || null : null
        // A page out of view decodes at the size it would show alone.
        readonly property var size: item || Reader.fit(view.pageFit, { width: image.implicitWidth, height: image.implicitHeight }, { width: pager.width, height: pager.height }, view.zoom)
        x: item ? item.x : 0
        y: item ? item.y : 0
        width: size.width
        height: size.height
        visible: item !== null
        clip: true

        ServerImage {
          id: image
          x: slot.item ? slot.item.imageX : 0
          width: slot.item ? slot.item.imageWidth : slot.size.width
          height: slot.size.height
          onImplicitWidthChanged: view.sized(url, implicitWidth, implicitHeight)
          onImplicitHeightChanged: view.sized(url, implicitWidth, implicitHeight)
          config: view.config
          url: slot.held ? slot.held.url : ""
          // Decoded at the size shown, not the scan's: six full-size scans
          // would hold hundreds of megabytes. Stretch, as the size already
          // keeps the aspect.
          sourceSize: Qt.size(slot.size.sourceWidth, slot.size.sourceHeight)
          asynchronous: true
          cache: true
          smooth: true
          mipmap: true
        }
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
    visible: view.inStrip
    spacing: view.reader ? Reader.stripGap(view.reader.mode) : 0
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

  // The transition page, over the page it follows: Mihon's
  // ChapterTransition. A turn its way reads on; any click zone or key
  // turns as on a page.
  Rectangle {
    anchors.fill: parent
    visible: view.reader !== null && view.reader.transition !== null
    color: view.color

    Rectangle {
      anchors.centerIn: parent
      width: Math.min(parent.width - view.theme.fontSize * 4, view.theme.fontSize * 34)
      height: lines.implicitHeight + view.theme.fontSize * 3
      color: Qt.alpha(view.theme.panel, 1)
      border.width: 1
      border.color: view.theme.panelBorder

      Column {
        id: lines
        x: view.theme.fontSize * 1.5
        y: view.theme.fontSize * 1.5
        width: parent.width - view.theme.fontSize * 3
        spacing: view.theme.fontSize * 1.5

        Repeater {
          model: view.reader && view.reader.transition ? Reader.transitionLines(view.reader.transition) : []

          Column {
            id: line
            required property var modelData
            width: lines.width
            spacing: view.theme.fontSize * 0.3

            Text {
              visible: line.modelData.label !== undefined
              text: line.modelData.label || ""
              color: view.theme.muted
              font.family: view.theme.fontFamily
              font.pixelSize: view.theme.fontSmall
            }

            Text {
              width: parent.width
              wrapMode: Text.Wrap
              maximumLineCount: 5
              elide: Text.ElideRight
              text: line.modelData.chapter ? line.modelData.chapter.name : line.modelData.warning || line.modelData.none
              color: line.modelData.warning ? view.theme.urgent : line.modelData.none ? view.theme.muted : view.theme.foreground
              font.family: view.theme.fontFamily
              font.pixelSize: line.modelData.chapter ? view.theme.fontSize * 1.3 : view.theme.fontSize
            }

            Text {
              width: parent.width
              visible: text !== ""
              elide: Text.ElideRight
              text: line.modelData.chapter ? [line.modelData.chapter.scanlator, line.modelData.chapter.downloaded ? "downloaded" : ""].filter(function(s) { return s !== "" }).join("   ") : ""
              color: view.theme.muted
              font.family: view.theme.fontFamily
              font.pixelSize: view.theme.fontSmall
            }
          }
        }
      }
    }
  }

  // The mouse runs the reader's own commands: a click the one its zone
  // stands for (Reader.tapZone), as h, l, d or u would; in paged mode the
  // wheel j and k, so a tall page scrolls before it turns. In the strip the
  // wheel falls through to the strip, which scrolls. Ctrl+wheel zooms, as
  // + and -. A drag moves the page or the strip, and its release is no
  // click. While the go-to field types, as for keys, none acts. It also
  // keeps clicks off the views below the reader.
  MouseArea {
    property real wheelRest: 0
    property point pressedAt
    property point startAt
    property bool dragged: false
    // Qt's default start drag distance.
    readonly property real dragDistance: 10
    anchors.fill: parent
    enabled: view.open
    onPressed: function(mouse) {
      var f = view.flick()
      scrollAnimation.stop()
      panAnimation.stop()
      pressedAt = Qt.point(mouse.x, mouse.y)
      startAt = Qt.point(f.contentX, f.contentY)
      dragged = false
    }
    onPositionChanged: function(mouse) {
      var dx = mouse.x - pressedAt.x
      var dy = mouse.y - pressedAt.y
      if (view.editing || (!dragged && Math.abs(dx) < dragDistance && Math.abs(dy) < dragDistance)) return
      dragged = true
      strip.pinToEnd = false
      var f = view.flick()
      f.contentX = Reader.within(startAt.x - dx, f.originX, f.contentWidth, f.width)
      f.contentY = Reader.within(startAt.y - dy, f.originY, f.contentHeight, f.height)
    }
    onClicked: function(mouse) { if (!dragged) view.tap(mouse.x, mouse.y) }
    // Each click of a quick pair turns, as each tap does in Mihon.
    onDoubleClicked: function(mouse) { if (!dragged) view.tap(mouse.x, mouse.y) }
    onWheel: function(wheel) {
      if (view.editing) return
      if (wheel.modifiers & Qt.ControlModifier) {
        var z = Reader.wheel(wheelRest, wheel.angleDelta.y)
        wheelRest = z.acc
        for (var n = 0; n < Math.abs(z.steps); n++) view.run(z.steps > 0 ? "reader.zoomOut" : "reader.zoomIn")
        return
      }
      if (view.inStrip) {
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

  NumberAnimation {
    id: panAnimation
    property: "contentX"
    duration: 120
    easing.type: Easing.OutQuad
  }

  // Under the open panel: a click outside it never turns a page.
  MouseArea {
    anchors.fill: parent
    visible: view.panelOpen
  }

  // The settings panel, drawn as a manga's chapter filter and sort.
  Rectangle {
    anchors.top: parent.top
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    width: view.theme.fontSize * 32
    height: panel.implicitHeight + view.theme.fontSize * 2
    visible: view.panelOpen
    color: Qt.alpha(view.theme.panel, 1)
    border.width: 1
    border.color: view.theme.panelBorder

    Column {
      id: panel
      x: view.theme.fontSize
      y: view.theme.fontSize
      width: parent.width - view.theme.fontSize * 2

      Repeater {
        model: view.panelRows

        Column {
          id: panelRow
          required property var modelData
          required property int index
          readonly property bool current: index === view.panelCursor
          width: panel.width

          Text {
            visible: panelRow.index < 2
            topPadding: panelRow.index === 0 ? 0 : view.theme.fontSize * 0.8
            text: panelRow.modelData.manga ? "This manga" : "Every manga"
            color: view.theme.muted
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSmall
          }

          Item {
            width: parent.width
            height: rowLabel.implicitHeight

            Text {
              id: rowLabel
              width: parent.width - rowValue.implicitWidth - view.theme.fontSize
              elide: Text.ElideRight
              text: panelRow.modelData.label
              color: panelRow.current ? view.theme.accent : view.theme.foreground
              font.family: view.theme.fontFamily
              font.pixelSize: view.theme.fontSize
            }

            Text {
              id: rowValue
              anchors.right: parent.right
              text: panelRow.modelData.text
              color: panelRow.current ? view.theme.accent : view.theme.muted
              font.family: view.theme.fontFamily
              font.pixelSize: view.theme.fontSize
            }

            MouseArea {
              anchors.fill: parent
              onClicked: view.panelCursor = panelRow.index
              onDoubleClicked: {
                view.panelCursor = panelRow.index
                view.key(Commands.enter())
              }
            }
          }
        }
      }

      HintBar {
        topPadding: view.theme.fontSize * 0.8
        theme: view.theme
        text: "j k move   enter change   esc close"
        onKey: function(event) { view.key(event) }
      }
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
    id: incognitoMark
    anchors.left: parent.left
    anchors.bottom: parent.bottom
    anchors.margins: view.theme.fontSize
    visible: view.reader !== null && view.reader.incognito
    text: visible ? "incognito" : ""
    color: view.theme.accent
    font.family: view.theme.fontFamily
    font.pixelSize: view.theme.fontSmall
  }

  Text {
    anchors.left: incognitoMark.visible ? incognitoMark.right : parent.left
    anchors.bottom: parent.bottom
    anchors.margins: view.theme.fontSize
    text: view.reader ? Reader.chapterName(view.reader) + (view.reader.chapters[view.reader.index].bookmarked ? "   bookmarked" : "") + ({ first: "   no previous chapter", last: "   no next chapter" }[view.reader.edge] || "") + (view.note ? "   " + view.note : "") : ""
    color: view.theme.muted
    font.family: view.theme.fontFamily
    font.pixelSize: view.theme.fontSmall
  }

  Text {
    anchors.right: parent.right
    anchors.bottom: parent.bottom
    anchors.margins: view.theme.fontSize
    text: view.reader ? Reader.indicator(view.reader, view.pageFit, view.webtoonWidth, view.zoom) : ""
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
