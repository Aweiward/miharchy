pragma ComponentBehavior: Bound

import QtQuick
import "Commands.js" as Commands

// The `:` command palette. Its field sends every key to `key` first, so the
// window's one dispatcher decides what Esc, Enter and the arrows do.
Rectangle {
  id: pal

  required property Theme theme
  readonly property var rows: Commands.paletteRows(field.text)
  property int cursor: 0

  signal key(var event)

  function open() {
    field.text = ""
    cursor = 0
    field.forceActiveFocus()
  }

  function currentRow() {
    return rows[cursor] || null
  }

  color: theme.scrim
  onRowsChanged: cursor = 0

  // A click outside the box closes the palette, as Esc does.
  MouseArea {
    anchors.fill: parent
    onClicked: pal.key({ key: Commands.KEY.Escape, text: "\u001b", modifiers: 0 })
  }

  Rectangle {
    id: box
    anchors.horizontalCenter: parent.horizontalCenter
    y: parent.height * 0.18
    width: Math.min(parent.width - pal.theme.fontSize * 4, pal.theme.fontSize * 40)
    height: content.height + pal.theme.fontSize * 1.5
    color: pal.theme.panel
    border.color: pal.theme.panelBorder
    border.width: 1

    MouseArea {
      anchors.fill: parent
    }

    Column {
      id: content
      anchors.top: parent.top
      anchors.topMargin: pal.theme.fontSize * 0.75
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.margins: pal.theme.fontSize * 0.75

      Row {
        width: parent.width
        height: pal.theme.fontSize * 2.4
        spacing: pal.theme.fontSize / 2

        Text {
          anchors.verticalCenter: parent.verticalCenter
          text: ":"
          color: pal.theme.accent
          font.family: pal.theme.fontFamily
          font.pixelSize: pal.theme.fontSize
        }

        TextInput {
          id: field
          anchors.verticalCenter: parent.verticalCenter
          width: parent.width - pal.theme.fontSize * 2
          color: pal.theme.foreground
          selectionColor: pal.theme.selected
          font.family: pal.theme.fontFamily
          font.pixelSize: pal.theme.fontSize
          Keys.onPressed: function(event) { pal.key(event) }
        }
      }

      Repeater {
        model: pal.rows

        Rectangle {
          id: row
          required property var modelData
          required property int index
          readonly property bool current: index === pal.cursor
          width: content.width
          height: pal.theme.fontSize * 2.2
          color: current ? pal.theme.selected : "transparent"

          MouseArea {
            anchors.fill: parent
            onClicked: pal.cursor = row.index
            onDoubleClicked: {
              pal.cursor = row.index
              pal.key(Commands.enter())
            }
          }

          Text {
            anchors.left: parent.left
            anchors.leftMargin: pal.theme.fontSize * 0.75
            anchors.verticalCenter: parent.verticalCenter
            text: row.modelData.title
            color: row.current ? pal.theme.selectedText : pal.theme.foreground
            font.family: pal.theme.fontFamily
            font.pixelSize: pal.theme.fontSize
          }

          Text {
            anchors.right: parent.right
            anchors.rightMargin: pal.theme.fontSize * 0.75
            anchors.verticalCenter: parent.verticalCenter
            text: row.modelData.keys.join(" ")
            color: row.current ? pal.theme.selectedText : pal.theme.muted
            font.family: pal.theme.fontFamily
            font.pixelSize: pal.theme.fontSmall
          }
        }
      }

      Text {
        visible: pal.rows.length === 0
        width: content.width
        height: pal.theme.fontSize * 2.2
        verticalAlignment: Text.AlignVCenter
        leftPadding: pal.theme.fontSize * 0.75
        text: "No matching command"
        color: pal.theme.muted
        font.family: pal.theme.fontFamily
        font.pixelSize: pal.theme.fontSize
      }
    }
  }
}
