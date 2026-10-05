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
  // Downloaded chapters, before the unread count, and the source's
  // language, top-right, as Mihon's badges; 0 and "" show nothing.
  property int downloads: 0
  property string lang: ""

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

  Row {
    x: cover.border.width + cover.theme.fontSize * 0.3
    spacing: cover.theme.fontSize * 0.2
    y: cover.border.width + cover.theme.fontSize * 0.3

    Repeater {
      model: [
        { text: cover.downloads > 0 ? String(cover.downloads) : "", color: cover.theme.foreground },
        { text: cover.badge > 0 ? String(cover.badge) : "", color: cover.theme.accent }
      ]

      Badge {
        required property var modelData
        theme: cover.theme
        text: modelData.text
        color: modelData.color
      }
    }
  }

  Badge {
    anchors.right: parent.right
    anchors.rightMargin: cover.border.width + cover.theme.fontSize * 0.3
    y: cover.border.width + cover.theme.fontSize * 0.3
    theme: cover.theme
    text: cover.lang
    color: cover.theme.foreground
  }

  component Badge: Rectangle {
    id: badgeBox
    required property Theme theme
    property alias text: label.text
    visible: text !== ""
    width: visible ? Math.max(height, label.implicitWidth + theme.fontSize * 0.6) : 0
    height: label.implicitHeight + theme.fontSize * 0.2
    radius: height / 4

    Text {
      id: label
      anchors.centerIn: parent
      color: badgeBox.theme.background
      font.family: badgeBox.theme.fontFamily
      font.pixelSize: badgeBox.theme.fontSmall
      font.bold: true
    }
  }
}
