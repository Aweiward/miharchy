pragma ComponentBehavior: Bound

import QtQuick
import "Commands.js" as Commands
import "Library.js" as Library
import "Model.js" as Model
import "Prefs.js" as Prefs
import "Session.js" as Session
import "Downloads.js" as Downloads
import "Browse.js" as Browse
import "Updates.js" as Updates
import "NextChapters.js" as NextChapters

// The Library view: the category switcher with the search field and a note
// of the search, filters and sort in use, then the shown category as a cover
// grid or a list (Library.PREFS libraryDisplay) with its cursor, or a notice
// in its place, and the sort, filter and display panel or the change
// categories panel over it. The view owns its state (Library.initial()),
// its prefs and its lists, and sends its own changes to the server.
// shell.qml passes the library in, forwards the "library." commands and
// categories.back to run(), and handles read, openManga, downloadMenu,
// check, quit, mark, downloads and edited.
Item {
  id: view

  required property Theme theme
  property var config: null
  property string configPath: ""
  // Model.reduce()'s connection: the library manga and categories.
  property var connection: Model.initial()
  property bool downloadedOnly: false
  // The download queue's items, for a downloads delete.
  property var queue: []
  // The categories screen's hint, shown while that screen is.
  property string categoriesHint: ""
  property var library: Library.initial()

  // Typed copies of the fields the lists read: an int or a string signals
  // only a real change.
  readonly property int cursor: library.cursor
  // shown reads these two, and onShownChanged writes library, so they are
  // no bindings on library: reduce() sets them after each write. A binding
  // would still be updating when the "shown" event writes library.
  property int category: -1
  readonly property string screen: library.screen
  property string query: ""
  readonly property bool optionsOpen: library.options
  readonly property int optionsCursor: library.optionsCursor
  readonly property var selected: library.selected
  readonly property string armed: library.armed
  readonly property var pickIds: library.pickIds
  readonly property bool picking: pickIds.length > 0
  readonly property int pickCursor: library.pickCursor
  readonly property string note: library.note
  readonly property string error: library.error

  // The sort and filters, as server meta holds them. Downloaded only forces
  // the Downloaded filter on, as in Mihon.
  readonly property var prefs: Prefs.force(store.values, "libraryFilterDownloaded", "include", downloadedOnly)
  // Model.switcher(); one entry means no categories, so it hides.
  readonly property var switcher: Model.switcher({ manga: Library.apply(connection.manga, prefs, query), categories: connection.categories })
  readonly property int switcherIndex: Model.switcherIndex(switcher, category)
  readonly property var shown: switcher[switcherIndex]
  // switcher and switcherIndex update one after the other.
  readonly property var manga: shown ? shown.manga : []
  // The selection, or the cursor's manga with none, as on Updates.
  readonly property var targets: Updates.chosen(manga, selected, cursor)
  readonly property var targetIds: targets.map(function(m) { return m.id })
  readonly property string armedText: armed === "remove" ? "x again to remove, d with downloads" : "X again to delete downloads"
  // The change categories panel's rows, shown while picking.
  readonly property var pickRows: Library.categoryRows(connection.categories, connection.manga.filter(function(m) { return view.pickIds.indexOf(m.id) !== -1 }))
  // Model.notice(): null for the grid, otherwise { title, detail }.
  readonly property var notice: Model.notice(connection, configPath, shown, Library.narrowed(prefs, query))
  // Whether the search field is open.
  property bool editing: false
  readonly property string summary: Library.summary(prefs, editing ? "" : query)
  readonly property var optionRows: Library.rows(prefs)
  readonly property alias searchField: field

  readonly property bool listed: prefs.libraryDisplay === "list"
  // How far j and k move the cursor.
  readonly property int columns: listed ? 1 : Math.max(1, Math.floor(grid.width / grid.cellWidth))

  readonly property string scope: Library.scope(library)
  readonly property string hint: Library.hint(library, { categoriesHint: categoriesHint, targets: targets.length, prefs: prefs, tabs: switcher.length > 1 })

  signal key(var event)
  signal editEnded()
  // R and U: shell.qml's one mark path, which Updates shares.
  signal mark(var chapters, string action, var mangaIds)
  // A download mutation's reply, which carries the queue.
  signal downloads(var reply)
  // A change reached the server: shell.qml fetches the library again.
  signal edited()
  // Space: the reader opens on chapterId, not as a peek.
  signal read(var manga, var chapters, int chapterId)
  // Enter: the manga detail opens on the cursor's manga.
  signal openManga(int mangaId)
  // d: the next chapters menu opens on NextChapters.librarySet().
  signal downloadMenu(var set)
  // u: a check for new chapters of categories (null for all); shell.qml
  // calls done(started) with whether it began, a bool.
  signal check(var categories, var done)
  // Esc with no selection and no search.
  signal quit()

  // The shown category as onShownChanged last saw it.
  property var was: null
  onShownChanged: {
    reduce({ type: "shown", was: was, shown: shown })
    was = shown
  }
  // Once the rows changed too: the cursor follows its manga in the same
  // turn as the rows change, in either order.
  onCursorChanged: Qt.callLater(show)
  onListedChanged: show()

  PrefStore {
    id: store
    config: view.config
    table: Library.PREFS
    onFailed: function(reply) { view.report(reply) }
  }

  RowModel {
    id: rows
    items: view.manga
  }

  // No write when nothing changed: at start, hint's first evaluation brings
  // shown in, and a write of library then would land mid-update.
  function reduce(event) {
    var next = Library.reduce(library, event)
    if (next === library) return
    library = next
    category = library.category
    query = library.query
  }

  function send(payload, done) {
    return Session.send(config, payload, done)
  }

  function report(reply) {
    if (reply.state !== "ok") fail(reply.message || Model.problem(reply, configPath).title)
  }

  // x and X ask once; the same key again acts.
  function arm(kind, action) {
    var acts = Library.acts(library, kind)
    reduce({ type: "arm", kind: kind, ready: targets.length > 0 && !!config })
    if (acts) act(action)
  }

  // Mihon's library selection actions, on the targets: "read" and "unread"
  // mark every chapter, "delete" takes the downloads off the disk, "remove"
  // takes the manga out of the library, and "removeDeleting" does both, as
  // Mihon's remove dialog with both boxes ticked. The selection ends, as in
  // Mihon.
  function act(action) {
    var ids = targetIds
    reduce({ type: "deselect" })
    if (!ids.length || !config) return
    var remove = function() {
      view.send(Library.removePayload(ids), function(reply) {
        view.report(reply)
        view.edited()
      })
    }
    if (action === "remove") return remove()
    send(Library.chaptersPayload(ids), function(reply) {
      if (reply.state !== "ok") return view.report(reply)
      var chapters = Browse.toChapters(reply.data.chapters.nodes)
      if (action === "read" || action === "unread") return view.mark(chapters, action, ids)
      var payload = Downloads.removePayload(chapters, view.queue)
      if (action === "removeDeleting") {
        if (!payload) return remove()
        // The manga leave only once their downloads are gone.
        return view.send(payload, function(done) {
          view.downloads(done)
          if (done.state === "ok") remove()
          else view.report(done)
        })
      }
      if (!payload) {
        view.reduce({ type: "note", text: "No chapter is downloaded." })
        return
      }
      view.send(payload, function(done) {
        view.report(done)
        view.downloads(done)
        view.edited()
      })
    })
  }

  function fail(message) {
    reduce({ type: "error", message: message })
  }

  // Every key, from shell.qml's key path, before its command runs.
  function keyed(id) {
    reduce({ type: "key", id: id })
  }

  function reload() {
    store.load()
  }

  // Mihon's continue reading: the reader opens on the manga's next unread
  // chapter, by its own chapter filters and sort, without the manga detail.
  function continueReading(m) {
    if (!m.unread) return reduce({ type: "note", text: "Every chapter of " + m.title + " is read." })
    var cfg = config
    var d = Browse.detail(m.id, false)
    send(Browse.detailPayload(d), function(reply) {
      d = Browse.reduceDetail(d, { type: "reply", reply: reply, config: cfg })
      if (!d.manga) return view.fail(Browse.notice(d, view.configPath).title)
      view.send(Prefs.loadPayload(Library.CHAPTER_PREFS, m.id), function(saved) {
        var next = Library.continueChapter(d.chapters, Library.chapterPrefs(saved.state === "ok" ? saved.data : {}, view.downloadedOnly))
        if (next) view.read(d.manga, d.chapters, next.id)
        else view.reduce({ type: "note", text: "No next chapter of " + m.title + " passes its chapter filters." })
      })
    })
  }

  function show() {
    if (listed) list.positionViewAtIndex(cursor, ListView.Contain)
    else grid.positionViewAtIndex(cursor, GridView.Contain)
  }

  // A cover click moves the cursor as h, j, k and l do; a double click then
  // sends Enter. Not while the search field types. A click moves the
  // targets, so it disarms x and X as a key does.
  function point(index, twice) {
    if (editing) return
    reduce({ type: "point", index: index })
    if (twice) key(Commands.enter())
  }

  function openSearch() {
    editing = true
    field.text = query
    field.forceActiveFocus()
  }

  function closeSearch() {
    editing = false
    editEnded()
  }

  // The "library." commands and categories.back; false for the rest,
  // library.reload among them, which shell.qml runs.
  function run(id) {
    switch (id) {
      case "library.left":
      case "library.right":
      case "library.up":
      case "library.down":
        var step = ({ "library.left": -1, "library.right": 1, "library.up": -columns, "library.down": columns })[id]
        reduce({ type: "move", by: step, count: manga.length })
        break
      case "library.nextCategory":
      case "library.previousCategory":
        reduce({ type: "switch", by: id === "library.nextCategory" ? 1 : -1, switcher: switcher })
        break
      case "library.categories":
        reduce({ type: "screen", screen: "categories" })
        break
      case "categories.back":
        reduce({ type: "screen", screen: "grid" })
        break
      case "library.search":
        openSearch()
        break
      case "library.commit":
        closeSearch()
        break
      case "library.cancel":
        reduce({ type: "query", query: "" })
        closeSearch()
        break
      // Esc clears the selection, then the search; with neither, the window quits.
      case "library.clearSearch":
        if (Library.escapes(library)) reduce({ type: "escape" })
        else quit()
        break
      case "library.continue":
        if (manga[cursor] && config) continueReading(manga[cursor])
        break
      case "library.open":
        if (manga[cursor]) openManga(manga[cursor].id)
        break
      case "library.download":
        if (manga.length && config) downloadMenu(NextChapters.librarySet(shown, selected))
        reduce({ type: "deselect" })
        break
      // All is the whole library, which skips excluded categories.
      case "library.update":
        if (!config) break
        var all = shown.id === Model.ALL, name = shown.name
        check(all ? null : [shown.id], function(started) {
          view.reduce({ type: "note", text: started ? "Checking " + (all ? "the library" : name) + " for new chapters. Updates shows the progress." : "A check for new chapters is already running." })
        })
        break
      case "library.options":
        reduce({ type: "options", open: true })
        break
      case "library.optionsClose":
        reduce({ type: "options", open: false })
        break
      case "library.optionsUp":
      case "library.optionsDown":
        reduce({ type: "optionsMove", by: id === "library.optionsUp" ? -1 : 1, count: optionRows.length })
        break
      case "library.display":
        store.set([Library.toggleDisplay(prefs)])
        break
      case "library.optionsChoose":
        store.set([Library.choose(prefs, optionRows[optionsCursor])])
        break
      case "library.disarm":
        break
      case "library.select":
        if (manga[cursor]) reduce({ type: "select", id: manga[cursor].id })
        break
      case "library.selectAll":
        reduce({ type: "selectAll", manga: manga })
        break
      case "library.invert":
        reduce({ type: "invert", manga: manga })
        break
      case "library.setCategories":
        reduce({ type: "pickOpen", ids: targetIds, hasCategories: connection.categories.length > 0 })
        break
      case "library.pickUp":
      case "library.pickDown":
        reduce({ type: "pickMove", by: id === "library.pickUp" ? -1 : 1, count: pickRows.length })
        break
      case "library.remove":
        arm("remove", "remove")
        break
      case "library.removeWithDownloads":
        act("removeDeleting")
        break
      case "library.deleteDownloads":
        arm("delete", "delete")
        break
      case "library.markRead":
      case "library.markUnread":
        act(id === "library.markRead" ? "read" : "unread")
        break
      case "library.pickToggle":
        var pick = pickRows[pickCursor]
        if (pick) send(Library.categoryPayload(pick, pickIds), function(reply) {
          view.report(reply)
          view.edited()
        })
        break
      case "library.pickClose":
        reduce({ type: "pickClose" })
        break
      default:
        return false
    }
    return true
  }

  Row {
    id: names
    x: view.theme.fontSize * 2.5
    height: visible ? view.theme.fontSize * 2.5 : 0
    spacing: view.theme.fontSize * 1.5
    visible: view.switcher.length > 1 || view.editing || view.summary !== ""

    Repeater {
      model: view.switcher.length > 1 ? view.switcher : []

      Text {
        id: tabName
        textFormat: Text.PlainText
        required property var modelData
        required property int index
        anchors.bottom: parent.bottom
        text: Library.tabLabel(modelData, view.prefs, view.query)
        color: index === view.switcherIndex ? view.theme.foreground : view.theme.muted
        font.underline: index === view.switcherIndex
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall

        MouseArea {
          anchors.fill: parent
          onClicked: view.reduce({ type: "tab", id: view.switcher[tabName.index].id })
        }
      }
    }

    Text {
      textFormat: Text.PlainText
      anchors.bottom: parent.bottom
      visible: view.editing
      text: "/"
      color: view.theme.accent
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }

    TextInput {
      id: field
      anchors.bottom: parent.bottom
      width: view.theme.fontSize * 20
      visible: view.editing
      clip: true
      color: view.theme.foreground
      selectionColor: view.theme.selected
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
      onTextChanged: if (view.editing) view.reduce({ type: "query", query: text })
      Keys.onPressed: function(event) { view.key(event) }
    }

    Text {
      textFormat: Text.PlainText
      anchors.bottom: parent.bottom
      text: view.summary
      color: view.theme.accent
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }
  }

  GridView {
    id: grid
    anchors.top: names.bottom
    anchors.bottom: parent.bottom
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    anchors.topMargin: names.visible ? view.theme.fontSize : view.theme.fontSize * 2
    visible: view.notice === null && !view.listed
    clip: true
    model: view.listed ? [] : rows
    cellWidth: view.theme.fontSize * 13
    cellHeight: cellWidth * 1.5 + view.theme.fontSize * 3

    delegate: Item {
      id: cell
      required property var modelData
      required property int index
      readonly property bool current: index === view.cursor
      readonly property bool chosen: view.selected.indexOf(modelData.id) !== -1
      readonly property bool armed: view.armed !== "" && view.targetIds.indexOf(modelData.id) !== -1
      width: grid.cellWidth
      height: grid.cellHeight

      Rectangle {
        anchors.fill: parent
        visible: cell.chosen
        color: view.theme.selected
      }

      MouseArea {
        anchors.fill: parent
        onClicked: view.point(cell.index, false)
        onDoubleClicked: view.point(cell.index, true)
      }

      Cover {
        id: coverBox
        x: view.theme.fontSize / 2
        width: cell.width - view.theme.fontSize
        height: width * 1.5
        theme: view.theme
        config: view.config
        source: cell.modelData.cover
        title: cell.modelData.title
        current: cell.current
        readonly property var badges: Library.badges(cell.modelData, view.prefs)
        badge: badges.unread
        downloads: badges.downloads
        lang: badges.lang
      }

      Text {
        textFormat: Text.PlainText
        anchors.top: coverBox.bottom
        anchors.topMargin: view.theme.fontSize / 2
        anchors.left: coverBox.left
        anchors.right: coverBox.right
        text: cell.armed ? view.armedText : cell.modelData.title
        color: cell.armed ? view.theme.urgent : cell.current || cell.chosen ? view.theme.accent : view.theme.foreground
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
        elide: Text.ElideRight
        maximumLineCount: 2
        wrapMode: Text.Wrap
      }
    }
  }

  // Mihon's list: a small cover, the title with its source under it, and
  // the unread count.
  ListView {
    id: list
    anchors.fill: grid
    visible: view.notice === null && view.listed
    clip: true
    model: view.listed ? rows : []

    delegate: Rectangle {
      id: row
      required property var modelData
      required property int index
      readonly property bool current: index === view.cursor
      readonly property bool chosen: view.selected.indexOf(modelData.id) !== -1
      readonly property bool armed: view.armed !== "" && view.targetIds.indexOf(modelData.id) !== -1
      width: list.width
      height: view.theme.fontSize * 4
      color: current || chosen ? view.theme.selected : "transparent"

      MouseArea {
        anchors.fill: parent
        onClicked: view.point(row.index, false)
        onDoubleClicked: view.point(row.index, true)
      }

      Rectangle {
        visible: row.chosen
        width: view.theme.fontSize * 0.25
        height: parent.height
        color: view.theme.accent
      }

      Cover {
        id: rowCover
        x: view.theme.fontSize * 0.5
        anchors.verticalCenter: parent.verticalCenter
        height: parent.height - view.theme.fontSize * 0.6
        width: height / 1.5
        theme: view.theme
        config: view.config
        source: row.modelData.cover
        title: row.modelData.title
      }

      Column {
        anchors.left: rowCover.right
        anchors.leftMargin: view.theme.fontSize
        anchors.right: unread.left
        anchors.rightMargin: view.theme.fontSize
        anchors.verticalCenter: parent.verticalCenter

        Text {
          textFormat: Text.PlainText
          width: parent.width
          elide: Text.ElideRight
          text: row.modelData.title
          color: row.current ? view.theme.selectedText : view.theme.foreground
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize
        }

        Text {
          textFormat: Text.PlainText
          width: parent.width
          elide: Text.ElideRight
          text: row.armed ? view.armedText : row.modelData.source
          color: row.armed ? view.theme.urgent : row.current ? view.theme.selectedText : view.theme.muted
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSmall
        }
      }

      Text {
        id: unread
        textFormat: Text.PlainText
        anchors.right: parent.right
        anchors.rightMargin: view.theme.fontSize * 0.5
        anchors.verticalCenter: parent.verticalCenter
        readonly property var badges: Library.badges(row.modelData, view.prefs)
        text: [badges.lang, badges.downloads ? badges.downloads + " downloaded" : "", badges.unread ? badges.unread + " unread" : ""].filter(function(t) { return t }).join("   ")
        color: row.current ? view.theme.selectedText : view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }
    }
  }

  Column {
    anchors.centerIn: parent
    width: Math.min(parent.width - view.theme.fontSize * 4, view.theme.fontSize * 50)
    spacing: view.theme.fontSize
    visible: view.notice !== null

    Text {
      textFormat: Text.PlainText
      width: parent.width
      horizontalAlignment: Text.AlignHCenter
      text: view.notice ? view.notice.title : ""
      color: view.theme.foreground
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontHeading
    }

    Text {
      textFormat: Text.PlainText
      width: parent.width
      horizontalAlignment: Text.AlignHCenter
      wrapMode: Text.Wrap
      text: view.notice ? view.notice.detail : ""
      color: view.theme.muted
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSize
    }
  }

  // Under the open panel: a click outside it never reaches a cover, where a
  // double click's Enter would change the option under the panel's cursor.
  MouseArea {
    anchors.fill: parent
    visible: view.optionsOpen || view.picking
  }

  // Mihon's change category dialog: [x] every chosen manga is in the
  // category, [-] some are, [ ] none is.
  Rectangle {
    anchors.top: parent.top
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    width: view.theme.fontSize * 22
    height: picks.implicitHeight + view.theme.fontSize * 2
    visible: view.picking
    color: view.theme.background
    border.width: 1
    border.color: view.theme.muted

    Column {
      id: picks
      x: view.theme.fontSize
      y: view.theme.fontSize
      width: parent.width - view.theme.fontSize * 2

      Text {
        textFormat: Text.PlainText
        text: "Categories"
        color: view.theme.muted
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }

      Repeater {
        model: view.pickRows

        Text {
          id: pick
          textFormat: Text.PlainText
          required property var modelData
          required property int index
          width: picks.width
          elide: Text.ElideRight
          text: ({ all: "[x] ", some: "[-] ", none: "[ ] " })[modelData.state] + modelData.name
          color: index === view.pickCursor ? view.theme.accent : modelData.state === "none" ? view.theme.muted : view.theme.foreground
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize

          MouseArea {
            anchors.fill: parent
            onClicked: view.reduce({ type: "pickPoint", index: pick.index })
            onDoubleClicked: {
              view.reduce({ type: "pickPoint", index: pick.index })
              view.key(Commands.enter())
            }
          }
        }
      }
    }
  }

  Rectangle {
    anchors.top: parent.top
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    width: view.theme.fontSize * 22
    height: options.implicitHeight + view.theme.fontSize * 2
    visible: view.optionsOpen
    color: view.theme.background
    border.width: 1
    border.color: view.theme.muted

    Column {
      id: options
      x: view.theme.fontSize
      y: view.theme.fontSize
      width: parent.width - view.theme.fontSize * 2

      Repeater {
        model: view.optionRows

        Column {
          id: option
          required property var modelData
          required property int index
          readonly property bool current: index === view.optionsCursor
          readonly property bool on: ["", "off", "unpicked"].indexOf(modelData.state) === -1
          width: options.width

          // A heading before the first row of each kind.
          Text {
            textFormat: Text.PlainText
            visible: option.index === 0 || option.modelData.kind !== view.optionRows[option.index - 1].kind
            topPadding: option.index === 0 ? 0 : view.theme.fontSize * 0.8
            text: ({ filter: "Filter", sort: "Sort", display: "Display", badge: "Badges", tabs: "Tabs" })[option.modelData.kind]
            color: view.theme.muted
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSmall
          }

          Text {
            textFormat: Text.PlainText
            width: parent.width
            text: ({ off: "[ ] ", include: "[+] ", exclude: "[-] ", "": "    ", asc: " ↑  ", desc: " ↓  ", picked: "(•) ", unpicked: "( ) ", on: "[x] " })[option.modelData.state] + option.modelData.label
            color: option.current ? view.theme.accent : option.on ? view.theme.foreground : view.theme.muted
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSize

            MouseArea {
              anchors.fill: parent
              onClicked: view.reduce({ type: "optionsPoint", index: option.index })
              onDoubleClicked: {
                view.reduce({ type: "optionsPoint", index: option.index })
                view.key(Commands.enter())
              }
            }
          }
        }
      }
    }
  }
}
