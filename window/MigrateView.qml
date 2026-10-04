pragma ComponentBehavior: Bound

import QtQuick
import "Model.js" as Model
import "Browse.js" as Browse
import "GlobalSearch.js" as GlobalSearch
import "Migrate.js" as Migrate

// Migrate over the view that opened it: one manga from its detail (search
// every other source for its title, pick the match, confirm), or every
// library manga of one source (pick that source, the target, then each
// match). It talks to the server itself; Migrate.js decides. shell.qml
// forwards every "migrate." command to run().
Rectangle {
  id: view

  required property Theme theme
  property var config: null
  property string configPath: ""
  property bool showNsfw: false
  // The library's categories, to name the ones that move.
  property var categories: []

  // "" (closed) | "search" | "from" | "to" | "match" | "confirm" | "busy" | "done"
  property string step: ""
  property bool batchMode: false
  // One manga: its detail's manga, and the search across the other sources.
  property var old: null
  property var search: null
  property var searchCursor: ({ row: 0, col: 0 })
  property bool editing: false
  // A source: Migrate.librarySources(), the one chosen, the targets, the
  // target chosen and the batch.
  property var froms: []
  property var from: null
  property var tos: []
  property var to: null
  property var batch: null
  property int cursor: 0
  // Each { old: { id, title }, target: { id, title, source }, result }, and
  // once read: oldNode, chapters and plan.
  property var jobs: []
  property bool deleteDownloads: true
  property bool running: false
  property string busyText: ""
  // Bumped on close and on going back, so stale replies drop.
  property int seq: 0

  readonly property bool open: step !== ""
  readonly property var job: jobs.length ? jobs[0] : null
  readonly property int downloads: !batchMode && job && job.oldNode ? Migrate.downloaded(job.oldNode).length : 0
  readonly property string hint: ({
    search: "hjkl move   enter choose   / search   r retry   esc cancel   ",
    from: "j k move   enter choose   esc cancel   ",
    to: "j k move   enter choose   esc back   ",
    match: "j k move   h l another match or skip   enter continue   r retry   esc back   ",
    confirm: "enter migrate   c copy   " + (batchMode || downloads ? "d downloads   " : "") + "esc back   ",
    busy: running ? "" : "esc close   ",
    done: "j k move   enter close   "
  })[step] || ""

  readonly property var rows: {
    if (step === "from") return froms.map(function(s) { return { left: s.name, right: s.manga.length + " manga" } })
    if (step === "to") return tos.map(function(s) { return { left: s.name, right: s.lang } })
    if (step === "match" && batch) return batch.manga.map(function(m, i) { return { left: m.title, right: Migrate.matchStatus(view.batch, i, view.configPath) } })
    if (step === "done") return jobs.map(function(j) { return { left: j.old.title + "   to   " + j.target.title, right: j.result } })
    return []
  }

  readonly property string heading: {
    if (step === "search" && old) return "Migrate " + old.title + " from " + old.source + ": pick its match"
    if (step === "from") return "Migrate a source: the source to move manga from"
    if (step === "to" && from) return "Move " + from.manga.length + " manga from " + from.name + " to"
    if (step === "match" && to) return "Matches on " + to.name
    if (step === "done") return "Done"
    return ""
  }

  signal key(var event)
  signal editEnded()
  // The library changed.
  signal libraryChanged()
  // One manga migrated: show its target.
  signal migrated(int mangaId)

  visible: open
  color: theme.background

  onConfigChanged: close()
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

  function close() {
    if (editing) endEdit()
    seq++
    step = ""
    search = null
    batch = null
    jobs = []
  }

  function fail(reply) {
    var p = Model.problem(reply, configPath)
    busyText = p ? p.title + ". " + p.detail : reply.message
    step = "busy"
  }

  function loadSources(done) {
    var s = seq
    var cfg = config
    busyText = "Loading sources"
    step = "busy"
    send({ query: Browse.SOURCES_QUERY }, function(reply) {
      if (s !== view.seq) return
      var src = Browse.sources(reply, cfg, view.showNsfw, false)
      if (src.state !== "ok") view.fail(src)
      else done(src.sources)
    })
  }

  // manga: the open detail's manga. Only a library manga migrates.
  function startSingle(manga) {
    if (!config || !manga || !manga.inLibrary || running) return
    seq++
    batchMode = false
    old = manga
    jobs = []
    loadSources(function(sources) {
      view.search = GlobalSearch.search(Migrate.targets(sources, manga.sourceId, manga.sourceName), manga.title)
      view.searchCursor = { row: 0, col: 0 }
      view.step = "search"
      view.pumpSearch()
    })
  }

  function startBatch() {
    if (!config || running) return
    seq++
    batchMode = true
    jobs = []
    busyText = "Loading the library"
    step = "busy"
    var s = seq
    send({ query: Migrate.LIBRARY_QUERY }, function(reply) {
      if (s !== view.seq) return
      if (reply.state !== "ok") return view.fail(reply)
      view.froms = Migrate.librarySources(reply.data)
      view.cursor = 0
      view.step = "from"
    })
  }

  function pumpSearch() {
    var s = seq
    var cfg = config
    GlobalSearch.due(search).forEach(function(i) {
      var payload = GlobalSearch.payload(view.search.groups[i])
      view.search = GlobalSearch.reduce(view.search, i, { type: "request" })
      send(payload, function(reply) {
        if (s !== view.seq) return
        view.search = GlobalSearch.reduce(view.search, i, { type: "reply", reply: reply, config: cfg })
        view.pumpSearch()
      })
    })
  }

  function pumpBatch() {
    var s = seq
    var cfg = config
    Migrate.due(batch).forEach(function(i) {
      var payload = GlobalSearch.payload(view.batch.search.groups[i])
      view.batch = Migrate.reduceBatch(view.batch, i, { type: "request" })
      send(payload, function(reply) {
        if (s !== view.seq) return
        view.batch = Migrate.reduceBatch(view.batch, i, { type: "reply", reply: reply, config: cfg })
        view.pumpBatch()
      })
    })
  }

  function setJob(i, changes) {
    jobs = jobs.map(function(j, k) { return k === i ? Object.assign({}, j, changes) : j })
  }

  // Reads the old manga from the server's database, never its source, and
  // fetches the target with its chapters. done(failedReply or null).
  function prepare(i, done) {
    var j = jobs[i]
    send({ query: Migrate.OLD_QUERY, variables: { id: j.old.id } }, function(r1) {
      if (r1.state !== "ok") return done(r1)
      view.send({ query: Migrate.TARGET_MUTATION, variables: { id: j.target.id } }, function(r2) {
        if (r2.state !== "ok") return done(r2)
        var oldNode = r1.data.manga
        var chapters = r2.data.fetchMangaAndChapters.chapters
        view.setJob(i, { oldNode: oldNode, chapters: chapters, plan: Migrate.plan(oldNode.chapters.nodes, chapters) })
        done(null)
      })
    })
  }

  function errorText(reply) {
    var p = Model.problem(reply, configPath)
    return reply.message || (p ? p.title : reply.state)
  }

  // Runs to the end even if the view closes: each manga's writes are
  // already on their way.
  function apply(replace) {
    running = true
    step = "busy"
    runJob(0, replace)
  }

  function runJob(i, replace) {
    if (i >= jobs.length) return finish()
    var j = jobs[i]
    busyText = (replace ? "Migrating " : "Copying ") + (i + 1) + " of " + jobs.length + ": " + j.old.title
    var next = function(result) {
      view.setJob(i, { result: result })
      view.runJob(i + 1, replace)
    }
    var write = function() {
      var p = view.jobs[i]
      view.send(Migrate.targetPayload(p.oldNode, p.target.id, p.plan), function(reply) {
        if (reply.state !== "ok") return next("Failed: " + view.errorText(reply))
        var done = (replace ? "Migrated. " : "Copied. ") + Migrate.planText(p.plan, p.chapters.length)
        var after = Migrate.oldPayload(p.oldNode, replace, view.deleteDownloads)
        if (!after) return next(done)
        view.send(after, function(r) {
          next(r.state === "ok" ? done : done + " The old manga: " + view.errorText(r))
        })
      })
    }
    if (j.plan) return write()
    prepare(i, function(failed) {
      if (failed) next("Failed: " + view.errorText(failed))
      else write()
    })
  }

  function finish() {
    running = false
    libraryChanged()
    var j = jobs[0]
    if (!batchMode && step === "busy" && j && j.result.indexOf("Failed") !== 0) {
      close()
      migrated(j.target.id)
      return
    }
    cursor = 0
    if (step === "busy") step = "done"
  }

  function endEdit() {
    editing = false
    editEnded()
  }

  function moveList(delta) {
    if (rows.length) cursor = Math.max(0, Math.min(rows.length - 1, cursor + delta))
  }

  function run(id) {
    switch (id) {
      case "migrate.back":
        if (step === "busy" && running) break
        // The searches keep running under the confirm, so going back to
        // them drops nothing.
        if (step === "confirm") {
          step = batchMode ? "match" : "search"
          break
        }
        if (step === "to") {
          step = "from"
        } else if (step === "match") {
          seq++
          step = "to"
        } else {
          close()
        }
        cursor = 0
        break
      case "migrate.up":
      case "migrate.down":
      case "migrate.left":
      case "migrate.right":
        var dRow = id === "migrate.up" ? -1 : id === "migrate.down" ? 1 : 0
        var dCol = id === "migrate.left" ? -1 : id === "migrate.right" ? 1 : 0
        if (step === "search") searchCursor = GlobalSearch.move(search, searchCursor, dRow, dCol)
        else if (step === "match" && dCol) batch = Migrate.pick(batch, cursor, dCol)
        else moveList(dRow)
        break
      case "migrate.retry":
        if (step === "search") {
          search = GlobalSearch.retry(search)
          pumpSearch()
        } else {
          batch = Migrate.retry(batch)
          pumpBatch()
        }
        break
      case "migrate.search":
        editing = true
        globalView.searchField.text = search.query
        globalView.searchField.selectAll()
        globalView.searchField.forceActiveFocus()
        break
      case "migrate.commit":
        var q = globalView.searchField.text.trim()
        endEdit()
        if (!q) break
        seq++
        search = GlobalSearch.search(search.groups.map(function(g) { return g.source }), q)
        searchCursor = { row: 0, col: 0 }
        pumpSearch()
        break
      case "migrate.cancel":
        endEdit()
        break
      case "migrate.open":
        if (step === "search") {
          var t = GlobalSearch.current(search, searchCursor)
          if (!t) break
          jobs = [{ old: { id: old.id, title: old.title }, target: { id: t.id, title: t.title, source: search.groups[searchCursor.row].source.name }, result: "" }]
          busyText = "Reading " + t.title
          step = "busy"
          prepare(0, function(failed) {
            if (view.step !== "busy") return
            if (failed) view.fail(failed)
            else view.step = "confirm"
          })
        } else if (step === "from") {
          from = froms[cursor] || null
          if (!from) break
          var chosen = from
          loadSources(function(sources) {
            view.tos = Migrate.targets(sources, chosen.id, chosen.sourceName)
            view.cursor = 0
            view.step = "to"
          })
        } else if (step === "to") {
          to = tos[cursor] || null
          if (!to) break
          seq++
          batch = Migrate.batch(to, from.manga)
          cursor = 0
          step = "match"
          pumpBatch()
        } else if (step === "match") {
          var target = to
          jobs = Migrate.jobs(batch).map(function(j) { return { old: j.old, target: { id: j.target.id, title: j.target.title, source: target.name }, result: "" } })
          if (jobs.length) step = "confirm"
        } else if (step === "confirm") {
          apply(true)
        } else if (step === "done") {
          close()
        }
        break
      case "migrate.copy":
        apply(false)
        break
      case "migrate.downloads":
        deleteDownloads = !deleteDownloads
        break
    }
  }

  Text {
    id: head
    anchors.top: parent.top
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    visible: text !== ""
    wrapMode: Text.Wrap
    text: view.heading
    color: view.theme.accent
    font.family: view.theme.fontFamily
    font.pixelSize: view.theme.fontSize
  }

  GlobalSearchView {
    id: globalView
    anchors.top: head.bottom
    anchors.bottom: parent.bottom
    anchors.left: parent.left
    anchors.right: parent.right
    visible: view.step === "search"
    theme: view.theme
    search: view.search
    cursor: view.searchCursor
    editing: view.editing
    configPath: view.configPath
    onKey: function(event) { view.key(event) }
  }

  ListView {
    id: list
    anchors.top: head.bottom
    anchors.bottom: parent.bottom
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    visible: ["from", "to", "match", "done"].indexOf(view.step) !== -1
    clip: true
    model: view.rows

    delegate: Rectangle {
      id: row
      required property var modelData
      required property int index
      readonly property bool current: index === view.cursor
      width: list.width
      height: view.theme.fontSize * 2.2
      color: current ? view.theme.selected : "transparent"

      Text {
        id: left
        anchors.left: parent.left
        anchors.leftMargin: view.theme.fontSize * 0.5
        anchors.verticalCenter: parent.verticalCenter
        width: Math.min(implicitWidth, parent.width * 0.55)
        elide: Text.ElideRight
        text: row.modelData.left
        color: row.current ? view.theme.selectedText : view.theme.foreground
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
      }

      Text {
        anchors.left: left.right
        anchors.leftMargin: view.theme.fontSize * 1.5
        anchors.right: parent.right
        anchors.rightMargin: view.theme.fontSize * 0.5
        anchors.verticalCenter: parent.verticalCenter
        elide: Text.ElideRight
        text: row.modelData.right
        color: /^Failed|^skip|^No manga|needs|error|not running|rejected/.test(row.modelData.right) ? view.theme.urgent : row.current ? view.theme.selectedText : view.theme.muted
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }
    }
  }

  Column {
    anchors.centerIn: parent
    width: Math.min(parent.width - view.theme.fontSize * 4, view.theme.fontSize * 50)
    spacing: view.theme.fontSize * 0.6
    visible: view.step === "confirm" || view.step === "busy"

    Repeater {
      model: {
        if (view.step === "busy") return [{ text: view.busyText, strong: true }]
        if (view.step !== "confirm" || !view.job) return []
        var j = view.job
        var lines = []
        if (view.batchMode) {
          lines.push({ text: "Migrate " + view.jobs.length + " of " + view.batch.manga.length + " manga from " + view.from.name + " to " + view.to.name + ".", strong: true })
          lines.push({ text: "Each keeps its read chapters, bookmarks and categories, matched by chapter number." })
          lines.push({ text: "d   Delete the old manga's downloads: " + (view.deleteDownloads ? "yes" : "no") })
        } else {
          var names = view.categories.filter(function(c) { return j.oldNode.categories.nodes.some(function(n) { return n.id === c.id }) }).map(function(c) { return c.name })
          lines.push({ text: "Migrate " + view.old.title + " from " + view.old.source + " to " + j.target.title + " on " + j.target.source + ".", strong: true })
          lines.push({ text: Migrate.planText(j.plan, j.chapters.length) })
          lines.push({ text: "Categories: " + (names.join(", ") || "Default") })
          if (view.downloads) lines.push({ text: "d   Delete its " + view.downloads + " downloaded chapters: " + (view.deleteDownloads ? "yes" : "no") })
        }
        lines.push({ text: "enter   Migrate: the old manga leaves the library." })
        lines.push({ text: "c   Copy: the old manga stays in the library." })
        return lines
      }

      Text {
        required property var modelData
        width: parent.width
        wrapMode: Text.Wrap
        text: modelData.text
        color: modelData.strong ? view.theme.foreground : view.theme.muted
        font.family: view.theme.fontFamily
        font.pixelSize: modelData.strong ? view.theme.fontHeading : view.theme.fontSize
      }
    }
  }
}
