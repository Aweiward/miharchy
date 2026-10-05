pragma ComponentBehavior: Bound

import QtQuick
import "Model.js" as Model
import "History.js" as History
import "Browse.js" as Browse

// The History view: one row per manga, its last opened chapter, grouped by
// day. It talks to the server itself; History.js decides. shell.qml
// forwards every "history." command to run() and starts the reader on
// resume.
Item {
  id: view

  required property Theme theme
  property var config: null
  property string configPath: ""
  property bool active: false

  property var history: History.initial()
  property int cursor: 0
  // "" | "clear" | a manga id as text: what waits for a second x or X.
  property string armed: ""
  property string error: ""
  // The manga detail a resume loads for the reader's chapter list.
  property var opening: null
  property real now: Date.now() / 1000
  // Only the latest request may update the history or the resume.
  property int seq: 0

  readonly property var entries: history.entries
  readonly property var notice: History.notice(history, configPath)
  readonly property string hint: "j k move   enter resume   x remove   X clear all   "

  // chapters: newest first, as the manga detail holds them.
  signal resume(var manga, var chapters, int chapterId)

  onActiveChanged: if (active) reload()
  onConfigChanged: {
    seq++
    opening = null
    history = config ? History.initial() : History.reduce(history, { type: "config-missing" })
    if (active) reload()
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

  function reload() {
    if (!config) return
    var s = ++seq
    var cfg = config
    opening = null
    history = History.reduce(history, { type: "request" })
    send({ query: History.QUERY }, function(reply) {
      if (s !== view.seq) return
      view.now = Date.now() / 1000
      view.history = History.reduce(view.history, { type: "reply", reply: reply, config: cfg })
      view.cursor = Math.max(0, Math.min(view.entries.length - 1, view.cursor))
    })
  }

  function mutate(payload) {
    if (!payload || !config) return
    error = ""
    send(payload, function(reply) {
      if (reply.state !== "ok") view.error = reply.message || Model.problem(reply, view.configPath).title
      view.reload()
    })
  }

  // The reader needs the manga's chapter list to go on to the next one, so
  // a resume reads the detail first, as the manga detail does.
  function open(entry) {
    var s = ++seq
    var cfg = config
    opening = Browse.detail(entry.mangaId, false)
    var step = function() {
      var payload = Browse.detailPayload(view.opening)
      if (!payload) {
        var d = view.opening
        view.opening = null
        if (d.state === "ok") view.resume(d.manga, d.chapters, entry.chapterId)
        else view.error = Browse.notice(d, view.configPath).title
        return
      }
      view.send(payload, function(reply) {
        if (s !== view.seq) return
        view.opening = Browse.reduceDetail(view.opening, { type: "reply", reply: reply, config: cfg })
        step()
      })
    }
    step()
  }

  function run(id) {
    var entry = entries[cursor] || null
    var wasArmed = armed
    armed = ""
    switch (id) {
      case "history.up":
      case "history.down":
        if (entries.length) cursor = Math.max(0, Math.min(entries.length - 1, cursor + (id === "history.up" ? -1 : 1)))
        break
      case "history.reload":
        reload()
        break
      case "history.open":
        if (entry && !opening) open(entry)
        break
      case "history.remove":
        if (!entry) break
        if (wasArmed === String(entry.mangaId)) mutate(History.removePayload(entry))
        else armed = String(entry.mangaId)
        break
      case "history.clear":
        if (!entries.length) break
        if (wasArmed === "clear") mutate(History.clearPayload(entries))
        else armed = "clear"
        break
    }
  }

  Text {
    id: head
    anchors.top: parent.top
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    wrapMode: Text.Wrap
    visible: text !== ""
    text: view.armed === "clear" ? "X again to clear all history. Read state stays." : view.error ? view.error : view.opening ? "Opening " + view.entries[view.cursor].title : ""
    color: view.armed === "clear" || view.error ? view.theme.urgent : view.theme.muted
    font.family: view.theme.fontFamily
    font.pixelSize: view.theme.fontSmall
  }

  ListView {
    id: list
    anchors.top: head.visible ? head.bottom : parent.top
    anchors.bottom: parent.bottom
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.leftMargin: view.theme.fontSize * 2
    anchors.rightMargin: view.theme.fontSize * 2
    anchors.topMargin: head.visible ? view.theme.fontSize : view.theme.fontSize * 2
    visible: view.notice === null
    clip: true
    model: view.entries

    delegate: Column {
      id: entry
      required property var modelData
      required property int index
      readonly property bool current: index === view.cursor
      readonly property string day: History.day(modelData.at, view.now)
      readonly property bool firstOfDay: index === 0 || History.day(view.entries[index - 1].at, view.now) !== day
      width: list.width

      Text {
        visible: entry.firstOfDay
        topPadding: entry.index === 0 ? 0 : view.theme.fontSize
        bottomPadding: view.theme.fontSize * 0.5
        text: entry.day
        color: view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }

      Rectangle {
        width: parent.width
        height: view.theme.fontSize * 5
        color: entry.current ? view.theme.selected : "transparent"

        Cover {
          id: coverBox
          anchors.left: parent.left
          anchors.leftMargin: view.theme.fontSize * 0.5
          anchors.verticalCenter: parent.verticalCenter
          height: parent.height - view.theme.fontSize * 0.5
          width: height / 1.5
          theme: view.theme
          config: view.config
          source: entry.modelData.cover
          title: entry.modelData.title
        }

        Column {
          anchors.left: coverBox.right
          anchors.leftMargin: view.theme.fontSize
          anchors.right: status.left
          anchors.rightMargin: view.theme.fontSize
          anchors.verticalCenter: parent.verticalCenter
          spacing: view.theme.fontSize * 0.25

          Text {
            width: parent.width
            elide: Text.ElideRight
            text: entry.modelData.title
            color: entry.current ? view.theme.selectedText : view.theme.foreground
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSize
          }

          Text {
            width: parent.width
            elide: Text.ElideRight
            text: entry.modelData.chapter + "   " + History.progress(entry.modelData)
            color: view.theme.muted
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSmall
          }
        }

        Text {
          id: status
          anchors.right: parent.right
          anchors.rightMargin: view.theme.fontSize * 0.75
          anchors.verticalCenter: parent.verticalCenter
          text: view.armed === String(entry.modelData.mangaId) ? "x again to remove" : History.time(entry.modelData.at)
          color: view.armed === String(entry.modelData.mangaId) ? view.theme.urgent : view.theme.muted
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSmall
        }
      }
    }
  }

  Column {
    anchors.centerIn: parent
    width: Math.min(parent.width - view.theme.fontSize * 4, view.theme.fontSize * 50)
    spacing: view.theme.fontSize
    visible: view.notice !== null

    Text {
      width: parent.width
      horizontalAlignment: Text.AlignHCenter
      text: view.notice ? view.notice.title : ""
      color: view.theme.foreground
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontHeading
    }

    Text {
      width: parent.width
      horizontalAlignment: Text.AlignHCenter
      wrapMode: Text.Wrap
      text: view.notice ? view.notice.detail : ""
      color: view.theme.muted
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSize
    }
  }
}
