pragma ComponentBehavior: Bound

import QtQuick
import "Browse.js" as Browse

// One source's manga as a cover grid: the list header (popular, latest or
// a search), the grid with its cursor, and a notice in place of the grid
// when the list failed or came back empty. BrowseView owns the state.
Item {
  id: view

  required property Theme theme
  property var config: null
  property var listing: null
  property int cursor: 0
  property bool editing: false
  property var notice: null

  readonly property alias searchField: field
  readonly property int columns: Math.max(1, Math.floor(grid.width / grid.cellWidth))

  signal key(var event)
  signal nearEnd()
  // A click on a cover; twice: a double click.
  signal picked(int index, bool twice)

  onCursorChanged: grid.positionViewAtIndex(cursor, GridView.Contain)

  // Set here, not bound, so a page more keeps the grid's place.
  readonly property var items: listing ? listing.items : []
  onItemsChanged: {
    var y = grid.contentY
    var keep = Browse.continues(grid.model || [], items)
    grid.model = items
    if (keep) grid.contentY = y
  }

  Item {
    id: head
    anchors.top: parent.top
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    height: view.theme.fontSize * 1.6

    Text {
      id: sourceName
      anchors.verticalCenter: parent.verticalCenter
      text: view.listing ? view.listing.source.name : ""
      color: view.theme.foreground
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSize
    }

    Row {
      id: modes
      anchors.left: sourceName.right
      anchors.leftMargin: view.theme.fontSize * 2
      anchors.verticalCenter: parent.verticalCenter
      spacing: view.theme.fontSize * 1.5
      visible: !view.editing

      Repeater {
        model: [
          { mode: "popular", key: "p", label: "p popular" },
          { mode: "latest", key: "n", label: "n latest" },
          { mode: "search", key: "/", label: view.listing && view.listing.mode === "search" ? "/ " + (view.listing.query || "search") : "/ search" },
          { mode: "filters", key: "F", label: view.listing && view.listing.filters.length ? "F " + view.listing.filters.length + " filters" : "F filter" }
        ]

        Text {
          id: modeLabel
          required property var modelData
          readonly property bool on: view.listing !== null && (modelData.mode === "filters" ? view.listing.filters.length > 0 : view.listing.mode === modelData.mode)
          visible: modelData.mode !== "latest" || (view.listing && view.listing.source.supportsLatest)
          text: modelData.label
          color: on ? view.theme.accent : view.theme.muted
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSmall

          // A click presses the key the label names.
          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: view.key({ key: modeLabel.modelData.key.toUpperCase().charCodeAt(0), text: modeLabel.modelData.key, modifiers: 0 })
          }
        }
      }
    }

    Text {
      id: prompt
      anchors.left: sourceName.right
      anchors.leftMargin: view.theme.fontSize * 2
      anchors.verticalCenter: parent.verticalCenter
      visible: view.editing
      text: "search "
      color: view.theme.accent
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSize
    }

    TextInput {
      id: field
      anchors.left: prompt.right
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      visible: view.editing
      clip: true
      color: view.theme.foreground
      selectionColor: view.theme.selected
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSize
      Keys.onPressed: function(event) { view.key(event) }
    }

    Text {
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      visible: !view.editing
      text: view.listing && view.listing.state === "loading" ? "loading" : ""
      color: view.theme.muted
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }
  }

  GridView {
    id: grid
    anchors.top: head.bottom
    anchors.bottom: parent.bottom
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    visible: view.notice === null
    clip: true
    cellWidth: view.theme.fontSize * 13
    cellHeight: cellWidth * 1.5 + view.theme.fontSize * 3
    onAtYEndChanged: if (atYEnd) view.nearEnd()

    delegate: Item {
      id: cell
      required property var modelData
      required property int index
      readonly property bool current: index === view.cursor
      width: grid.cellWidth
      height: grid.cellHeight

      MouseArea {
        anchors.fill: parent
        onClicked: view.picked(cell.index, false)
        onDoubleClicked: view.picked(cell.index, true)
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

        Rectangle {
          anchors.top: parent.top
          anchors.right: parent.right
          anchors.margins: view.theme.fontSize / 3
          visible: cell.modelData.inLibrary
          width: badge.implicitWidth + view.theme.fontSize * 0.6
          height: badge.implicitHeight + view.theme.fontSize * 0.2
          color: view.theme.accent

          Text {
            id: badge
            anchors.centerIn: parent
            text: "in library"
            color: view.theme.background
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSmall
          }
        }
      }

      Text {
        anchors.top: coverBox.bottom
        anchors.topMargin: view.theme.fontSize / 2
        anchors.left: coverBox.left
        anchors.right: coverBox.right
        text: cell.modelData.title
        color: cell.current ? view.theme.selectedText : view.theme.foreground
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
        elide: Text.ElideRight
        maximumLineCount: 2
        wrapMode: Text.Wrap
      }
    }
  }

  Column {
    anchors.centerIn: grid
    width: Math.min(parent.width - view.theme.fontSize * 4, view.theme.fontSize * 50)
    spacing: view.theme.fontSize
    visible: view.notice !== null || (view.listing !== null && view.listing.items.length === 0)

    Text {
      width: parent.width
      horizontalAlignment: Text.AlignHCenter
      text: view.notice ? view.notice.title : "Loading"
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
}
