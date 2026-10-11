pragma ComponentBehavior: Bound

import QtQuick
import "Commands.js" as Commands
import "Library.js" as Library
import "Model.js" as Model
import "Prefs.js" as Prefs
import "Updates.js" as Updates

// The Library view: the category switcher with the search field and a note
// of the search, filters and sort in use, then the shown category as a cover
// grid or a list (Library.PREFS libraryDisplay) with its cursor, or a notice
// in its place, and the sort, filter and display panel or the change
// categories panel over it. The view owns its state (Library.initial()),
// its prefs and its lists; shell.qml passes the library in and forwards the
// "library." commands to run().
Item {
  id: view

  required property Theme theme
  property var config: null
  property string configPath: ""
  // Model.reduce()'s connection: the library manga and categories.
  property var connection: Model.initial()
  property bool downloadedOnly: false
  // The categories screen's hint, shown while that screen is.
  property string categoriesHint: ""
  property var library: Library.initial()

  // Typed copies of the fields the lists read: an int or a string signals
  // only a real change, so a write to library that leaves them alone does
  // not rebuild the switcher, which would run onShownChanged again.
  readonly property int cursor: library.cursor
  readonly property int category: library.category
  readonly property string screen: library.screen
  readonly property string query: library.query
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

  readonly property string hint: screen === "categories" ? categoriesHint
    : picking ? "j k move   enter in or out   esc close   "
    : optionsOpen ? "j k move   enter change   esc close   "
    : note ? note + "   "
    : armed === "remove" ? "x again to remove " + Library.count(targets.length) + " from the library   d also delete the downloads   esc keep   "
    : armed === "delete" ? "X again to delete the downloads of " + Library.count(targets.length) + ", any other key keeps them   "
    : (error ? error + "   " : "") + (selected.length
      ? selected.length + " selected   v select   A all   I invert   R read   U unread   d download   X delete downloads   C categories   x remove   esc clear   "
      : "enter open   space read   v select   x remove   " + (query ? "esc clear search   " : "/ search   ") + "F sort & filter   " + (prefs.libraryDisplay === "list" ? "L grid   " : "L list   ") + (switcher.length > 1 ? "tab category   " : "") + "u update   c categories   D queue   s sync   ")

  signal key(var event)
  signal editEnded()

  // The cursor stays on its manga when rows move or leave, or goes to the
  // nearest one when its own leaves; another category starts at the top.
  onShownChanged: assign({
    cursor: library.was && library.was.id === shown.id ? Model.follow(library.was.manga, shown.manga, library.cursor) : 0,
    was: shown,
    selected: Updates.keep(library.selected, shown.manga)
  })
  // Once the rows changed too: the cursor follows its manga in the same
  // turn as the rows change, in either order.
  onCursorChanged: Qt.callLater(show)
  onListedChanged: show()

  PrefStore {
    id: store
    config: view.config
    table: Library.PREFS
    onFailed: function(reply) { view.fail(reply.message || Model.problem(reply, view.configPath).title) }
  }

  RowModel {
    id: rows
    items: view.manga
  }

  // ponytail: a plain write until Library.reduce takes these events (#314, #315).
  function assign(changes) {
    library = Object.assign({}, library, changes)
  }

  function fail(message) {
    assign({ error: message })
  }

  function reload() {
    store.load()
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
    assign({ armed: "", cursor: index })
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

  // The "library." commands that stay inside the view; false for the rest,
  // which shell.qml runs.
  function run(id) {
    switch (id) {
      case "library.left":
      case "library.right":
      case "library.up":
      case "library.down":
        var step = ({ "library.left": -1, "library.right": 1, "library.up": -columns, "library.down": columns })[id]
        assign({ cursor: Math.max(0, Math.min(manga.length - 1, cursor + step)) })
        break
      case "library.nextCategory":
      case "library.previousCategory":
        assign({ category: switcher[Commands.moveCursor(switcherIndex, id === "library.nextCategory" ? 1 : -1, switcher.length)].id })
        break
      case "library.categories":
        assign({ screen: "categories" })
        break
      case "categories.back":
        assign({ screen: "grid" })
        break
      case "library.search":
        openSearch()
        break
      case "library.commit":
        closeSearch()
        break
      case "library.cancel":
        assign({ query: "" })
        closeSearch()
        break
      // Esc clears the selection, then the search; with neither, shell.qml quits.
      case "library.clearSearch":
        if (selected.length) assign({ selected: [] })
        else if (query) assign({ query: "" })
        else return false
        break
      case "library.options":
        assign({ options: true })
        break
      case "library.optionsClose":
        assign({ options: false })
        break
      case "library.optionsUp":
      case "library.optionsDown":
        assign({ optionsCursor: Commands.moveCursor(optionsCursor, id === "library.optionsUp" ? -1 : 1, optionRows.length) })
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
        if (manga[cursor]) assign({ selected: Updates.toggle(selected, manga[cursor].id) })
        break
      case "library.selectAll":
        assign({ selected: manga.map(function(m) { return m.id }) })
        break
      case "library.invert":
        assign({ selected: Updates.invert(selected, manga) })
        break
      case "library.setCategories":
        if (!connection.categories.length) assign({ note: "No categories yet. Press c to make one." })
        else if (targets.length) assign({ pickIds: targetIds, pickCursor: 0 })
        break
      case "library.pickUp":
      case "library.pickDown":
        assign({ pickCursor: Math.max(0, Math.min(pickRows.length - 1, pickCursor + (id === "library.pickUp" ? -1 : 1))) })
        break
      case "library.pickClose":
        assign({ pickIds: [], selected: [] })
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
          onClicked: view.assign({ armed: "", category: view.switcher[tabName.index].id })
        }
      }
    }

    Text {
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
      onTextChanged: if (view.editing) view.assign({ query: text })
      Keys.onPressed: function(event) { view.key(event) }
    }

    Text {
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
          width: parent.width
          elide: Text.ElideRight
          text: row.modelData.title
          color: row.current ? view.theme.selectedText : view.theme.foreground
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize
        }

        Text {
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
      width: parent.width
      horizontalAlignment: Text.AlignHCenter
      text: view.notice ? view.notice.title : ""
      color: view.theme.foreground
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontHeading
    }

    Text {
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
        text: "Categories"
        color: view.theme.muted
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }

      Repeater {
        model: view.pickRows

        Text {
          id: pick
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
            onClicked: view.assign({ pickCursor: pick.index })
            onDoubleClicked: {
              view.assign({ pickCursor: pick.index })
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
            visible: option.index === 0 || option.modelData.kind !== view.optionRows[option.index - 1].kind
            topPadding: option.index === 0 ? 0 : view.theme.fontSize * 0.8
            text: ({ filter: "Filter", sort: "Sort", display: "Display", badge: "Badges", tabs: "Tabs" })[option.modelData.kind]
            color: view.theme.muted
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSmall
          }

          Text {
            width: parent.width
            text: ({ off: "[ ] ", include: "[+] ", exclude: "[-] ", "": "    ", asc: " ↑  ", desc: " ↓  ", picked: "(•) ", unpicked: "( ) ", on: "[x] " })[option.modelData.state] + option.modelData.label
            color: option.current ? view.theme.accent : option.on ? view.theme.foreground : view.theme.muted
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSize

            MouseArea {
              anchors.fill: parent
              onClicked: view.assign({ optionsCursor: option.index })
              onDoubleClicked: {
                view.assign({ optionsCursor: option.index })
                view.key(Commands.enter())
              }
            }
          }
        }
      }
    }
  }
}
