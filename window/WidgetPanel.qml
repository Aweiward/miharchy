pragma ComponentBehavior: Bound

import QtQuick

// A source's filters or settings as a list of rows (Widgets.rows), with a
// text field at the bottom while a text row is typed. BrowseView owns the
// state; the field sends every key to `key`, so the window's one
// dispatcher decides what Esc and Enter do.
Rectangle {
  id: view

  required property Theme theme
  property string title: ""
  property var rows: []
  property int cursor: 0
  property bool editing: false
  property string editLabel: ""
  // A load failure, or the last save's error.
  property string problem: ""

  readonly property alias field: field

  signal key(var event)

  color: theme.background
  border.width: 1
  border.color: theme.muted

  onCursorChanged: list.positionViewAtIndex(cursor, ListView.Contain)

  Text {
    id: heading
    x: view.theme.fontSize
    y: view.theme.fontSize
    width: parent.width - view.theme.fontSize * 2
    text: view.title
    elide: Text.ElideRight
    color: view.theme.foreground
    font.family: view.theme.fontFamily
    font.pixelSize: view.theme.fontSize
  }

  Text {
    id: problemText
    anchors.top: heading.bottom
    anchors.topMargin: view.theme.fontSize * 0.5
    x: view.theme.fontSize
    width: parent.width - view.theme.fontSize * 2
    visible: view.problem !== ""
    wrapMode: Text.Wrap
    text: view.problem
    color: view.theme.urgent
    font.family: view.theme.fontFamily
    font.pixelSize: view.theme.fontSmall
  }

  ListView {
    id: list
    anchors.top: problemText.visible ? problemText.bottom : heading.bottom
    anchors.topMargin: view.theme.fontSize * 0.5
    anchors.bottom: edit.visible ? edit.top : parent.bottom
    anchors.bottomMargin: view.theme.fontSize
    x: view.theme.fontSize
    width: parent.width - view.theme.fontSize * 2
    clip: true
    model: view.rows

    delegate: Rectangle {
      id: row
      required property var modelData
      required property int index
      readonly property bool current: index === view.cursor
      readonly property color ink: !modelData.enabled ? view.theme.muted : current ? view.theme.selectedText : modelData.kind === "header" ? view.theme.accent : view.theme.foreground
      width: list.width
      height: line.height + (summary.visible ? summary.height : 0) + view.theme.fontSize * 0.5
      color: current ? view.theme.selected : "transparent"

      Item {
        id: line
        y: view.theme.fontSize * 0.25
        x: view.theme.fontSize * (0.5 + 1.5 * row.modelData.depth)
        width: parent.width - x - view.theme.fontSize * 0.5
        height: label.implicitHeight

        Text {
          id: label
          width: Math.min(implicitWidth, parent.width - (detail.text ? detail.implicitWidth + view.theme.fontSize : 0))
          elide: Text.ElideRight
          text: (row.modelData.mark ? row.modelData.mark + " " : "") + row.modelData.label
          color: row.ink
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize
        }

        Text {
          id: detail
          anchors.right: parent.right
          width: Math.min(implicitWidth, parent.width / 2)
          elide: Text.ElideRight
          text: row.modelData.detail
          color: row.current ? view.theme.selectedText : view.theme.muted
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize
        }
      }

      Text {
        id: summary
        anchors.top: line.bottom
        x: line.x
        width: line.width
        visible: text !== ""
        wrapMode: Text.Wrap
        text: row.modelData.summary
        color: row.current ? view.theme.selectedText : view.theme.muted
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }
    }
  }

  Item {
    id: edit
    anchors.bottom: parent.bottom
    anchors.bottomMargin: view.theme.fontSize
    x: view.theme.fontSize
    width: parent.width - view.theme.fontSize * 2
    height: view.theme.fontSize * 1.6
    visible: view.editing

    Text {
      id: prompt
      anchors.verticalCenter: parent.verticalCenter
      text: view.editLabel + " "
      color: view.theme.accent
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSize
    }

    TextInput {
      id: field
      anchors.left: prompt.right
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      clip: true
      color: view.theme.foreground
      selectionColor: view.theme.selected
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSize
      Keys.onPressed: function(event) { view.key(event) }
    }
  }
}
