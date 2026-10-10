pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import "Session.js" as Session
import "Browse.js" as Browse
import "Downloads.js" as Downloads
import "Chapters.js" as Chapters
import "Commands.js" as Commands
import "Prefs.js" as Prefs
import "NextChapters.js" as NextChapters

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
  // The library's manga (Model's entries): "save as default for every
  // manga" resets them, and adding checks them for duplicates.
  property var libraryManga: []
  readonly property var libraryIds: libraryManga.map(function(m) { return m.id })
  // The library manga a, adding, found with a similar title (Mihon's
  // possible duplicates); the panel shows while there is one.
  property var dupes: []
  property int dupesCursor: 0
  readonly property bool dupesOpen: dupes.length > 0
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
  // writing: the notes editor is open; notesNote says how its save went.
  property bool writing: false
  property string notesNote: ""
  readonly property bool editing: counting || writing
  // What the last o, y or Y did, until the next manga command.
  property string note: ""

  readonly property bool open: detail !== null
  readonly property var manga: detail ? detail.manga : null
  readonly property bool selecting: anchor >= 0
  // The chapters as listed; cursor and anchor index it. detail.chapters
  // stays in source order, newest first, for the reader.
  // The chapter choices and the excluded scanlators, as Chapters.js takes them.
  // Downloaded only forces the Downloaded filter on, as Mihon's
  // Manga.downloadedFilter does.
  property bool downloadedOnly: false
  readonly property var prefs: Prefs.force(Object.assign({}, chapterPrefs.values, scanlatorPrefs.values), "chapterFilterDownloaded", "include", downloadedOnly)
  readonly property var shown: detail ? Chapters.apply(detail.chapters, prefs) : []
  readonly property var next: Chapters.nextUnread(shown, prefs)
  readonly property string resume: detail ? Chapters.resumeLabel(detail.chapters, next) : ""
  readonly property var optionRows: Chapters.rows(prefs, detail ? Chapters.scanlators(detail.chapters) : [])
  readonly property var notice: detail ? Browse.notice(detail, configPath) : null
  readonly property string hint: dupesOpen ? "j k move   enter open   M migrate to this   a add anyway   esc cancel   "
    : picking ? "j k move   space in or out   esc close   "
    : optionsOpen ? "j k move   enter change   esc close   "
    : downloadsOpen ? "j k move   enter download   esc close   "
    : selecting ? "j k extend   R read   u unread   b bookmark   d download   x delete download   esc end   "
    : (note ? note + "   " : "") + "j k chapters   enter read   R read   u unread   P read before   b bookmark   F filter & sort   d download   v select   U download menu   x delete   D queue   " + (manga && manga.inLibrary ? "M migrate   " : "") + "c categories   t tracking   n notes   o browser   y copy link   Y copy title   / search title   r refresh   esc back   "

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
  // A text field closed; the window takes the keys back.
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

  // The download menu's last row (NextChapters.MENU_PREFS), global.
  PrefStore {
    id: menuPrefs
    config: view.config
    table: NextChapters.MENU_PREFS
  }

  function send(payload, done) {
    return Session.send(config, payload, done)
  }

  // fromSource: opened while browsing a source, so it refreshes once.
  function openManga(mangaId, fromSource) {
    dupes = []
    detail = Browse.detail(mangaId, fromSource)
    chapterPrefs.open(mangaId)
    scanlatorPrefs.open(mangaId)
    menuPrefs.load()
    cursor = 0
    detailSeq++
    advance()
  }

  function close() {
    dupes = []
    picking = false
    optionsOpen = false
    downloadsOpen = false
    endEdit()
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
      view.detail = Browse.reduceDetail(view.detail, { type: "reply", reply: reply, config: cfg, now: Date.now() })
      view.advance()
    })
  }

  // Matched by manga, not by request number: a refresh or Back while the
  // toggle is in flight must not strand it, since the server applies it.
  // force: add even with possible duplicates in the library.
  function toggleLibrary(force) {
    var payload = Browse.libraryPayload(detail)
    if (!payload) return
    if (!force && !manga.inLibrary) {
      dupes = Browse.duplicates(libraryManga, manga)
      dupesCursor = 0
      if (dupes.length) return
    }
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

  function endEdit() {
    if (!editing) return
    counting = false
    writing = false
    editEnded()
  }

  // Saved as manga meta, which the sync helper maps to Mihon's notes.
  function saveNotes() {
    var mangaId = detail.mangaId
    var text = notesField.text
    notesNote = "Saving"
    send(Prefs.savePayload("notes", text, mangaId), function(reply) {
      if (!view.detail || view.detail.mangaId !== mangaId) return
      if (reply.state !== "ok") {
        view.notesNote = reply.message || reply.state
        return
      }
      view.endEdit()
      view.reload()
    })
  }

  // Queues what the menu row picks, and closes the menu, as Mihon's does.
  // A queued chapter counts as on its way, as Mihon's download state does.
  function downloadRow(row, n) {
    var list = Chapters.toDownload(detail.chapters, prefs, skipFiltered, row, n).filter(function(c) { return !Downloads.find(view.queue, c.id) })
    if (!list.length) {
      downloadsNote = "Nothing to download"
      return
    }
    downloadsOpen = false
    sendDownloads(Downloads.enqueuePayload(list))
  }

  onWritingChanged: {
    if (!writing) return
    notesNote = ""
    notesField.text = manga.notes
    notesField.cursorPosition = notesField.length
    notesField.forceActiveFocus()
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
    note = ""
    switch (id) {
      case "manga.openWeb":
      case "manga.copyLink":
        if (!manga || !manga.url) note = "The server has no link for this manga"
        else if (id === "manga.openWeb") Quickshell.execDetached(["xdg-open", manga.url])
        else {
          Quickshell.execDetached(["wl-copy", "--", manga.url])
          note = "Link copied"
        }
        break
      case "manga.copyTitle":
        if (!manga) break
        Quickshell.execDetached(["wl-copy", "--", manga.title])
        note = "Title copied"
        break
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
        toggleLibrary(false)
        break
      case "manga.addAnyway":
        dupes = []
        toggleLibrary(true)
        break
      case "manga.duplicatesClose":
        dupes = []
        break
      case "manga.duplicatesUp":
      case "manga.duplicatesDown":
        dupesCursor = Math.max(0, Math.min(dupes.length - 1, dupesCursor + (id === "manga.duplicatesUp" ? -1 : 1)))
        break
      case "manga.duplicateOpen":
        openManga(dupes[dupesCursor].id, false)
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
        downloadsCursor = NextChapters.rowIndex(menuPrefs.values.downloadMenuManga)
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
        menuPrefs.set([{ key: "downloadMenuManga", value: NextChapters.rowKey(row) }])
        if (row.id === "next" && !row.count) counting = true
        else downloadRow(row, row.count)
        break
      case "manga.notes":
        if (manga) writing = true
        break
      case "manga.commit":
        if (writing) {
          saveNotes()
          break
        }
        var n = Chapters.count(downloadMenu.countText)
        if (!n) {
          downloadsNote = "Type a whole number above 0"
          break
        }
        endEdit()
        downloadRow(Chapters.DOWNLOADS[downloadsCursor], n)
        break
      case "manga.cancel":
        endEdit()
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

    // Mihon's notes section, Markdown. maximumLineCount does not cap
    // Markdown, so the height does: long notes must leave the chapters room.
    Text {
      width: parent.width
      height: Math.min(implicitHeight, view.theme.fontSize * 9)
      clip: true
      visible: text !== ""
      wrapMode: Text.Wrap
      textFormat: Text.MarkdownText
      text: view.manga ? view.manga.notes : ""
      color: view.theme.accent
      linkColor: view.theme.accent
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
    visible: view.optionsOpen || view.picking || view.downloadsOpen || view.writing || view.dupesOpen
  }

  // The notes editor: Markdown as typed, shown rendered on the manga.
  Rectangle {
    anchors.top: parent.top
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    width: Math.min(parent.width - view.theme.fontSize * 4, view.theme.fontSize * 44)
    height: Math.min(parent.height - view.theme.fontSize * 4, view.theme.fontSize * 20)
    visible: view.writing
    color: Qt.alpha(view.theme.panel, 1)
    border.width: 1
    border.color: view.theme.panelBorder

    Text {
      id: notesTitle
      x: view.theme.fontSize
      y: view.theme.fontSize
      width: parent.width - view.theme.fontSize * 2
      elide: Text.ElideRight
      text: "Notes" + (view.notesNote ? "   " + view.notesNote : "")
      color: view.theme.muted
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }

    Flickable {
      id: notesScroll
      anchors.top: notesTitle.bottom
      anchors.bottom: parent.bottom
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.margins: view.theme.fontSize
      clip: true
      contentHeight: notesField.contentHeight

      TextEdit {
        id: notesField
        width: notesScroll.width
        wrapMode: TextEdit.Wrap
        color: view.theme.foreground
        selectionColor: view.theme.selected
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
        onCursorRectangleChanged: {
          if (cursorRectangle.y < notesScroll.contentY) notesScroll.contentY = cursorRectangle.y
          else if (cursorRectangle.y + cursorRectangle.height > notesScroll.contentY + notesScroll.height) notesScroll.contentY = cursorRectangle.y + cursorRectangle.height - notesScroll.height
        }
        // Shift+Enter is a new line; the window takes Enter (save) and Esc.
        Keys.onPressed: function(event) {
          if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter) && (event.modifiers & Qt.ShiftModifier)) event.accepted = false
          else view.key(event)
        }
      }
    }
  }

  // Mihon's download menu.
  DownloadMenu {
    id: downloadMenu
    anchors.top: parent.top
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    visible: view.downloadsOpen
    theme: view.theme
    cursor: view.downloadsCursor
    counting: view.counting
    note: view.downloadsNote
    onMoved: function(index) { view.downloadsCursor = index }
    onKey: function(event) { view.key(event) }
  }

  // The chapter filter and sort, drawn as the Library's panel.
  Rectangle {
    anchors.top: parent.top
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    width: view.theme.fontSize * 30
    // A manga with many scanlators scrolls the rows rather than run off.
    height: Math.min(parent.height - view.theme.fontSize * 4, options.contentHeight + optionsNoteText.height + view.theme.fontSize * 2)
    visible: view.optionsOpen
    color: Qt.alpha(view.theme.panel, 1)
    border.width: 1
    border.color: view.theme.panelBorder

    ListView {
      id: options
      x: view.theme.fontSize
      y: view.theme.fontSize
      width: parent.width - view.theme.fontSize * 2
      height: parent.height - optionsNoteText.height - view.theme.fontSize * 2
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
      id: optionsNoteText
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

  // Mihon's DuplicateMangaDialog: Enter opens the library manga, M
  // migrates it to this one, a adds this one anyway.
  Rectangle {
    anchors.top: parent.top
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    width: view.theme.fontSize * 40
    height: Math.min(parent.height - view.theme.fontSize * 4, dupesHead.height + dupeList.contentHeight + dupesHint.height + view.theme.fontSize * 3)
    visible: view.dupesOpen
    color: Qt.alpha(view.theme.panel, 1)
    border.width: 1
    border.color: view.theme.panelBorder

    Text {
      id: dupesHead
      x: view.theme.fontSize
      y: view.theme.fontSize
      width: parent.width - view.theme.fontSize * 2
      bottomPadding: view.theme.fontSize * 0.5
      wrapMode: Text.Wrap
      text: "Possible duplicates. You have manga in your library with a similar name."
      color: view.theme.accent
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }

    ListView {
      id: dupeList
      anchors.top: dupesHead.bottom
      x: dupesHead.x
      width: dupesHead.width
      height: parent.height - dupesHead.height - dupesHint.height - view.theme.fontSize * 3
      clip: true
      model: view.dupes
      currentIndex: view.dupesCursor
      onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)

      delegate: Rectangle {
        id: dupe
        required property var modelData
        required property int index
        readonly property bool current: index === view.dupesCursor
        width: dupeList.width
        height: dupeText.implicitHeight + view.theme.fontSize * 0.6
        color: current ? view.theme.selected : "transparent"

        MouseArea {
          anchors.fill: parent
          onClicked: view.dupesCursor = dupe.index
          onDoubleClicked: {
            view.dupesCursor = dupe.index
            view.key(Commands.enter())
          }
        }

        Column {
          id: dupeText
          anchors.left: parent.left
          anchors.leftMargin: view.theme.fontSize * 0.5
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter

          Text {
            width: parent.width
            elide: Text.ElideRight
            text: dupe.modelData.title
            color: dupe.current ? view.theme.selectedText : view.theme.foreground
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSize
          }

          Text {
            width: parent.width
            elide: Text.ElideRight
            text: [dupe.modelData.source, dupe.modelData.author, dupe.modelData.total + (dupe.modelData.total === 1 ? " chapter" : " chapters")].filter(function(t) { return t !== "" }).join("   ")
            color: dupe.current ? view.theme.selectedText : view.theme.muted
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSmall
          }
        }
      }
    }

    HintBar {
      id: dupesHint
      anchors.top: dupeList.bottom
      anchors.topMargin: view.theme.fontSize
      x: dupesHead.x
      maxWidth: dupesHead.width
      theme: view.theme
      text: "enter open   M migrate to this   a add anyway   esc cancel"
      color: view.theme.foreground
      pixelSize: view.theme.fontSmall
      onKey: function(event) { view.key(event) }
    }
  }
}
