pragma ComponentBehavior: Bound

import QtQuick
import "Model.js" as Model
import "Browse.js" as Browse
import "Updates.js" as Updates
import "Downloads.js" as Downloads

// The Updates view: unread updates grouped by fetch day, and the library
// update run. It talks to the server itself; Updates.js decides. shell.qml
// forwards every "updates." command to run() and starts the reader on read.
// Read state goes through shell.qml's markChapters() (mark), downloads
// through the queue (downloads), as on a manga.
Item {
  id: view

  required property Theme theme
  property var config: null
  property string configPath: ""
  // The view shows, so it loads and polls.
  property bool active: false
  property var updates: Updates.initial()
  property int cursorId: -1
  property string error: ""
  // Only the latest list load, open and poll may land.
  property int listSeq: 0
  property int openSeq: 0
  property int pollSeq: 0
  property bool polling: false
  // Chapter ids; actions take these, or the cursor's update with none.
  property var selected: []
  // x asked once; the next x deletes the downloads, as Mihon's
  // UpdatesDeleteConfirmationDialog. shell.qml disarms it on any other key.
  property bool armed: false
  // The download queue's items, for each update's marker.
  property var queue: []

  readonly property var rows: updates.rows
  readonly property int cursor: Math.max(0, rows.findIndex(function(r) { return r.id === view.cursorId }))
  readonly property var notice: Updates.notice(updates, configPath)
  readonly property var targets: Updates.chosen(rows, selected, cursor)
  readonly property string hint: armed ? "x again to delete the downloads, any other key keeps them   "
    : (selected.length ? selected.length + " selected   space select   A all   I invert   " : "j k move   enter read   space select   A all   ")
      + "R read   U unread   b bookmark   d download   x delete download   " + (selected.length ? "esc clear   " : "u check   s sync   ")

  signal read(var manga, var chapters, int chapterId)
  // action: "read", "unread" or "bookmark".
  signal mark(var chapters, string action, var mangaIds)
  // A download mutation's reply, which carries the queue.
  signal downloads(var reply)

  onCursorChanged: list.positionViewAtIndex(cursor, ListView.Contain)
  onActiveChanged: load()
  onRowsChanged: selected = Updates.keep(selected, rows)
  onConfigChanged: {
    listSeq++
    openSeq++
    updates = Updates.initial()
    selected = []
    load()
  }

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
    if (!config || !active) return
    var seq = ++listSeq
    var cfg = config
    updates = Updates.reduce(updates, { type: "request" })
    send(Updates.listPayload(), function(reply) {
      if (seq !== view.listSeq) return
      view.updates = Updates.reduce(view.updates, { type: "list", reply: reply, config: cfg, now: Date.now() })
    })
  }

  function poll() {
    if (!config || polling) return
    polling = true
    var seq = ++pollSeq
    send(Updates.statusPayload(), function(reply) {
      if (seq !== view.pollSeq) return
      view.polling = false
      var before = view.updates
      view.updates = Updates.reduce(before, { type: "status", reply: reply })
      if (Updates.finished(before, view.updates)) view.load()
    })
  }

  // categories: ids for Updates.checkPayload(). Returns whether a run
  // started; one runs at a time.
  function check(categories) {
    if (!config || updates.running || updates.checking) return false
    updates = Updates.reduce(updates, { type: "checking" })
    error = ""
    // A poll sent before the run started would end the check.
    pollSeq++
    polling = false
    send(Updates.checkPayload(categories), function(reply) {
      if (reply.state === "ok") return view.poll()
      view.updates = Updates.reduce(view.updates, { type: "status", reply: reply })
      view.error = reply.message || Model.problem(reply, view.configPath).title
    })
    return true
  }

  // The reader needs the manga's reading mode and every chapter, which the
  // manga detail's first read brings; no source fetch.
  function open() {
    var row = rows[cursor]
    if (row) openChapter(row.mangaId, row.id)
  }

  // Also the mark's way in: shell.qml calls it for the launcher's
  // open-chapter.
  function openChapter(mangaId, chapterId) {
    if (!config) return
    var seq = ++openSeq
    var cfg = config
    var d = Browse.detail(mangaId, false)
    error = ""
    send(Browse.detailPayload(d), function(reply) {
      if (seq !== view.openSeq) return
      d = Browse.reduceDetail(d, { type: "reply", reply: reply, config: cfg })
      if (d.manga) view.read(d.manga, d.chapters, chapterId)
      else view.error = Browse.notice(d, view.configPath).title
    })
  }

  // Mihon ends the selection after every action.
  function act(action) {
    var list = targets
    selected = []
    if (list.length) mark(list, action, Updates.mangaIds(list))
  }

  function sendDownloads(payload) {
    selected = []
    if (!payload) return
    send(payload, function(reply) {
      view.downloads(reply)
      view.load()
    })
  }

  function deleteDownloads() {
    var payload = Downloads.removePayload(targets, queue)
    if (!payload) return
    if (!armed) {
      armed = true
      return
    }
    armed = false
    sendDownloads(payload)
  }

  function run(id) {
    switch (id) {
      case "updates.up":
      case "updates.down":
        if (rows.length) cursorId = rows[Math.max(0, Math.min(rows.length - 1, cursor + (id === "updates.up" ? -1 : 1)))].id
        break
      case "updates.open":
        open()
        break
      case "updates.check":
        check()
        break
      case "updates.select":
        if (rows[cursor]) selected = Updates.toggle(selected, rows[cursor].id)
        break
      case "updates.clearSelection":
        selected = []
        break
      case "updates.selectAll":
        selected = rows.map(function(r) { return r.id })
        break
      case "updates.invert":
        selected = Updates.invert(selected, rows)
        break
      case "updates.markRead":
      case "updates.markUnread":
        act(id === "updates.markRead" ? "read" : "unread")
        break
      case "updates.bookmark":
        act("bookmark")
        break
      case "updates.download":
        sendDownloads(Downloads.enqueuePayload(targets))
        break
      case "updates.deleteDownload":
        deleteDownloads()
        break
    }
  }

  // A scheduled run can start any time, so an idle view still looks now
  // and then. Polling, not the libraryUpdateStatusChanged subscription:
  // QML's WebSocket sends no Authorization header, which basic_auth needs.
  Timer {
    interval: view.updates.running || view.updates.checking ? 1000 : 30000
    running: view.active && view.config !== null
    repeat: true
    onTriggered: view.poll()
  }

  Text {
    id: progress
    x: view.theme.fontSize * 2
    y: view.theme.fontSize
    text: Updates.progress(view.updates, Date.now()) + (view.error ? "   " + view.error : "")
    color: view.error ? view.theme.urgent : view.updates.running || view.updates.checking ? view.theme.accent : view.theme.muted
    font.family: view.theme.fontFamily
    font.pixelSize: view.theme.fontSmall
  }

  ListView {
    id: list
    anchors.top: progress.bottom
    anchors.bottom: parent.bottom
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    anchors.topMargin: view.theme.fontSize
    visible: view.notice === null
    clip: true
    model: view.rows

    delegate: Column {
      id: entry
      required property var modelData
      required property int index
      readonly property bool current: index === view.cursor
      readonly property bool chosen: view.selected.indexOf(modelData.id) !== -1
      readonly property string marker: Downloads.marker(modelData, view.queue)
      width: list.width

      Text {
        visible: entry.modelData.header !== ""
        topPadding: entry.index ? view.theme.fontSize : 0
        bottomPadding: view.theme.fontSize * 0.5
        text: entry.modelData.header
        color: view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }

      Rectangle {
        width: parent.width
        height: view.theme.fontSize * 4
        color: entry.current || entry.chosen ? view.theme.selected : "transparent"

        Rectangle {
          visible: entry.chosen
          width: view.theme.fontSize * 0.25
          height: parent.height
          color: view.theme.accent
        }

        Cover {
          id: coverBox
          x: view.theme.fontSize * 0.5
          anchors.verticalCenter: parent.verticalCenter
          height: parent.height - view.theme.fontSize * 0.6
          width: height / 1.5
          theme: view.theme
          config: view.config
          source: entry.modelData.cover
          title: entry.modelData.title
        }

        Column {
          anchors.left: coverBox.right
          anchors.leftMargin: view.theme.fontSize
          anchors.right: downloadMark.left
          anchors.rightMargin: view.theme.fontSize
          anchors.verticalCenter: parent.verticalCenter

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
            // Mihon marks a bookmark with an icon and the accent color.
            text: (entry.modelData.bookmarked ? "★ " : "") + entry.modelData.chapter
            color: entry.current ? view.theme.selectedText : entry.modelData.bookmarked ? view.theme.accent : view.theme.muted
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSmall
          }
        }

        Text {
          id: downloadMark
          anchors.right: date.left
          anchors.rightMargin: text ? view.theme.fontSize * 1.5 : 0
          anchors.verticalCenter: parent.verticalCenter
          text: entry.marker
          color: entry.marker === "failed" ? view.theme.urgent : view.theme.accent
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSmall
        }

        Text {
          id: date
          anchors.right: parent.right
          anchors.rightMargin: view.theme.fontSize * 0.5
          anchors.verticalCenter: parent.verticalCenter
          text: entry.modelData.date
          color: view.theme.muted
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
