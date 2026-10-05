pragma ComponentBehavior: Bound

import QtQuick
import "Commands.js" as Commands
import "Library.js" as Library

// The Library view: the category switcher with the search field and a note
// of the search, filters and sort in use, then the shown category as a cover
// grid or a list (Library.PREFS libraryDisplay) with its cursor, or a notice
// in its place, and the sort, filter and display panel over it. shell.qml owns the cursor, the shown category, the search
// and the choices.
Item {
  id: view

  required property Theme theme
  property var config: null
  // Model.switcher(); one entry means no categories, so it hides.
  property var switcher: []
  property int switcherIndex: 0
  // switcher and switcherIndex update one after the other.
  readonly property var manga: switcher[switcherIndex] ? switcher[switcherIndex].manga : []
  property int cursor: 0
  // The id of the manga a second x removes, or -1.
  property int armed: -1
  // Model.notice(): null for the grid, otherwise { title, detail }.
  property var notice: null
  // Prefs values for Library.PREFS, and the search text.
  property var prefs: ({})
  property string query: ""
  property bool optionsOpen: false
  property int optionsCursor: 0
  // Whether the search field is open.
  property bool editing: false
  readonly property string summary: Library.summary(prefs, editing ? "" : query)
  readonly property var optionRows: Library.rows(prefs)
  readonly property alias searchField: field

  readonly property bool listed: prefs.libraryDisplay === "list"
  // How far j and k move the cursor.
  readonly property int columns: listed ? 1 : Math.max(1, Math.floor(grid.width / grid.cellWidth))

  signal key(var event)
  signal editEnded()
  signal searched(string text)
  // A click puts shell.qml's cursor, category or options cursor there.
  signal picked(int index)
  signal categoryPicked(int index)
  signal optionPicked(int index)

  onCursorChanged: show()
  onListedChanged: show()

  function show() {
    if (listed) list.positionViewAtIndex(cursor, ListView.Contain)
    else grid.positionViewAtIndex(cursor, GridView.Contain)
  }

  // A cover click moves the cursor as h, j, k and l do; a double click then
  // sends Enter. Not while the search field types.
  function point(index, twice) {
    if (editing) return
    picked(index)
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
          onClicked: view.categoryPicked(tabName.index)
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
      onTextChanged: if (view.editing) view.searched(text)
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
    model: view.listed ? [] : view.manga
    cellWidth: view.theme.fontSize * 13
    cellHeight: cellWidth * 1.5 + view.theme.fontSize * 3

    delegate: Item {
      id: cell
      required property var modelData
      required property int index
      readonly property bool current: index === view.cursor
      width: grid.cellWidth
      height: grid.cellHeight

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
        readonly property bool armed: view.armed === cell.modelData.id
        anchors.top: coverBox.bottom
        anchors.topMargin: view.theme.fontSize / 2
        anchors.left: coverBox.left
        anchors.right: coverBox.right
        text: armed ? "x again to remove from library" : cell.modelData.title
        color: armed ? view.theme.urgent : cell.current ? view.theme.accent : view.theme.foreground
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
    model: view.listed ? view.manga : []

    delegate: Rectangle {
      id: row
      required property var modelData
      required property int index
      readonly property bool current: index === view.cursor
      readonly property bool armed: view.armed === modelData.id
      width: list.width
      height: view.theme.fontSize * 4
      color: current ? view.theme.selected : "transparent"

      MouseArea {
        anchors.fill: parent
        onClicked: view.point(row.index, false)
        onDoubleClicked: view.point(row.index, true)
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
          text: row.armed ? "x again to remove from library" : row.modelData.source
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
    visible: view.optionsOpen
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
              onClicked: view.optionPicked(option.index)
              onDoubleClicked: {
                view.optionPicked(option.index)
                view.key(Commands.enter())
              }
            }
          }
        }
      }
    }
  }
}
