import QtQuick
import Quickshell
import qs.Commons

// Hosts the real plugin/Mark.qml in a mock strip of an Omarchy bar, offscreen,
// and grabs the bar, then the bar with the popup open.
ShellRoot {
  id: root
  readonly property string out: Quickshell.env("SHOT")
  property int step: 0

  QtObject {
    id: fakeBar
    property color foreground: Color.foreground
    property color barForeground: Color.foreground
    property color background: Color.bar.background
    property color urgent: Color.urgent
    property string fontFamily: Style.font.family
    property string position: "top"
    property bool vertical: false
    property int barSize: Style.bar.sizeHorizontal
    property bool foregroundAnimationEnabled: false
    property var activePopout: null
    function showTooltip(t, s) {}
    function hideTooltip(t) {}
    function registerClickTarget(t) {}
    function unregisterClickTarget(t) {}
    function requestPopout(o) { activePopout = o }
    function releasePopout(o) { activePopout = null }
    function run(c) {}
  }

  FloatingWindow {
    implicitWidth: 760
    implicitHeight: 720
    color: Color.background

    Item {
      id: scene
      anchors.fill: parent

      Rectangle { anchors.fill: parent; color: Color.background }

      Rectangle {
        id: barRect
        width: parent.width
        height: fakeBar.barSize
        color: Color.bar.background

        Row {
          x: 12
          spacing: 12
          anchors.verticalCenter: parent.verticalCenter
          Repeater {
            model: 5
            Text {
              required property int index
              text: String(index + 1)
              color: index === 1 ? Color.foreground : Color.muted
              font.family: Style.font.family
              font.pixelSize: Style.font.bodySmall
            }
          }
        }

        Text {
          anchors.centerIn: parent
          text: "Monday 11:42"
          color: Color.foreground
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
        }

        Loader {
          id: mark
          anchors.right: tray.left
          anchors.rightMargin: 14
          height: parent.height
          source: "file://" + Quickshell.env("CLONE") + "/plugin/Mark.qml"
          onLoaded: item.bar = fakeBar
        }

        Text {
          id: tray
          anchors.right: parent.right
          anchors.rightMargin: 12
          anchors.verticalCenter: parent.verticalCenter
          text: "󰕾   󰤨   󰁹"
          color: Color.foreground
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
        }
      }
    }
  }

  Timer {
    interval: 1000
    repeat: true
    running: true
    onTriggered: {
      var m = mark.item
      root.step++
      if (!m) return
      console.log("HARNESS step=" + root.step + " count=" + m.mark.count + " rows=" + m.mark.rows.length)
      if (root.step === 6) scene.grabToImage(function(r) { r.saveToFile(root.out + "-bar.png") })
      if (root.step === 7) m.open()
      if (root.step === 10) scene.grabToImage(function(r) { r.saveToFile(root.out + "-popup.png") })
      if (root.step === 11) Qt.quit()
    }
  }
}
