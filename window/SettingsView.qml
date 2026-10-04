pragma ComponentBehavior: Bound

import QtQuick
import "Settings.js" as Settings

// The Settings view: one row per Settings.ROWS entry. Its edit field sends
// every key to `key` first, so the window's one dispatcher decides what Esc
// and Enter do.
Item {
  id: view

  required property Theme theme
  property var values: ({})
  property int cursor: 0
  property bool editing: false
  // Model.problem() of the settings state, or null.
  property var problem: null
  property string editError: ""
  // Set editStart before editing turns on; editValue follows the field.
  property string editStart: ""
  property string editValue: ""

  signal key(var event)

  Column {
    anchors.fill: parent
    anchors.margins: view.theme.fontSize * 2
    spacing: view.theme.fontSize

    Text {
      width: parent.width
      visible: view.problem !== null
      wrapMode: Text.Wrap
      text: view.problem ? view.problem.title + ". " + view.problem.detail : ""
      color: view.theme.urgent
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSize
    }

    Column {
      width: Math.min(parent.width, view.theme.fontSize * 60)

      Repeater {
        model: Settings.ROWS

        Rectangle {
          id: row
          required property var modelData
          required property int index
          readonly property bool current: index === view.cursor
          readonly property bool editingThis: current && view.editing
          width: parent.width
          height: view.theme.fontSize * 2.4
          color: current ? view.theme.selected : "transparent"

          Text {
            id: label
            anchors.left: parent.left
            anchors.leftMargin: view.theme.fontSize * 0.75
            anchors.verticalCenter: parent.verticalCenter
            text: row.modelData.label
            color: row.current ? view.theme.selectedText : view.theme.foreground
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSize
          }

          Text {
            anchors.left: label.right
            anchors.leftMargin: view.theme.fontSize * 2
            anchors.right: parent.right
            anchors.rightMargin: view.theme.fontSize * 0.75
            anchors.verticalCenter: parent.verticalCenter
            horizontalAlignment: Text.AlignRight
            elide: Text.ElideLeft
            visible: !row.editingThis
            text: Settings.display(row.modelData, view.values[row.modelData.key])
            color: row.current ? view.theme.selectedText : view.theme.muted
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSize
          }

          TextInput {
            id: field
            anchors.right: parent.right
            anchors.rightMargin: view.theme.fontSize * 0.75
            anchors.verticalCenter: parent.verticalCenter
            width: parent.width / 2
            visible: row.editingThis
            horizontalAlignment: TextInput.AlignRight
            clip: true
            color: view.theme.selectedText
            selectionColor: view.theme.accent
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSize
            onTextChanged: if (row.editingThis) view.editValue = text
            Keys.onPressed: function(event) { view.key(event) }
          }

          onEditingThisChanged: {
            if (!editingThis) return
            field.text = view.editStart
            view.editValue = field.text
            field.selectAll()
            field.forceActiveFocus()
          }
        }
      }
    }

    Text {
      width: parent.width
      visible: view.editError !== ""
      text: view.editError
      color: view.theme.urgent
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }
  }
}
