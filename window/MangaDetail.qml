pragma ComponentBehavior: Bound

import QtQuick

// A manga's detail: cover and metadata beside the chapter list, newest
// first. BrowseView owns the state; this file only draws it.
Item {
  id: view

  required property Theme theme
  property var detail: null
  property int cursor: 0
  property var notice: null

  readonly property var manga: detail ? detail.manga : null

  onCursorChanged: chapters.positionViewAtIndex(cursor, ListView.Contain)

  Rectangle {
    id: coverBox
    anchors.top: parent.top
    anchors.left: parent.left
    anchors.margins: view.theme.fontSize * 2
    width: view.theme.fontSize * 16
    height: width * 1.5
    color: Qt.alpha(view.theme.foreground, 0.06)

    Image {
      anchors.fill: parent
      source: view.manga ? view.manga.cover : ""
      fillMode: Image.PreserveAspectCrop
      asynchronous: true
      sourceSize.width: width
    }
  }

  Column {
    id: info
    anchors.top: parent.top
    anchors.left: coverBox.right
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    spacing: view.theme.fontSize * 0.5

    Text {
      width: parent.width
      wrapMode: Text.Wrap
      text: view.manga ? view.manga.title : "Loading"
      color: view.theme.foreground
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontHeading
    }

    Text {
      width: parent.width
      wrapMode: Text.Wrap
      visible: text !== ""
      text: {
        if (!view.manga) return ""
        var people = [view.manga.author, view.manga.artist].filter(function(p, i, all) { return p && all.indexOf(p) === i })
        return people.join(", ")
      }
      color: view.theme.muted
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSize
    }

    Text {
      width: parent.width
      wrapMode: Text.Wrap
      text: view.manga ? [view.manga.status, view.manga.source].filter(function(s) { return s }).join("   ") : ""
      color: view.theme.muted
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }

    Text {
      width: parent.width
      wrapMode: Text.Wrap
      visible: text !== ""
      text: view.manga ? view.manga.genres : ""
      color: view.theme.muted
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }

    Text {
      text: !view.manga ? "" : view.detail.busy ? "saving" : view.manga.inLibrary ? "In library   a remove" : "a add to library"
      color: view.manga && view.manga.inLibrary ? view.theme.accent : view.theme.foreground
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSize
    }

    Text {
      width: parent.width
      wrapMode: Text.Wrap
      visible: text !== ""
      text: view.detail && view.detail.libraryError ? view.detail.libraryError : view.notice ? view.notice.title + ". " + view.notice.detail : ""
      color: view.theme.urgent
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }

    Text {
      width: parent.width
      wrapMode: Text.Wrap
      maximumLineCount: 6
      elide: Text.ElideRight
      text: view.manga ? view.manga.description : ""
      color: view.theme.foreground
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }
  }

  ListView {
    id: chapters
    anchors.top: (info.height > coverBox.height ? info : coverBox).bottom
    anchors.bottom: parent.bottom
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    clip: true
    model: view.detail ? view.detail.chapters : []

    header: Text {
      bottomPadding: view.theme.fontSize * 0.5
      text: view.detail ? (view.detail.state === "loading" ? "Loading chapters" : view.detail.chapters.length + " chapters") : ""
      color: view.theme.accent
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }

    delegate: Rectangle {
      id: row
      required property var modelData
      required property int index
      readonly property bool current: index === view.cursor
      width: chapters.width
      height: view.theme.fontSize * 2
      color: current ? view.theme.selected : "transparent"

      Text {
        anchors.left: parent.left
        anchors.leftMargin: view.theme.fontSize * 0.5
        anchors.right: meta.left
        anchors.rightMargin: view.theme.fontSize
        anchors.verticalCenter: parent.verticalCenter
        elide: Text.ElideRight
        text: row.modelData.name
        color: row.modelData.read ? view.theme.muted : row.current ? view.theme.selectedText : view.theme.foreground
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
      }

      Text {
        id: meta
        anchors.right: parent.right
        anchors.rightMargin: view.theme.fontSize * 0.5
        anchors.verticalCenter: parent.verticalCenter
        text: [row.modelData.scanlator, row.modelData.date].filter(function(s) { return s }).join("   ")
        color: view.theme.muted
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }
    }
  }
}
