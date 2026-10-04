pragma ComponentBehavior: Bound

import QtQuick

// The Library view: the cover grid, or a notice in its place.
Item {
  id: view

  required property Theme theme
  property var manga: []
  // Model.notice(): null for the grid, otherwise { title, detail }.
  property var notice: null

  GridView {
    id: grid
    anchors.fill: parent
    anchors.margins: view.theme.fontSize * 2
    visible: view.notice === null
    clip: true
    model: view.manga
    cellWidth: view.theme.fontSize * 13
    cellHeight: cellWidth * 1.5 + view.theme.fontSize * 3

    delegate: Item {
      id: cell
      required property var modelData
      width: grid.cellWidth
      height: grid.cellHeight

      Rectangle {
        id: coverBox
        x: view.theme.fontSize / 2
        width: cell.width - view.theme.fontSize
        height: width * 1.5
        color: Qt.alpha(view.theme.foreground, 0.06)

        Image {
          anchors.fill: parent
          source: cell.modelData.cover
          fillMode: Image.PreserveAspectCrop
          asynchronous: true
          sourceSize.width: width
        }
      }

      Text {
        anchors.top: coverBox.bottom
        anchors.topMargin: view.theme.fontSize / 2
        anchors.left: coverBox.left
        anchors.right: coverBox.right
        text: cell.modelData.title
        color: view.theme.foreground
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
