pragma ComponentBehavior: Bound

import QtQuick
import "Model.js" as Model
import "Browse.js" as Browse
import "Downloads.js" as Downloads
import "Chapters.js" as Chapters
import "Commands.js" as Commands

// A manga's detail over the view that opened it, Library or Browse: cover
// and metadata beside the chapter list, filtered and sorted as the manga's
// chapter choices say (Chapters.js). It talks to the server itself;
// Browse.js decides. shell.qml forwards every "manga."
// command to run().
Rectangle {
  id: view

  required property Theme theme
  property var config: null
  property string configPath: ""
  property var detail: null
  property int cursor: 0
  // The user's categories, from the library; the checklist lists them.
  property var categories: []
  property bool picking: false
  property int pickCursor: 0
  // -1, or the chapter where v started a selection.
  property int anchor: -1
  // The download queue's items, for each chapter's marker.
  property var queue: []
  // Only the latest detail request may update it.
  property int detailSeq: 0
  // The library's manga, which "save as default for every manga" resets.
  property var libraryIds: []
  property bool optionsOpen: false
  property int optionsCursor: 0
  property string optionsNote: ""
  // The download menu (Chapters.DOWNLOADS); counting: its number field is open.
  property bool downloadsOpen: false
  property int downloadsCursor: 0
  property bool counting: false
  property string downloadsNote: ""
  // The skipFiltered reader setting, which the download menu follows as Mihon's does.
  property bool skipFiltered: true
  readonly property bool editing: counting

  readonly property bool open: detail !== null
  readonly property var manga: detail ? detail.manga : null
  readonly property bool selecting: anchor >= 0
  // The chapters as listed; cursor and anchor index it. detail.chapters
  // stays in source order, newest first, for the reader.
  // The chapter choices and the excluded scanlators, as Chapters.js takes them.
  readonly property var prefs: Object.assign({}, chapterPrefs.values, scanlatorPrefs.values)
  readonly property var shown: detail ? Chapters.apply(detail.chapters, prefs) : []
  readonly property var next: Chapters.nextUnread(shown, prefs)
  readonly property string resume: detail ? Chapters.resumeLabel(detail.chapters, next) : ""
  readonly property var optionRows: Chapters.rows(prefs, detail ? Chapters.scanlators(detail.chapters) : [])
  readonly property var notice: detail ? Browse.notice(detail, configPath) : null
  readonly property string hint: picking ? "j k move   space in or out   esc close   "
    : optionsOpen ? "j k move   enter change   esc close   "
    : downloadsOpen ? "j k move   enter download   esc close   "
    : selecting ? "j k extend   R read   u unread   b bookmark   d download   x delete download   esc end   "
    : "j k chapters   enter read   R read   u unread   P read before   b bookmark   F filter & sort   d download   v select   U download menu   x delete   D queue   " + (manga && manga.inLibrary ? "M migrate   " : "") + "c categories   t tracking   r refresh   esc back   "

  signal libraryChanged(int mangaId, bool inLibrary)
  signal read(var chapters, int chapterId)
  // shell.qml's markChapters() applies it and answers with markReply().
  // action: "read", "unread" or "bookmark".
  signal mark(var chapters, string action, int mangaId)
  signal categorized()
  // A download mutation's reply, which carries the queue.
  signal downloads(var reply)
  // A double click sends Enter, a click on a key label its key, as typed.
  signal key(var event)
  // The number field closed; the window takes the keys back.
  signal editEnded()

  visible: open
  color: theme.background

  onCursorChanged: chapters.positionViewAtIndex(cursor, ListView.Contain)
  onConfigChanged: close()
  // A mark or a filter change can take rows away under the cursor.
  onShownChanged: cursor = Math.max(0, Math.min(shown.length - 1, cursor))

  PrefStore {
    id: chapterPrefs
    config: view.config
    table: Chapters.PREFS
    onFailed: function(reply) { view.optionsNote = reply.message || reply.state }
  }

  PrefStore {
    id: scanlatorPrefs
    config: view.config
    table: Chapters.SCANLATOR_PREFS
    onFailed: function(reply) { view.optionsNote = reply.message || reply.state }
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

  // fromSource: opened while browsing a source, so it refreshes once.
  function openManga(mangaId, fromSource) {
    detail = Browse.detail(mangaId, fromSource)
    chapterPrefs.open(mangaId)
    scanlatorPrefs.open(mangaId)
    cursor = 0
    detailSeq++
    advance()
  }

  function close() {
    picking = false
    optionsOpen = false
    downloadsOpen = false
    endCount()
    anchor = -1
    detailSeq++
    detail = null
  }

  // After the reader: show what it marked read, on the chapter it left.
  function reread(chapterId) {
    if (!detail) return
    for (var i = 0; i < shown.length; i++) if (shown[i].id === chapterId) cursor = i
    reload()
  }

  // Reads the cached chapters again, as after a download finished.
  function reload() {
    if (!detail) return
    detailSeq++
    detail = Browse.reduceDetail(detail, { type: "reread" })
    advance()
  }

  function advance() {
    var payload = Browse.detailPayload(detail)
    if (!payload) return
    var seq = detailSeq
    var cfg = config
    send(payload, function(reply) {
      if (seq !== view.detailSeq) return
      view.detail = Browse.reduceDetail(view.detail, { type: "reply", reply: reply, config: cfg })
      view.advance()
    })
  }

  // Matched by manga, not by request number: a refresh or Back while the
  // toggle is in flight must not strand it, since the server applies it.
  function toggleLibrary() {
    var payload = Browse.libraryPayload(detail)
    if (!payload) return
    var mangaId = detail.mangaId
    detail = Browse.reduceDetail(detail, { type: "library-request" })
    send(payload, function(reply) {
      if (view.detail && view.detail.mangaId === mangaId) view.detail = Browse.reduceDetail(view.detail, { type: "library-reply", reply: reply })
      if (reply.state === "ok") view.libraryChanged(mangaId, reply.data.updateManga.manga.inLibrary === true)
    })
  }

  function downloadsLeft(items) {
    if (detail && items.some(function(i) { return i.mangaId === view.detail.mangaId })) reload()
  }

  function sendDownloads(payload) {
    anchor = -1
    if (!payload) return
    var mangaId = detail.mangaId
    send(payload, function(reply) {
      if (view.detail && view.detail.mangaId === mangaId) view.detail = Browse.reduceDetail(view.detail, { type: "downloads-reply", reply: reply })
      view.downloads(reply)
    })
  }

  function sendMark(list, action) {
    anchor = -1
    mark(list, action, detail.mangaId)
  }

  function chooseOption() {
    var row = optionRows[optionsCursor]
    optionsNote = ""
    if (row.kind !== "default") {
      (row.kind === "scanlator" ? scanlatorPrefs : chapterPrefs).set(Chapters.choose(prefs, row))
      return
    }
    chapterPrefs.saveDefault(row.id === "defaultAll" ? libraryIds : [])
    optionsNote = row.id === "defaultAll" ? "Saved as the default for every manga" : "Saved as the default"
  }

  function endCount() {
    if (!counting) return
    counting = false
    editEnded()
  }

  // Queues what the menu row picks, and closes the menu, as Mihon's does.
  // A queued chapter counts as on its way, as Mihon's download state does.
  function downloadRow(row, n) {
    var waiting = detail.chapters.filter(function(c) { return !Downloads.find(view.queue, c.id) })
    var list = Chapters.toDownload(waiting, prefs, skipFiltered, row, n)
    if (!list.length) {
      downloadsNote = "Nothing to download"
      return
    }
    downloadsOpen = false
    sendDownloads(Downloads.enqueuePayload(list))
  }

  onCountingChanged: {
    if (!counting) return
    countField.text = ""
    countField.forceActiveFocus()
  }

  function markReply(reply) {
    if (!detail) return
    detail = Browse.reduceDetail(detail, { type: "mark-reply", reply: reply })
    reload()
  }

  function toggleCategory() {
    var c = categories[pickCursor]
    var payload = c ? Browse.categoryPayload(detail, c.id) : null
    if (!payload) return
    var mangaId = detail.mangaId
    detail = Browse.reduceDetail(detail, { type: "library-request" })
    send(payload, function(reply) {
      if (view.detail && view.detail.mangaId === mangaId) view.detail = Browse.reduceDetail(view.detail, { type: "categories-reply", reply: reply })
      if (reply.state === "ok") view.categorized()
    })
  }

  function run(id) {
    switch (id) {
      case "manga.categories":
        picking = true
        pickCursor = 0
        break
      case "manga.categoriesClose":
        picking = false
        break
      case "manga.categoryUp":
      case "manga.categoryDown":
        if (categories.length) pickCursor = Math.max(0, Math.min(categories.length - 1, pickCursor + (id === "manga.categoryUp" ? -1 : 1)))
        break
      case "manga.categoryToggle":
        toggleCategory()
        break
      case "manga.back":
        close()
        break
      case "manga.up":
      case "manga.down":
        if (shown.length) cursor = Math.max(0, Math.min(shown.length - 1, cursor + (id === "manga.up" ? -1 : 1)))
        break
      case "manga.read":
        var c = shown[cursor]
        if (c) read(detail.chapters, c.id)
        break
      case "manga.resume":
        if (next) read(detail.chapters, next.id)
        break
      case "manga.options":
        optionsOpen = true
        optionsNote = ""
        break
      case "manga.optionsClose":
        optionsOpen = false
        break
      case "manga.optionsUp":
      case "manga.optionsDown":
        optionsCursor = Math.max(0, Math.min(optionRows.length - 1, optionsCursor + (id === "manga.optionsUp" ? -1 : 1)))
        break
      case "manga.optionsChoose":
        chooseOption()
        break
      case "manga.library":
        toggleLibrary()
        break
      case "manga.select":
        anchor = cursor
        break
      case "manga.selectEnd":
        anchor = -1
        break
      case "manga.download":
        sendDownloads(Downloads.enqueuePayload(Downloads.marked(shown, cursor, anchor)))
        break
      case "manga.downloads":
        downloadsOpen = true
        downloadsCursor = 0
        downloadsNote = ""
        break
      case "manga.downloadsClose":
        downloadsOpen = false
        break
      case "manga.downloadsUp":
      case "manga.downloadsDown":
        downloadsCursor = Math.max(0, Math.min(Chapters.DOWNLOADS.length - 1, downloadsCursor + (id === "manga.downloadsUp" ? -1 : 1)))
        downloadsNote = ""
        break
      case "manga.downloadsChoose":
        var row = Chapters.DOWNLOADS[downloadsCursor]
        downloadsNote = ""
        if (row.id === "next" && !row.count) counting = true
        else downloadRow(row, row.count)
        break
      case "manga.commit":
        var n = Chapters.count(countField.text)
        if (!n) {
          downloadsNote = "Type a whole number above 0"
          break
        }
        endCount()
        downloadRow(Chapters.DOWNLOADS[downloadsCursor], n)
        break
      case "manga.cancel":
        endCount()
        break
      case "manga.deleteDownload":
        sendDownloads(Downloads.removePayload(Downloads.marked(shown, cursor, anchor), queue))
        break
      case "manga.markRead":
      case "manga.markUnread":
        sendMark(Downloads.marked(shown, cursor, anchor), id === "manga.markRead" ? "read" : "unread")
        break
      case "manga.bookmark":
        sendMark(Downloads.marked(shown, cursor, anchor), "bookmark")
        break
      case "manga.markPrevious":
        sendMark(Chapters.previous(shown, cursor, prefs), "read")
        break
      case "manga.refresh":
        detailSeq++
        detail = Browse.reduceDetail(detail, { type: "refresh" })
        advance()
        break
    }
  }

  // Over the view it opened from: a click never reaches the grid below.
  MouseArea {
    anchors.fill: parent
  }

  Cover {
    id: coverBox
    anchors.top: parent.top
    anchors.left: parent.left
    anchors.margins: view.theme.fontSize * 2
    width: view.theme.fontSize * 16
    height: width * 1.5
    theme: view.theme
    config: view.config
    source: view.manga ? view.manga.cover : ""
    title: view.manga ? view.manga.title : ""
  }

  Column {
    id: info
    anchors.top: parent.top
    anchors.left: coverBox.right
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    spacing: view.theme.fontSize * 0.5

    Text {
      width: parent.width
      wrapMode: Text.Wrap
      text: view.manga ? view.manga.title : "Loading"
      color: view.theme.foreground
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontHeading
    }

    Text {
      width: parent.width
      wrapMode: Text.Wrap
      visible: text !== ""
      text: {
        if (!view.manga) return ""
        var people = [view.manga.author, view.manga.artist].filter(function(p, i, all) { return p && all.indexOf(p) === i })
        return people.join(", ")
      }
      color: view.theme.muted
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSize
    }

    Text {
      width: parent.width
      wrapMode: Text.Wrap
      text: view.manga ? [view.manga.status, view.manga.source].filter(function(s) { return s }).join("   ") : ""
      color: view.theme.muted
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }

    Text {
      width: parent.width
      wrapMode: Text.Wrap
      visible: text !== ""
      text: view.detail ? Browse.sourceHelp(view.manga, view.detail.extension) : ""
      color: view.theme.urgent
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }

    Text {
      width: parent.width
      wrapMode: Text.Wrap
      visible: text !== ""
      text: view.manga ? view.manga.genres : ""
      color: view.theme.muted
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }

    HintBar {
      theme: view.theme
      text: !view.manga ? "" : view.detail.busy ? "saving" : view.manga.inLibrary ? "In library   a remove from library" : "a add to library"
      color: view.manga && view.manga.inLibrary ? view.theme.accent : view.theme.foreground
      pixelSize: view.theme.fontSize
      onKey: function(event) { view.key(event) }
    }

    Text {
      width: parent.width
      wrapMode: Text.Wrap
      visible: text !== ""
      text: !view.manga || !view.manga.inLibrary || !view.categories.length ? "" : view.categories.filter(function(c) { return view.manga.categories.indexOf(c.id) !== -1 }).map(function(c) { return c.name }).join(", ") || "Default"
      color: view.theme.muted
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }

    Text {
      width: parent.width
      wrapMode: Text.Wrap
      visible: text !== ""
      text: view.detail && view.detail.libraryError ? view.detail.libraryError : view.notice ? view.notice.title + ". " + view.notice.detail : ""
      color: view.theme.urgent
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }

    Text {
      width: parent.width
      wrapMode: Text.Wrap
      maximumLineCount: 6
      elide: Text.ElideRight
      text: view.manga ? view.manga.description : ""
      color: view.theme.foreground
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }
  }

  ListView {
    id: chapters
    anchors.top: (info.height > coverBox.height ? info : coverBox).bottom
    anchors.bottom: parent.bottom
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    clip: true
    model: view.shown

    header: Text {
      bottomPadding: view.theme.fontSize * 0.5
      text: {
        if (!view.detail) return ""
        if (view.detail.state === "loading") return "Loading chapters"
        var hidden = view.detail.chapters.length - view.shown.length
        return [view.detail.chapters.length + " chapters", hidden ? hidden + " hidden by the filter" : "", view.resume ? view.resume + ": space" : ""].filter(function(s) { return s }).join("   ")
      }
      color: view.theme.accent
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }

    delegate: Rectangle {
      id: row
      required property var modelData
      required property int index
      readonly property bool current: index === view.cursor
      readonly property bool inRange: view.selecting && index >= Math.min(view.cursor, view.anchor) && index <= Math.max(view.cursor, view.anchor)
      readonly property string marker: Downloads.marker(modelData, view.queue)
      width: chapters.width
      height: view.theme.fontSize * 2
      color: current || inRange ? view.theme.selected : "transparent"

      MouseArea {
        anchors.fill: parent
        onClicked: view.cursor = row.index
        onDoubleClicked: {
          view.cursor = row.index
          view.key(Commands.enter())
        }
      }

      Text {
        anchors.left: parent.left
        anchors.leftMargin: view.theme.fontSize * 0.5
        anchors.right: mark.left
        anchors.rightMargin: view.theme.fontSize
        anchors.verticalCenter: parent.verticalCenter
        elide: Text.ElideRight
        // Mihon marks a bookmark with an icon and the accent color.
        text: (row.modelData.bookmarked ? "★ " : "") + row.modelData.name
        color: row.current ? view.theme.selectedText : row.modelData.read ? view.theme.muted : row.modelData.bookmarked ? view.theme.accent : view.theme.foreground
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
      }

      Text {
        id: mark
        anchors.right: meta.left
        anchors.rightMargin: text ? view.theme.fontSize * 1.5 : 0
        anchors.verticalCenter: parent.verticalCenter
        text: row.marker
        color: row.marker === "failed" ? view.theme.urgent : view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }

      Text {
        id: meta
        anchors.right: parent.right
        anchors.rightMargin: view.theme.fontSize * 0.5
        anchors.verticalCenter: parent.verticalCenter
        text: [row.modelData.scanlator, row.modelData.date].filter(function(s) { return s }).join("   ")
        color: view.theme.muted
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }
    }
  }

  // Under an open panel: a click outside it never reaches a chapter.
  MouseArea {
    anchors.fill: parent
    visible: view.optionsOpen || view.picking || view.downloadsOpen
  }

  // Mihon's download menu.
  Rectangle {
    anchors.top: parent.top
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    width: view.theme.fontSize * 30
    height: downloadRows.implicitHeight + view.theme.fontSize * 2
    visible: view.downloadsOpen
    color: Qt.alpha(view.theme.panel, 1)
    border.width: 1
    border.color: view.theme.panelBorder

    Column {
      id: downloadRows
      x: view.theme.fontSize
      y: view.theme.fontSize
      width: parent.width - view.theme.fontSize * 2

      Text {
        bottomPadding: view.theme.fontSize * 0.5
        text: "Download"
        color: view.theme.muted
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }

      Repeater {
        model: Chapters.DOWNLOADS

        Text {
          id: downloadRow
          required property var modelData
          required property int index
          readonly property bool current: index === view.downloadsCursor
          width: downloadRows.width
          elide: Text.ElideRight
          text: modelData.label
          color: current ? view.theme.accent : view.theme.foreground
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize

          MouseArea {
            anchors.fill: parent
            enabled: !view.counting
            onClicked: view.downloadsCursor = downloadRow.index
            onDoubleClicked: {
              view.downloadsCursor = downloadRow.index
              view.key(Commands.enter())
            }
          }
        }
      }

      Row {
        visible: view.counting
        topPadding: view.theme.fontSize * 0.5
        spacing: view.theme.fontSize

        Text {
          text: "How many"
          color: view.theme.muted
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize
        }

        TextInput {
          id: countField
          width: view.theme.fontSize * 8
          color: view.theme.foreground
          selectionColor: view.theme.selected
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize
          Keys.onPressed: function(event) { view.key(event) }
        }
      }

      Text {
        width: parent.width
        visible: text !== ""
        topPadding: view.theme.fontSize * 0.8
        wrapMode: Text.Wrap
        text: view.downloadsNote
        color: view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }
    }
  }

  // The chapter filter and sort, drawn as the Library's panel.
  Rectangle {
    anchors.top: parent.top
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    width: view.theme.fontSize * 30
    // A manga with many scanlators scrolls the rows rather than run off.
    height: Math.min(parent.height - view.theme.fontSize * 4, options.contentHeight + note.height + view.theme.fontSize * 2)
    visible: view.optionsOpen
    color: Qt.alpha(view.theme.panel, 1)
    border.width: 1
    border.color: view.theme.panelBorder

    ListView {
      id: options
      x: view.theme.fontSize
      y: view.theme.fontSize
      width: parent.width - view.theme.fontSize * 2
      height: parent.height - note.height - view.theme.fontSize * 2
      clip: true
      model: view.optionRows
      currentIndex: view.optionsCursor
      onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)

      delegate: Column {
        id: option
        required property var modelData
        required property int index
        readonly property bool current: index === view.optionsCursor
        readonly property bool on: modelData.state !== "" && modelData.state !== "off"
        width: options.width

        Text {
          visible: option.index === 0 || option.modelData.kind !== view.optionRows[option.index - 1].kind
          topPadding: option.index === 0 ? 0 : view.theme.fontSize * 0.8
          text: ({ filter: "Filter", scanlator: "Scanlators (exclude)", sort: "Sort", "default": "Default" })[option.modelData.kind]
          color: view.theme.muted
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSmall
        }

        Text {
          width: parent.width
          elide: Text.ElideRight
          text: ({ off: "[ ] ", include: "[+] ", exclude: "[-] ", "": "    ", asc: " ↑  ", desc: " ↓  " })[option.modelData.state] + option.modelData.label
          color: option.current ? view.theme.accent : option.on || option.modelData.kind === "default" ? view.theme.foreground : view.theme.muted
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize

          MouseArea {
            anchors.fill: parent
            onClicked: view.optionsCursor = option.index
            onDoubleClicked: {
              view.optionsCursor = option.index
              view.key(Commands.enter())
            }
          }
        }
      }
    }

    Text {
      id: note
      anchors.top: options.bottom
      x: options.x
      width: options.width
      height: text === "" ? 0 : implicitHeight
      topPadding: view.theme.fontSize * 0.8
      wrapMode: Text.Wrap
      text: view.optionsNote
      color: view.theme.accent
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }
  }

  Rectangle {
    id: picker
    anchors.top: parent.top
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    width: view.theme.fontSize * 28
    height: Math.min(parent.height - view.theme.fontSize * 4, pickList.contentHeight + view.theme.fontSize * 2)
    visible: view.picking
    color: Qt.alpha(view.theme.panel, 1)
    border.width: 1
    border.color: view.theme.panelBorder

    ListView {
      id: pickList
      anchors.fill: parent
      anchors.margins: view.theme.fontSize
      clip: true
      model: view.categories
      currentIndex: view.pickCursor

      header: Text {
        width: pickList.width
        bottomPadding: view.theme.fontSize * 0.5
        wrapMode: Text.Wrap
        text: !view.manga || view.manga.inLibrary ? (view.categories.length ? "Categories" : "No categories yet. Press c in the Library to make one.") : "Add the manga to the library first: a"
        color: view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }

      delegate: Rectangle {
        id: pick
        required property var modelData
        required property int index
        readonly property bool current: index === view.pickCursor
        readonly property bool member: view.manga !== null && view.manga.categories.indexOf(modelData.id) !== -1
        width: pickList.width
        height: view.theme.fontSize * 2
        color: current ? view.theme.selected : "transparent"

        MouseArea {
          anchors.fill: parent
          onClicked: view.pickCursor = pick.index
          onDoubleClicked: {
            view.pickCursor = pick.index
            view.key(Commands.enter())
          }
        }

        Text {
          anchors.left: parent.left
          anchors.leftMargin: view.theme.fontSize * 0.5
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          elide: Text.ElideRight
          text: (pick.member ? "[x] " : "[ ] ") + pick.modelData.name
          color: pick.current ? view.theme.selectedText : pick.member ? view.theme.foreground : view.theme.muted
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize
        }
      }
    }
  }
}
