pragma ComponentBehavior: Bound

import QtQuick
import "Commands.js" as Commands
import "Model.js" as Model
import "Extensions.js" as Extensions

// The Browse view's extension list and extension repos. It talks to the
// server itself; Extensions.js decides. shell.qml forwards every
// "extensions.*" command to run(), and its edit field sends every key to
// `key` first, so the window's one dispatcher decides what Esc and Enter do.
Item {
  id: view

  required property Theme theme
  property var config: null
  property string configPath: ""
  property bool active: false
  property bool showNsfw: false

  property var ext: Extensions.initial()
  property string query: ""
  property bool allLanguages: false
  // "" | "filter" | "repo": the edit field that is open.
  property string editing: ""
  property string editError: ""
  property string cursorKey: ""
  // The row whose remove waits for a second x.
  property string armed: ""
  // Only the latest load request may advance the load.
  property int loadSeq: 0

  readonly property var rows: Extensions.rows(ext, { query: query, allLanguages: allLanguages, showNsfw: showNsfw })
  readonly property int cursor: Math.max(0, rows.findIndex(function(r) { return r.key === view.cursorKey }))
  readonly property var problem: Model.problem(ext, configPath)
  readonly property string hint: "j k move   enter install/update   x remove   a add repo   / filter   l languages   "

  signal key(var event)
  signal editEnded()

  onActiveChanged: if (active && ext.state === "idle") load()
  onConfigChanged: {
    if (editing) closeField()
    loadSeq++
    ext = config ? Extensions.initial() : Extensions.reduce(Extensions.initial(), { type: "config-missing" })
    if (active) load()
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

  function load() {
    if (!config) return
    ext = Extensions.reduce(ext, { type: "load" })
    advance()
  }

  function advance() {
    var payload = Extensions.next(ext)
    if (!payload) return
    var seq = ++loadSeq
    var cfg = config
    send(payload, function(reply) {
      if (seq !== view.loadSeq) return
      view.ext = Extensions.reduce(view.ext, { type: "reply", reply: reply, config: cfg })
      view.advance()
    })
  }

  function act(a) {
    var cfg = config
    if (a.removeRepo) {
      send(Extensions.removeRepoPayload(a.removeRepo), function(reply) {
        view.ext = Extensions.reduce(view.ext, { type: "repo-reply", reply: reply, removed: a.removeRepo })
      })
      return
    }
    ext = Extensions.reduce(ext, { type: "action", pkgName: a.pkgName, action: a.action })
    send(Extensions.actionPayload(a.pkgName, a.action), function(reply) {
      view.ext = Extensions.reduce(view.ext, { type: "action-reply", pkgName: a.pkgName, reply: reply, config: cfg })
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
    armed = ""
    switch (id) {
      case "extensions.up":
      case "extensions.down":
        if (rows.length) cursorKey = rows[Commands.moveCursor(cursor, id === "extensions.up" ? -1 : 1, rows.length)].key
        break
      case "extensions.activate":
        var a = Extensions.actionFor(ext, row, id)
        if (a && config) act(a)
        break
      case "extensions.remove":
        var r = Extensions.actionFor(ext, row, id)
        if (!r || !config) break
        if (wasArmed === row.key) act(r)
        else armed = row.key
        break
      case "extensions.addRepo":
        openField("repo", "")
        break
      case "extensions.filter":
        openField("filter", query)
        break
      case "extensions.languages":
        allLanguages = !allLanguages
        break
      case "extensions.refresh":
        load()
        break
      case "extensions.commit":
        if (editing === "repo") {
          var p = Extensions.parseRepoUrl(field.text)
          if (p.error) {
            editError = p.error
            break
          }
          send(Extensions.addRepoPayload(p.url), function(reply) {
            view.ext = Extensions.reduce(view.ext, { type: "repo-reply", reply: reply })
            view.advance()
          })
        }
        closeField()
        break
      case "extensions.cancel":
        if (editing === "filter") query = ""
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

    Text {
      width: parent.width
      visible: view.problem !== null
      wrapMode: Text.Wrap
      text: view.problem ? view.problem.title + ". " + view.problem.detail : ""
      color: view.theme.urgent
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSize
    }

    Item {
      width: parent.width
      height: view.theme.fontSize * 1.6

      Text {
        id: prompt
        anchors.verticalCenter: parent.verticalCenter
        text: view.editing === "repo" ? "repo url " : "/ "
        color: view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
      }

      TextInput {
        id: field
        anchors.left: prompt.right
        anchors.right: scope.left
        anchors.verticalCenter: parent.verticalCenter
        visible: view.editing !== ""
        clip: true
        color: view.theme.foreground
        selectionColor: view.theme.selected
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
        onTextChanged: if (view.editing === "filter") view.query = text
        Keys.onPressed: function(event) { view.key(event) }
      }

      Text {
        anchors.left: prompt.right
        anchors.verticalCenter: parent.verticalCenter
        visible: view.editing === ""
        text: view.query || "filter"
        color: view.theme.muted
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
      }

      Text {
        id: scope
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        text: (view.ext.state === "loading" ? "refreshing   " : "") + (view.allLanguages ? "every language" : "English")
        color: view.theme.muted
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }
    }

    Text {
      width: parent.width
      visible: text !== ""
      wrapMode: Text.Wrap
      text: view.editError || view.ext.repoError
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

    delegate: Column {
      id: entry
      required property var modelData
      required property int index
      readonly property bool current: index === view.cursor
      readonly property bool firstOfGroup: index === 0 || view.rows[index - 1].group !== modelData.group
      readonly property string status: view.armed === modelData.key
        ? (modelData.kind === "repo" ? "x again to remove" : "x again to uninstall")
        : Extensions.status(view.ext, modelData)
      width: list.width

      Text {
        visible: entry.firstOfGroup
        height: entry.index === 0 ? implicitHeight * 1.6 : implicitHeight * 2.6
        verticalAlignment: Text.AlignBottom
        bottomPadding: view.theme.fontSize * 0.3
        text: entry.modelData.group
        color: view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }

      Rectangle {
        width: parent.width
        height: view.theme.fontSize * 2.4
        color: entry.current ? view.theme.selected : "transparent"

        Image {
          id: icon
          x: view.theme.fontSize * 0.5
          anchors.verticalCenter: parent.verticalCenter
          width: entry.modelData.kind === "repo" ? 0 : view.theme.fontSize * 1.7
          height: width
          source: entry.modelData.icon
          sourceSize.width: width
          asynchronous: true
        }

        Text {
          id: name
          anchors.left: icon.right
          anchors.leftMargin: view.theme.fontSize * 0.75
          anchors.verticalCenter: parent.verticalCenter
          text: entry.modelData.title
          color: entry.current ? view.theme.selectedText : view.theme.foreground
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize
        }

        Text {
          id: marker
          anchors.left: name.right
          anchors.leftMargin: text ? view.theme.fontSize * 0.75 : 0
          anchors.verticalCenter: parent.verticalCenter
          text: entry.modelData.marker
          color: entry.modelData.marker === "18+" ? view.theme.urgent : view.theme.muted
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSmall
        }

        Text {
          anchors.left: marker.right
          anchors.leftMargin: view.theme.fontSize * 0.75
          anchors.right: statusText.left
          anchors.rightMargin: view.theme.fontSize
          anchors.verticalCenter: parent.verticalCenter
          elide: Text.ElideRight
          text: entry.modelData.detail
          color: view.theme.muted
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSmall
        }

        Text {
          id: statusText
          anchors.right: parent.right
          anchors.rightMargin: view.theme.fontSize * 0.75
          anchors.verticalCenter: parent.verticalCenter
          width: Math.min(implicitWidth, parent.width / 2)
          elide: Text.ElideRight
          text: entry.status
          color: entry.status === view.ext.errors[entry.modelData.key] ? view.theme.urgent : view.theme.muted
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSmall
        }
      }
    }
  }

  Text {
    anchors.centerIn: list
    visible: view.rows.length === 0 && view.problem === null
    text: view.ext.state === "loading" || view.ext.state === "idle" ? "Loading extensions"
      : view.ext.repos.length ? "No extension matches" : "No extension repo. Press a to add one by URL."
    color: view.theme.muted
    font.family: view.theme.fontFamily
    font.pixelSize: view.theme.fontSize
  }
}
