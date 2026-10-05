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
  // An installed extension's details (Extensions.details) over the list,
  // or null.
  property var details: null
  property int detailsSeq: 0

  readonly property var rows: Extensions.rows(ext, { query: query, allLanguages: allLanguages, showNsfw: showNsfw })
  readonly property int cursor: Math.max(0, rows.findIndex(function(r) { return r.key === view.cursorKey }))
  readonly property var problem: Model.problem(ext, configPath)
  readonly property var detailsExtension: details ? Extensions.find(ext, details.pkgName) : null
  readonly property bool updatable: ext.extensions.some(function(e) { return e.installed && e.hasUpdate })
  readonly property string hint: !details ? "j k move   enter install/details   u update   " + (updatable ? "U update all   " : "") + "x remove   a add repo   / filter   l languages   "
    : "j k move   enter settings   " + (detailsExtension && detailsExtension.hasUpdate ? "u update   " : "") + "x uninstall   esc back   "

  signal key(var event)
  signal editEnded()
  // Enter on a source in the details: BrowseView's settings panel opens.
  signal openSettings(var source)

  // A click moves the cursor as j and k do; a double click then sends Enter.
  function pointSource(index, twice) {
    details = Extensions.reduceDetails(details, { type: "move", delta: index - details.cursor })
    if (twice) key(Commands.enter())
  }

  function point(rowKey, twice) {
    if (editing) return
    cursorKey = rowKey
    if (twice) key(Commands.enter())
  }

  onActiveChanged: if (active && ext.state === "idle") load()
  onConfigChanged: {
    if (editing) closeField()
    loadSeq++
    closeDetails()
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

  function showDetails(pkgName) {
    details = Extensions.details(pkgName)
    var seq = ++detailsSeq
    send(Extensions.detailsPayload(details), function(reply) {
      if (seq === view.detailsSeq && view.details) view.details = Extensions.reduceDetails(view.details, { type: "reply", reply: reply })
    })
  }

  function closeDetails() {
    detailsSeq++
    details = null
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
      // An uninstall from the details ends them.
      var left = Extensions.find(view.ext, a.pkgName)
      if (view.details && view.details.pkgName === a.pkgName && (!left || !left.installed)) view.closeDetails()
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
      case "extensions.update":
        var a = Extensions.actionFor(ext, row, id)
        if (!a || !config) break
        if (a.details) showDetails(a.details)
        else act(a)
        break
      case "extensions.updateAll":
        var all = Extensions.updateAll(ext)
        if (!all || !config) break
        var cfg = config
        ext = Extensions.reduce(ext, { type: "update-all", pkgNames: all.pkgNames })
        send(all.payload, function(reply) {
          view.ext = Extensions.reduce(view.ext, { type: "update-all-reply", pkgNames: all.pkgNames, reply: reply, config: cfg })
        })
        break
      case "extension.up":
      case "extension.down":
        details = Extensions.reduceDetails(details, { type: "move", delta: id === "extension.up" ? -1 : 1 })
        break
      case "extension.back":
        closeDetails()
        break
      case "extension.settings":
      case "extension.update":
      case "extension.uninstall":
        var da = Extensions.detailsAction(ext, details, id)
        if (!da || !config) break
        if (da.settings) openSettings(da.settings)
        else if (id !== "extension.uninstall" || wasArmed === details.pkgName) act(da)
        else armed = details.pkgName
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
    visible: !view.details
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
    visible: !view.details
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

        MouseArea {
          anchors.fill: parent
          onClicked: view.point(entry.modelData.key, false)
          onDoubleClicked: view.point(entry.modelData.key, true)
        }

        ServerImage {
          id: icon
          x: view.theme.fontSize * 0.5
          anchors.verticalCenter: parent.verticalCenter
          width: entry.modelData.kind === "repo" ? 0 : view.theme.fontSize * 1.7
          height: width
          config: view.config
          url: entry.modelData.icon
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
    visible: !view.details && view.rows.length === 0 && view.problem === null
    text: view.ext.state === "loading" || view.ext.state === "idle" ? "Loading extensions"
      : view.ext.repos.length ? "No extension matches" : "No extension repo. Press a to add one by URL."
    color: view.theme.muted
    font.family: view.theme.fontFamily
    font.pixelSize: view.theme.fontSize
  }

  // Mihon's extension details: what the extension is, then its sources.
  Item {
    anchors.fill: parent
    anchors.margins: view.theme.fontSize * 2
    visible: view.details !== null

    Column {
      id: detailsHead
      width: parent.width
      spacing: view.theme.fontSize * 0.4

      Row {
        spacing: view.theme.fontSize * 0.75

        ServerImage {
          width: view.theme.fontSize * 2.4
          height: width
          config: view.config
          url: view.detailsExtension ? view.detailsExtension.icon : ""
          sourceSize.width: width
          asynchronous: true
        }

        Text {
          anchors.verticalCenter: parent.verticalCenter
          text: view.detailsExtension ? view.detailsExtension.name : ""
          color: view.theme.foreground
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontHeading
        }
      }

      Repeater {
        model: view.details ? Extensions.detailsHeader(view.ext, view.details) : []

        Text {
          required property var modelData
          width: detailsHead.width
          elide: Text.ElideRight
          text: modelData
          color: view.theme.muted
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSmall
        }
      }

      Text {
        readonly property bool failed: view.details !== null && (["ok", "loading"].indexOf(view.details.state) === -1 || text === view.ext.errors[view.details.pkgName])
        width: parent.width
        visible: text !== ""
        wrapMode: Text.Wrap
        text: !view.details ? ""
          : view.armed === view.details.pkgName ? "x again to uninstall"
          : view.details.state === "loading" ? "Loading sources"
          : view.details.state !== "ok" ? view.details.message || view.details.state
          : Extensions.status(view.ext, { kind: "extension", key: view.details.pkgName })
        color: failed ? view.theme.urgent : view.theme.muted
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }

      Text {
        topPadding: view.theme.fontSize
        text: view.details && view.details.state === "ok" ? (view.details.sources.length === 1 ? "1 source" : view.details.sources.length + " sources") : "Sources"
        color: view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }
    }

    ListView {
      id: sourceList
      anchors.top: detailsHead.bottom
      anchors.topMargin: view.theme.fontSize * 0.5
      anchors.bottom: parent.bottom
      width: parent.width
      clip: true
      model: view.details ? view.details.sources : []
      currentIndex: view.details ? view.details.cursor : -1
      onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)

      delegate: Rectangle {
        id: source
        required property var modelData
        required property int index
        readonly property bool current: view.details !== null && index === view.details.cursor
        width: sourceList.width
        height: view.theme.fontSize * 2.2
        color: current ? view.theme.selected : "transparent"

        MouseArea {
          anchors.fill: parent
          onClicked: view.pointSource(source.index, false)
          onDoubleClicked: view.pointSource(source.index, true)
        }

        Text {
          anchors.left: parent.left
          anchors.leftMargin: view.theme.fontSize * 0.5
          anchors.right: sourceDetail.left
          anchors.rightMargin: view.theme.fontSize
          anchors.verticalCenter: parent.verticalCenter
          elide: Text.ElideRight
          text: source.modelData.name
          color: source.current ? view.theme.selectedText : view.theme.foreground
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize
        }

        Text {
          id: sourceDetail
          anchors.right: parent.right
          anchors.rightMargin: view.theme.fontSize * 0.5
          anchors.verticalCenter: parent.verticalCenter
          text: source.modelData.lang + (source.modelData.configurable ? "   settings" : "")
          color: source.current ? view.theme.selectedText : view.theme.muted
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSmall
        }
      }
    }
  }
}
