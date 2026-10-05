pragma ComponentBehavior: Bound

import QtQuick
import "Model.js" as Model

// A manga cover. With no cover URL, or one that fails to load, it shows
// the title on a themed tile instead.
Rectangle {
  id: cover

  required property Theme theme
  property var config: null
  property string source: ""
  property string title: ""
  property bool current: false
  // Unread chapters, shown top-left like Mihon; 0 shows nothing.
  property int badge: 0

  color: Qt.alpha(theme.foreground, 0.06)
  border.width: current ? 2 : 0
  border.color: theme.accent
  clip: true

  ServerImage {
    id: image
    anchors.fill: parent
    anchors.margins: cover.border.width
    visible: !placeholder.visible
    config: cover.config
    url: cover.source
    fillMode: Image.PreserveAspectCrop
    asynchronous: true
    sourceSize.width: width
  }

  Text {
    id: placeholder
    anchors.fill: parent
    anchors.margins: Math.min(cover.theme.fontSize * 0.5, cover.width / 10)
    visible: Model.placeholder(cover.source, image.failed)
    text: cover.title
    color: cover.theme.muted
    font.family: cover.theme.fontFamily
    font.pixelSize: cover.width < cover.theme.fontSize * 6 ? cover.theme.fontSmall * 0.7 : cover.theme.fontSmall
    horizontalAlignment: Text.AlignHCenter
    verticalAlignment: Text.AlignVCenter
    wrapMode: Text.Wrap
    elide: Text.ElideRight
  }

  Rectangle {
    x: cover.border.width + cover.theme.fontSize * 0.3
    y: cover.border.width + cover.theme.fontSize * 0.3
    visible: cover.badge > 0
    width: Math.max(height, count.implicitWidth + cover.theme.fontSize * 0.6)
    height: count.implicitHeight + cover.theme.fontSize * 0.2
    radius: height / 4
    color: cover.theme.accent

    Text {
      id: count
      anchors.centerIn: parent
      text: cover.badge
      color: cover.theme.background
      font.family: cover.theme.fontFamily
      font.pixelSize: cover.theme.fontSmall
      font.bold: true
    }
  }
}
