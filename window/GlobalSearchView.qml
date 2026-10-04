pragma ComponentBehavior: Bound

import QtQuick
import "GlobalSearch.js" as GlobalSearch

// A search across every source: the query field, then one row per source
// with its status and a strip of covers. BrowseView owns the state.
Item {
  id: view

  required property Theme theme
  property var search: null
  property var cursor: ({ row: 0, col: 0 })
  property bool editing: false
  property string configPath: ""

  readonly property alias searchField: field

  signal key(var event)

  onCursorChanged: groups.positionViewAtIndex(cursor.row, ListView.Contain)

  Item {
    id: head
    anchors.top: parent.top
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    height: view.theme.fontSize * 1.6

    Text {
      id: prompt
      anchors.verticalCenter: parent.verticalCenter
      text: "search every source "
      color: view.editing ? view.theme.accent : view.theme.muted
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
      anchors.left: prompt.right
      anchors.verticalCenter: parent.verticalCenter
      visible: !view.editing
      text: view.search ? view.search.query : ""
      color: view.theme.foreground
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSize
    }
  }

  ListView {
    id: groups
    anchors.top: head.bottom
    anchors.bottom: parent.bottom
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    clip: true
    spacing: view.theme.fontSize
    model: view.search ? view.search.groups : []

    delegate: Column {
      id: group
      required property var modelData
      required property int index
      readonly property bool current: index === view.cursor.row
      width: groups.width
      spacing: view.theme.fontSize * 0.4

      Rectangle {
        width: parent.width
        height: view.theme.fontSize * 2
        color: group.current ? view.theme.selected : "transparent"

        Text {
          id: name
          x: view.theme.fontSize * 0.5
          anchors.verticalCenter: parent.verticalCenter
          text: group.modelData.source.name
          color: group.current ? view.theme.selectedText : view.theme.foreground
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize
        }

        Text {
          anchors.left: name.right
          anchors.leftMargin: view.theme.fontSize
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          elide: Text.ElideRight
          text: GlobalSearch.status(group.modelData, view.configPath)
          color: ["idle", "loading", "ok"].indexOf(group.modelData.state) === -1 ? view.theme.urgent : group.current ? view.theme.selectedText : view.theme.muted
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSmall
        }
      }

      ListView {
        id: strip
        width: parent.width
        height: visible ? cellWidth * 1.5 + view.theme.fontSize * 2 : 0
        visible: group.modelData.items.length > 0
        orientation: ListView.Horizontal
        clip: true
        model: group.modelData.items
        currentIndex: group.current ? view.cursor.col : -1
        highlightFollowsCurrentItem: false
        onCurrentIndexChanged: if (currentIndex >= 0) positionViewAtIndex(currentIndex, ListView.Contain)
        readonly property real cellWidth: view.theme.fontSize * 8

        delegate: Item {
          id: cell
          required property var modelData
          required property int index
          readonly property bool current: group.current && index === view.cursor.col
          width: strip.cellWidth + view.theme.fontSize
          height: strip.height

          Cover {
            id: coverBox
            width: strip.cellWidth
            height: width * 1.5
            theme: view.theme
            source: cell.modelData.cover
            title: cell.modelData.title
            current: cell.current

            Rectangle {
              anchors.top: parent.top
              anchors.right: parent.right
              anchors.margins: view.theme.fontSize / 4
              visible: cell.modelData.inLibrary
              width: view.theme.fontSize * 0.6
              height: width
              radius: width / 2
              color: view.theme.accent
            }
          }

          Text {
            anchors.top: coverBox.bottom
            anchors.topMargin: view.theme.fontSize / 3
            width: coverBox.width
            text: cell.modelData.title
            color: cell.current ? view.theme.accent : view.theme.foreground
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSmall
            elide: Text.ElideRight
          }
        }
      }
    }
  }

  Text {
    anchors.centerIn: groups
    visible: view.search !== null && view.search.groups.length === 0
    text: "No source to search. Press esc, then tab to install an extension."
    color: view.theme.muted
    font.family: view.theme.fontFamily
    font.pixelSize: view.theme.fontSize
  }
}
