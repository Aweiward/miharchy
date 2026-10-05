pragma ComponentBehavior: Bound

import QtQuick
import "Commands.js" as Commands

// A hint line whose key parts take a click: "x remove" sends x through the
// same key path as the keyboard (Commands.hintParts decides which parts).
Row {
  id: bar

  required property Theme theme
  property string text: ""
  property color color: theme.muted
  property int pixelSize: theme.fontSmall

  signal key(var event)

  readonly property var parts: Commands.hintParts(text)

  Repeater {
    model: bar.parts

    Text {
      id: part
      required property var modelData
      required property int index
      text: modelData.text + (index < bar.parts.length - 1 ? "   " : "")
      color: area.containsMouse ? bar.theme.foreground : bar.color
      font.family: bar.theme.fontFamily
      font.pixelSize: bar.pixelSize

      MouseArea {
        id: area
        anchors.fill: parent
        enabled: part.modelData.key !== null
        hoverEnabled: true
        cursorShape: part.modelData.key !== null ? Qt.PointingHandCursor : Qt.ArrowCursor
        onClicked: bar.key(Object.assign({}, part.modelData.key))
      }
    }
  }
}
