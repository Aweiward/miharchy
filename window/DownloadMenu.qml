pragma ComponentBehavior: Bound

import QtQuick
import "Chapters.js" as Chapters
import "Commands.js" as Commands

// Mihon's download menu (Chapters.DOWNLOADS), for one manga (MangaDetail.qml)
// or a set of manga (NextChaptersMenu.qml). The owner keeps the cursor and the
// note; counting opens the number field, whose keys go to key().
Rectangle {
  id: menu

  required property Theme theme
  property string title: "Download"
  property int cursor: 0
  property bool counting: false
  property string note: ""
  readonly property string countText: countField.text

  // A click puts the cursor on a row; a double click also sends Enter.
  signal moved(int index)
  signal key(var event)

  width: theme.fontSize * 30
  height: rows.implicitHeight + theme.fontSize * 2
  color: Qt.alpha(theme.panel, 1)
  border.width: 1
  border.color: theme.panelBorder

  onCountingChanged: {
    if (!counting) return
    countField.text = ""
    countField.forceActiveFocus()
  }

  Column {
    id: rows
    x: menu.theme.fontSize
    y: menu.theme.fontSize
    width: parent.width - menu.theme.fontSize * 2

    Text {
      width: parent.width
      elide: Text.ElideRight
      bottomPadding: menu.theme.fontSize * 0.5
      text: menu.title
      color: menu.theme.muted
      font.family: menu.theme.fontFamily
      font.pixelSize: menu.theme.fontSmall
    }

    Repeater {
      model: Chapters.DOWNLOADS

      Text {
        id: downloadRow
        required property var modelData
        required property int index
        readonly property bool current: index === menu.cursor
        width: rows.width
        elide: Text.ElideRight
        text: modelData.label
        color: current ? menu.theme.accent : menu.theme.foreground
        font.family: menu.theme.fontFamily
        font.pixelSize: menu.theme.fontSize

        MouseArea {
          anchors.fill: parent
          enabled: !menu.counting
          onClicked: menu.moved(downloadRow.index)
          onDoubleClicked: {
            menu.moved(downloadRow.index)
            menu.key(Commands.enter())
          }
        }
      }
    }

    Row {
      visible: menu.counting
      topPadding: menu.theme.fontSize * 0.5
      spacing: menu.theme.fontSize

      Text {
        text: "How many"
        color: menu.theme.muted
        font.family: menu.theme.fontFamily
        font.pixelSize: menu.theme.fontSize
      }

      TextInput {
        id: countField
        width: menu.theme.fontSize * 8
        color: menu.theme.foreground
        selectionColor: menu.theme.selected
        font.family: menu.theme.fontFamily
        font.pixelSize: menu.theme.fontSize
        Keys.onPressed: function(event) { menu.key(event) }
      }
    }

    Text {
      width: parent.width
      visible: text !== ""
      topPadding: menu.theme.fontSize * 0.8
      wrapMode: Text.Wrap
      text: menu.note
      color: menu.theme.accent
      font.family: menu.theme.fontFamily
      font.pixelSize: menu.theme.fontSmall
    }
  }
}
