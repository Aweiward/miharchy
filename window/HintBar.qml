pragma ComponentBehavior: Bound

import QtQuick
import "Commands.js" as Commands

// A hint line whose key parts take a click: "x remove" sends x through the
// same key path as the keyboard (Commands.hintParts decides which parts).
// It is one line as wide as its text, up to maxWidth; past that the parts
// wrap onto more lines, so every part stays in view and clickable.
Flow {
  id: bar

  required property Theme theme
  property string text: ""
  property color color: theme.muted
  property int pixelSize: theme.fontSmall
  property real maxWidth: Infinity

  signal key(var event)

  readonly property var parts: Commands.hintParts(text)

  width: Math.min(maxWidth, Math.ceil(oneLine.advanceWidth) + 1)

  TextMetrics {
    id: oneLine
    font.family: bar.theme.fontFamily
    font.pixelSize: bar.pixelSize
    text: bar.parts.map(function(p) { return p.text }).join("   ")
  }

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
