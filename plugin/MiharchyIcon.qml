import QtQuick
import QtQuick.Shapes
import qs.Commons
import qs.Ui

// Burst and cross: the bar mark from icons/mark.py (paths pasted from its output).
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
        fillRule: ShapePath.WindingFill
        strokeColor: "transparent"
        strokeWidth: 0
        PathSvg { path: "M17.5 12.3 L12.6 3.4 L13.9 2.8 L15.2 2.2 L16.5 1.7 L17.5 1.4Z M17.2 15.3 L16.7 15.8 L16.2 16.2 L15.8 16.7 L15.3 17.2 L5.5 9.5 L6.4 8.4 L7.4 7.4 L8.4 6.4 L9.5 5.5Z M1.4 17.5 L1.7 16.5 L2.2 15.2 L2.8 13.9 L3.4 12.6 L12.3 17.5Z M35.7 17.5 L44.6 12.6 L45.2 13.9 L45.8 15.2 L46.3 16.5 L46.6 17.5Z M32.7 17.2 L32.2 16.7 L31.8 16.2 L31.3 15.8 L30.8 15.3 L38.5 5.5 L39.6 6.4 L40.6 7.4 L41.6 8.4 L42.5 9.5Z M30.5 1.4 L31.5 1.7 L32.8 2.2 L34.1 2.8 L35.4 3.4 L30.5 12.3Z M30.5 35.7 L35.4 44.6 L34.1 45.2 L32.8 45.8 L31.5 46.3 L30.5 46.6Z M30.8 32.7 L31.3 32.2 L31.8 31.8 L32.2 31.3 L32.7 30.8 L42.5 38.5 L41.6 39.6 L40.6 40.6 L39.6 41.6 L38.5 42.5Z M46.6 30.5 L46.3 31.5 L45.8 32.8 L45.2 34.1 L44.6 35.4 L35.7 30.5Z M12.3 30.5 L3.4 35.4 L2.8 34.1 L2.2 32.8 L1.7 31.5 L1.4 30.5Z M15.3 30.8 L15.8 31.3 L16.2 31.8 L16.7 32.2 L17.2 32.7 L9.5 42.5 L8.4 41.6 L7.4 40.6 L6.4 39.6 L5.5 38.5Z M17.5 46.6 L16.5 46.3 L15.2 45.8 L13.9 45.2 L12.6 44.6 L17.5 35.7Z" }
      }
      ShapePath {
        fillColor: root.color
        strokeColor: "transparent"
        strokeWidth: 0
        PathSvg { path: "M20 8H28V20H40V28H28V40H20V28H8V20H20Z" }
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
