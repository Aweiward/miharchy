import QtQuick
import qs.Commons

// Offscreen stand-in for the shell's layer-shell KeyboardPanel: same API,
// drawn as an Item under its anchor so grabToImage can capture it.
Rectangle {
  id: root
  objectName: "keyboardPanelStub"

  property Item anchorItem: null
  property QtObject bar: null
  property var owner: null
  property int margin: 8
  property int padding: Style.spacing.popupPadding
  property int contentWidth: 280
  property int contentHeight: 200
  property bool open: false
  property Item focusTarget: null

  default property alias contentItem: holder.children

  function fittedContentWidth(width, cap) { return Math.round(cap > 0 ? Math.min(width, cap) : width) }
  function fittedContentHeight(implicitHeight, cap) {
    var h = implicitHeight + padding * 2
    return Math.round(cap > 0 ? Math.min(h, cap) : h)
  }

  visible: open
  width: contentWidth
  height: contentHeight
  x: anchorItem ? anchorItem.width - width : 0
  y: anchorItem ? anchorItem.height + margin : 0
  color: Color.popups.background
  border.color: Color.popups.border
  border.width: 2
  radius: Style.cornerRadius

  onOpenChanged: if (open && focusTarget) focusTarget.forceActiveFocus()

  Item {
    id: holder
    anchors.fill: parent
    anchors.margins: root.padding
  }
}
