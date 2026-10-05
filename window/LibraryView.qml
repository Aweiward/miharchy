pragma ComponentBehavior: Bound

import QtQuick

// The Library view: the category switcher, then the shown category's cover
// grid with its cursor, or a notice in its place. shell.qml owns the cursor
// and the shown category.
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

  readonly property int columns: Math.max(1, Math.floor(grid.width / grid.cellWidth))

  onCursorChanged: grid.positionViewAtIndex(cursor, GridView.Contain)

  Row {
    id: names
    x: view.theme.fontSize * 2.5
    height: view.switcher.length > 1 ? view.theme.fontSize * 2.5 : 0
    spacing: view.theme.fontSize * 1.5
    visible: view.switcher.length > 1

    Repeater {
      model: view.switcher

      Text {
        required property var modelData
        required property int index
        anchors.bottom: parent.bottom
        text: modelData.name
        color: index === view.switcherIndex ? view.theme.foreground : view.theme.muted
        font.underline: index === view.switcherIndex
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }
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
    visible: view.notice === null
    clip: true
    model: view.manga
    cellWidth: view.theme.fontSize * 13
    cellHeight: cellWidth * 1.5 + view.theme.fontSize * 3

    delegate: Item {
      id: cell
      required property var modelData
      required property int index
      readonly property bool current: index === view.cursor
      width: grid.cellWidth
      height: grid.cellHeight

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
        badge: cell.modelData.unread
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
}
