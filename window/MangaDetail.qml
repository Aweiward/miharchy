pragma ComponentBehavior: Bound

import QtQuick
import "Model.js" as Model
import "Browse.js" as Browse

// A manga's detail over the view that opened it, Library or Browse: cover
// and metadata beside the chapter list, newest first. It talks to the
// server itself; Browse.js decides. shell.qml forwards every "manga."
// command to run().
Rectangle {
  id: view

  required property Theme theme
  property var config: null
  property string configPath: ""
  property var detail: null
  property int cursor: 0
  // Only the latest detail request may update it.
  property int detailSeq: 0

  readonly property bool open: detail !== null
  readonly property var manga: detail ? detail.manga : null
  readonly property var notice: detail ? Browse.notice(detail, configPath) : null
  readonly property string hint: "j k chapters   enter read   a library   r refresh   esc back   "

  signal libraryChanged(int mangaId, bool inLibrary)
  signal read(var chapters, int chapterId)

  visible: open
  color: theme.background

  onCursorChanged: chapters.positionViewAtIndex(cursor, ListView.Contain)
  onConfigChanged: close()

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

  // fromSource: opened while browsing a source, so it refreshes once.
  function openManga(mangaId, fromSource) {
    detail = Browse.detail(mangaId, fromSource)
    cursor = 0
    detailSeq++
    advance()
  }

  function close() {
    detailSeq++
    detail = null
  }

  // After the reader: show what it marked read, on the chapter it left.
  function reread(chapterId) {
    if (!detail) return
    for (var i = 0; i < detail.chapters.length; i++) if (detail.chapters[i].id === chapterId) cursor = i
    detailSeq++
    detail = Browse.reduceDetail(detail, { type: "reread" })
    advance()
  }

  function advance() {
    var payload = Browse.detailPayload(detail)
    if (!payload) return
    var seq = detailSeq
    var cfg = config
    send(payload, function(reply) {
      if (seq !== view.detailSeq) return
      view.detail = Browse.reduceDetail(view.detail, { type: "reply", reply: reply, config: cfg })
      view.advance()
    })
  }

  // Matched by manga, not by request number: a refresh or Back while the
  // toggle is in flight must not strand it, since the server applies it.
  function toggleLibrary() {
    var payload = Browse.libraryPayload(detail)
    if (!payload) return
    var mangaId = detail.mangaId
    detail = Browse.reduceDetail(detail, { type: "library-request" })
    send(payload, function(reply) {
      if (view.detail && view.detail.mangaId === mangaId) view.detail = Browse.reduceDetail(view.detail, { type: "library-reply", reply: reply })
      if (reply.state === "ok") view.libraryChanged(mangaId, reply.data.updateManga.manga.inLibrary === true)
    })
  }

  function run(id) {
    switch (id) {
      case "manga.back":
        close()
        break
      case "manga.up":
      case "manga.down":
        if (detail.chapters.length) cursor = Math.max(0, Math.min(detail.chapters.length - 1, cursor + (id === "manga.up" ? -1 : 1)))
        break
      case "manga.read":
        var c = detail.chapters[cursor]
        if (c) read(detail.chapters, c.id)
        break
      case "manga.library":
        toggleLibrary()
        break
      case "manga.refresh":
        detailSeq++
        detail = Browse.reduceDetail(detail, { type: "refresh" })
        advance()
        break
    }
  }

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
        color: row.current ? view.theme.selectedText : row.modelData.read ? view.theme.muted : view.theme.foreground
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
