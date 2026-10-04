import QtQuick
import QtQuick.Shapes
import qs.Commons
import qs.Ui

// Burst and cross. The 90s manga mark, reduced to a grid.
// Rays stay red on the launcher. On the bar, rayColor defaults to color.
Item {
  id: root
  property real iconSize: Style.font.icon
  property color color: Color.foreground
  property color rayColor: color
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
        fillColor: root.rayColor
        strokeColor: "transparent"
        strokeWidth: 0
        PathSvg { path: "M 1 5 H 13 V 9 H 1 Z M 1 11 H 13 V 15 H 1 Z M 1 33 H 13 V 37 H 1 Z M 1 39 H 13 V 43 H 1 Z M 35 5 H 47 V 9 H 35 Z M 35 11 H 47 V 15 H 35 Z M 35 33 H 47 V 37 H 35 Z M 35 39 H 47 V 43 H 35 Z" }
      }
      ShapePath {
        fillColor: root.color
        strokeColor: "transparent"
        strokeWidth: 0
        PathSvg { path: "M 15 3 H 33 V 45 H 15 Z" }
      }
      ShapePath {
        fillColor: root.color
        strokeColor: "transparent"
        strokeWidth: 0
        PathSvg { path: "M 2 18 H 46 V 30 H 2 Z" }
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
