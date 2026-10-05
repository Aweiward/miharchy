pragma ComponentBehavior: Bound

import QtQuick
import "Commands.js" as Commands
import "Model.js" as Model
import "Categories.js" as Categories

// The Library's categories screen: add, rename, reorder, delete, flag
// for auto-download, include in or exclude from updates, and keep read
// downloads. It sends the mutations itself; Categories.js decides. shell.qml forwards
// every "categories." command to run() and reloads the library on
// edited, which brings the new list back in categories.
Item {
  id: view

  required property Theme theme
  property var config: null
  property var categories: []
  property var manga: []
  property bool loading: false

  // "" | "add" | "rename": the name field that is open.
  property string editing: ""
  property string editError: ""
  property string error: ""
  property int cursorId: -1
  // The category whose delete waits for a second x.
  property int armed: -1
  property bool pending: false

  readonly property var rows: Categories.rows(categories, manga)
  readonly property int cursor: Math.max(0, rows.findIndex(function(r) { return r.id === view.cursorId }))
  readonly property string hint: "j k move   J K reorder   a add   enter rename   d auto-download   u updates   p keep downloads   x delete   esc back   "

  signal key(var event)
  signal editEnded()
  signal edited()

  // A click moves the cursor as j and k do; a double click then sends Enter.
  function point(id, twice) {
    if (editing) return
    cursorId = id
    if (twice) key(Commands.enter())
  }

  onCursorChanged: list.positionViewAtIndex(cursor, ListView.Contain)

  function send(payload, done) {
    var req = Model.request(config, payload)
    var xhr = new XMLHttpRequest()
    xhr.onreadystatechange = function() {
      if (xhr.readyState === XMLHttpRequest.DONE) done(Model.reply(xhr.status, xhr.responseText))
    }
    xhr.open("POST", req.url)
    xhr.setRequestHeader("Content-Type", "application/json")
    xhr.setRequestHeader("Authorization", req.authorization)
    xhr.send(req.body)
  }

  // One change at a time, each computed from the list the last reload
  // brought back.
  function mutate(payload, done) {
    if (!payload || !config || pending || loading) return
    pending = true
    error = ""
    send(payload, function(reply) {
      view.pending = false
      if (reply.state !== "ok") view.error = reply.message || Model.problem(reply, "server.json").title
      else if (done) done(reply.data)
      view.edited()
    })
  }

  function openField(kind, text) {
    editing = kind
    editError = ""
    field.text = text
    field.selectAll()
    field.forceActiveFocus()
  }

  function closeField() {
    editing = ""
    editError = ""
    editEnded()
  }

  function run(id) {
    var row = rows[cursor] || null
    var wasArmed = armed
    armed = -1
    switch (id) {
      case "categories.up":
      case "categories.down":
        if (rows.length) cursorId = rows[Commands.moveCursor(cursor, id === "categories.up" ? -1 : 1, rows.length)].id
        break
      case "categories.moveUp":
      case "categories.moveDown":
        if (row) cursorId = row.id
        mutate(Categories.movePayload(categories, cursor, id === "categories.moveUp" ? -1 : 1))
        break
      case "categories.add":
        openField("add", "")
        break
      case "categories.rename":
        if (row) openField("rename", row.name)
        break
      case "categories.remove":
        if (!row) break
        if (wasArmed === row.id) mutate(Categories.deletePayload(categories, row.id))
        else armed = row.id
        break
      case "categories.autoDownload":
        if (row) mutate(Categories.autoDownloadPayload(categories, row.id))
        break
      case "categories.keepDownloads":
        if (row) mutate(Categories.keepPayload(categories, row.id))
        break
      case "categories.update":
        if (row) mutate(Categories.updatePayload(categories, row.id))
        break
      case "categories.commit":
        var checked = Categories.checkName(field.text, categories, editing === "rename" && row ? row.id : undefined)
        if (checked.error) {
          editError = checked.error
          break
        }
        if (editing === "add") {
          mutate(Categories.createPayload(checked.name), function(data) { view.cursorId = data.createCategory.category.id })
        } else if (row) {
          mutate(Categories.renamePayload(row.id, checked.name))
        }
        closeField()
        break
      case "categories.cancel":
        closeField()
        break
    }
  }

  Column {
    id: head
    anchors.top: parent.top
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    spacing: view.theme.fontSize / 2

    Item {
      width: parent.width
      height: view.theme.fontSize * 1.6

      Text {
        id: prompt
        anchors.verticalCenter: parent.verticalCenter
        text: view.editing === "add" ? "new category " : view.editing === "rename" ? "rename " : "Categories"
        color: view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
      }

      TextInput {
        id: field
        anchors.left: prompt.right
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        visible: view.editing !== ""
        clip: true
        color: view.theme.foreground
        selectionColor: view.theme.selected
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
        Keys.onPressed: function(event) { view.key(event) }
      }

      Text {
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        visible: view.editing === ""
        text: view.pending || view.loading ? "saving" : "Default holds manga in no category"
        color: view.theme.muted
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }
    }

    Text {
      width: parent.width
      visible: text !== ""
      wrapMode: Text.Wrap
      text: view.editError || view.error
      color: view.theme.urgent
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }
  }

  ListView {
    id: list
    anchors.top: head.bottom
    anchors.bottom: parent.bottom
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.leftMargin: view.theme.fontSize * 2
    anchors.rightMargin: view.theme.fontSize * 2
    anchors.topMargin: view.theme.fontSize
    clip: true
    model: view.rows

    delegate: Rectangle {
      id: entry
      required property var modelData
      required property int index
      readonly property bool current: index === view.cursor
      width: list.width
      height: view.theme.fontSize * 2.4
      color: current ? view.theme.selected : "transparent"

      MouseArea {
        anchors.fill: parent
        onClicked: view.point(entry.modelData.id, false)
        onDoubleClicked: view.point(entry.modelData.id, true)
      }

      Text {
        anchors.left: parent.left
        anchors.leftMargin: view.theme.fontSize * 0.5
        anchors.right: status.left
        anchors.rightMargin: view.theme.fontSize
        anchors.verticalCenter: parent.verticalCenter
        elide: Text.ElideRight
        text: entry.modelData.name
        color: entry.current ? view.theme.selectedText : view.theme.foreground
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
      }

      Text {
        id: status
        anchors.right: parent.right
        anchors.rightMargin: view.theme.fontSize * 0.75
        anchors.verticalCenter: parent.verticalCenter
        text: view.armed === entry.modelData.id ? "x again to delete" : ({ INCLUDE: "in updates   ", EXCLUDE: "excluded from updates   " }[entry.modelData.update] || "") + (entry.modelData.download ? "auto-download   " : "") + (entry.modelData.keep ? "keeps downloads   " : "") + entry.modelData.count + " manga"
        color: view.armed === entry.modelData.id ? view.theme.urgent : view.theme.muted
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }
    }
  }

  Text {
    anchors.centerIn: list
    visible: view.rows.length === 0
    text: "No categories. Press a to add one."
    color: view.theme.muted
    font.family: view.theme.fontFamily
    font.pixelSize: view.theme.fontSize
  }
}
