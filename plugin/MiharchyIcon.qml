import QtQuick
import QtQuick.Shapes
import qs.Commons
import qs.Ui

// 見. The eye is a window; the right stroke is the kick of 見本.
// One color, sharp miters. Recolor legColor while a sync is running.
Item {
  id: root
  property real iconSize: Style.font.icon
  property color color: Color.foreground
  property color legColor: color
  property color badgeColor: Color.urgent
  property bool warning: false

  width: iconSize
  height: iconSize
  implicitWidth: iconSize
  implicitHeight: iconSize

  Item {
    width: 48
    height: 48
    scale: root.iconSize / 48
    transformOrigin: Item.TopLeft

    Shape {
      anchors.fill: parent
      preferredRendererType: Shape.CurveRenderer

      ShapePath {
        fillColor: root.color
        strokeColor: "transparent"
        strokeWidth: 0
        fillRule: ShapePath.OddEvenFill
        PathSvg { path: "M 7 3 H 41 V 33 H 7 Z M 13 11 H 35 V 17 H 13 Z M 13 19 H 35 V 25 H 13 Z" }
      }
      ShapePath {
        fillColor: root.legColor
        strokeColor: "transparent"
        strokeWidth: 0
        PathSvg { path: "M 13 31 H 19 V 44 H 13 Z" }
      }
      ShapePath {
        fillColor: root.legColor
        strokeColor: "transparent"
        strokeWidth: 0
        PathSvg { path: "M 27 31 H 33 V 33 L 42 42 H 36 L 27 33 Z" }
      }
    }
  }

  BorderSurface {
    visible: root.warning
    width: Math.max(7, parent.width * 0.38)
    height: width
    radius: 0
    color: root.badgeColor
    anchors.right: parent.right
    anchors.bottom: parent.bottom
    borderSpec: Border.flat(Color.popups.background, 1)
    Text {
      anchors.centerIn: parent
      text: "!"
      color: Color.background
      font.family: Style.font.family
      font.pixelSize: Math.max(6, parent.height * 0.72)
      font.bold: true
    }
  }
}
