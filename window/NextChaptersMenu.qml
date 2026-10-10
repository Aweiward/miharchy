import QtQuick
import "Session.js" as Session
import "Chapters.js" as Chapters
import "Downloads.js" as Downloads
import "NextChapters.js" as NextChapters
import "UpNext.js" as UpNext

// The download menu for a set of manga (NextChapters.js): d on the Library,
// or the palette for Up next. A row fetches each manga's chapters, one at a
// time, then queues what pick() takes and opens the download queue. run
// keeps the last run in memory; shell.qml forwards every "nextChapters."
// command to run().
Item {
  id: view

  required property Theme theme
  property var config: null
  // The download queue's items: a queued chapter is not queued again.
  property var queueItems: []
  // { label, manga: [{ id, title }] } while the menu shows, else null.
  property var set: null
  property int cursor: 0
  property bool counting: false
  property string note: ""
  // NextChapters.start()'s run, the last one; null before the first.
  property var lastRun: null

  readonly property bool open: set !== null
  readonly property bool busy: lastRun !== null && lastRun.state === "refreshing"
  readonly property bool editing: counting
  readonly property string hint: "j k move   enter download   esc close   "

  // A download mutation's reply, which carries the queue.
  signal downloads(var reply)
  // The run queued chapters; the window shows the queue.
  signal queued()
  signal key(var event)
  signal editEnded()

  visible: open

  PrefStore {
    id: menuPrefs
    config: view.config
    table: NextChapters.MENU_PREFS
    onConfigChanged: load()
  }

  function openFor(s) {
    set = s
    cursor = NextChapters.rowIndex(menuPrefs.values.downloadMenuSet)
    note = busy ? "Still fetching chapters for " + lastRun.label : s.manga.length ? "" : "No manga in " + s.label
  }

  function openUpNext() {
    var cfg = config
    if (!cfg) return
    Session.send(cfg, UpNext.payload(), function(reply) {
      if (reply.state !== "ok") return
      view.openFor(NextChapters.upNextSet(UpNext.list(reply.data, false, Date.now())))
    })
  }

  function close() {
    endEdit()
    set = null
  }

  function endEdit() {
    if (!counting) return
    counting = false
    editEnded()
  }

  function start(row, count) {
    if (busy || !set.manga.length || !config) return
    var cfg = config
    var manga = set.manga
    lastRun = NextChapters.start(set, row, count)
    var i = 0
    var step = function() {
      if (i === manga.length) return view.pick(cfg, row, count)
      var m = manga[i++]
      view.note = "Fetching chapters: " + i + " of " + manga.length
      Session.send(cfg, NextChapters.refreshPayload(m.id), function(reply) {
        if (reply.state !== "ok") view.lastRun = NextChapters.failed(view.lastRun, m, reply.message || reply.state)
        step()
      })
    }
    step()
  }

  function pick(cfg, row, count) {
    var end = function(text) {
      view.lastRun = NextChapters.queued(view.lastRun, [])
      view.note = text
    }
    Session.send(cfg, NextChapters.readPayload(lastRun.mangaIds), function(reply) {
      if (reply.state !== "ok") return end(reply.message || reply.state)
      var list = NextChapters.pick(reply.data, row, count, view.queueItems)
      var payload = Downloads.enqueuePayload(list)
      var failures = view.lastRun.failures.length
      if (!payload) return end("Nothing to download" + (failures ? "; " + failures + " manga could not fetch chapters" : ""))
      Session.send(cfg, payload, function(done) {
        view.downloads(done)
        if (done.state !== "ok") return end(done.message || done.state)
        view.lastRun = NextChapters.queued(view.lastRun, Downloads.ids(list))
        view.note = ""
        if (view.open) view.close()
        view.queued()
      })
    })
  }

  function run(id) {
    switch (id) {
      case "nextChapters.close":
        close()
        break
      case "nextChapters.up":
      case "nextChapters.down":
        cursor = Math.max(0, Math.min(Chapters.DOWNLOADS.length - 1, cursor + (id === "nextChapters.up" ? -1 : 1)))
        if (!busy) note = ""
        break
      case "nextChapters.choose":
        var row = Chapters.DOWNLOADS[cursor]
        if (busy) break
        menuPrefs.set([{ key: "downloadMenuSet", value: NextChapters.rowKey(row) }])
        if (row.id === "next" && !row.count) counting = true
        else start(row, row.count)
        break
      case "nextChapters.commit":
        var n = Chapters.count(menu.countText)
        if (!n) {
          note = "Type a whole number above 0"
          break
        }
        endEdit()
        start(Chapters.DOWNLOADS[cursor], n)
        break
      case "nextChapters.cancel":
        endEdit()
        break
    }
  }

  // Under the menu: a click outside it reaches nothing behind.
  MouseArea {
    anchors.fill: parent
  }

  DownloadMenu {
    id: menu
    anchors.top: parent.top
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    theme: view.theme
    title: view.set ? "Download for " + view.set.label + (view.set.label === view.set.manga.length + " manga" ? "" : " (" + view.set.manga.length + " manga)") : ""
    cursor: view.cursor
    counting: view.counting
    note: view.note
    onMoved: function(index) { view.cursor = index }
    onKey: function(event) { view.key(event) }
  }
}
