pragma ComponentBehavior: Bound

import QtQuick
import "Commands.js" as Commands
import "Model.js" as Model
import "Session.js" as Session
import "Browse.js" as Browse
import "GlobalSearch.js" as GlobalSearch
import "Migrate.js" as Migrate

// Migrate over the view that opened it: one manga from its detail (search
// every other source for its title, pick the match, confirm), or a batch:
// every library manga of one source, or the library check's selection.
// A batch searches each manga's same-named and pinned sources in order,
// or with neither the one target picked for all; then each match. It
// talks to the server itself; Migrate.js decides. shell.qml forwards every
// "migrate." command to run().
Rectangle {
  id: view

  required property Theme theme
  property var config: null
  property string configPath: ""
  property bool showNsfw: false
  // The library's categories, to name the ones that move.
  property var categories: []
  // Browse.pinned(): the pinned source ids, in pin order.
  property var pinned: []

  // "" (closed) | "search" | "from" | "to" | "match" | "confirm" | "busy" | "done"
  property string step: ""
  property bool batchMode: false
  // One manga: its detail's manga, and the search across the other sources.
  property var old: null
  property var search: null
  property var searchCursor: ({ row: 0, col: 0 })
  property bool editing: false
  // A batch: Migrate.librarySources() and the one chosen (null for the
  // library check's), the manga, the targets and the one chosen when no
  // manga has a source to search, and the batch.
  property var froms: []
  property var from: null
  property var manga: []
  property var tos: []
  property var to: null
  property var batch: null
  property int cursor: 0
  // Each { old: { id, title }, target: { id, title, source }, result, ok }, and
  // once read: oldNode, chapters and plan.
  property var jobs: []
  property bool deleteDownloads: true
  property bool withTracks: true
  // The library check's merge: the copy that stays, { meta, trackRecords },
  // whose own state wins (Migrate.targetPayload). null for a migration.
  property var merge: null
  property bool running: false
  property string busyText: ""
  // Bumped on close and on going back, so stale replies drop.
  property int seq: 0
  // The searches' requests by group index, to abort.
  property var searchXhrs: []
  property var batchXhrs: []

  readonly property bool open: step !== ""
  readonly property var job: jobs.length ? jobs[0] : null
  readonly property int downloads: !batchMode && job && job.oldNode ? Migrate.downloaded(job.oldNode).length : 0
  readonly property var tracks: !batchMode && job && job.oldNode ? Migrate.movingTracks(job.oldNode, merge) : []
  readonly property string hint: ({
    search: "hjkl move   enter choose   / search   r retry   esc cancel   ",
    from: "j k move   enter choose   esc cancel   ",
    to: "j k move   enter choose   esc back   ",
    match: "j k move   h l another match or skip   enter continue   r retry   esc back   ",
    confirm: "enter migrate   c copy   " + (batchMode || downloads ? "d downloads   " : "") + (batchMode || tracks.length ? "t tracks   " : "") + "esc back   ",
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
    if (step === "to") return "Move " + manga.length + " manga" + (from ? " from " + from.name : "") + " to"
    if (step === "match") return to ? "Matches on " + to.name : "Matches on each manga's same-named source, then the pinned ones"
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
  // Frees the connections a dropped search still holds.
  onSeqChanged: {
    searchXhrs.concat(batchXhrs).forEach(function(x) { x.abort() })
    searchXhrs = []
    batchXhrs = []
  }
  onCursorChanged: list.positionViewAtIndex(cursor, ListView.Contain)

  function send(payload, done) {
    return Session.send(config, payload, done)
  }

  function close() {
    if (editing) endEdit()
    seq++
    step = ""
    merge = null
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
    merge = null
    old = manga
    jobs = []
    loadSources(function(sources) {
      view.search = GlobalSearch.search(Migrate.targets(sources, manga.sourceId, manga.sourceName), manga.title)
      view.searchCursor = { row: 0, col: 0 }
      view.step = "search"
      view.pumpSearch()
    })
  }

  // A migration whose target is already chosen: old, a library manga, to
  // manga, the open detail's (Mihon's migrate from the duplicate dialog), or
  // with merge (LibraryCheck.mergeJob) the library check's copy that stays.
  function startWith(old, manga, merge) {
    if (!config || !old || !manga || running) return
    seq++
    batchMode = false
    view.merge = merge || null
    search = null
    view.old = old
    pick({ id: manga.id, title: manga.title, source: manga.sourceName })
  }

  // target: { id, title, source } for the single migration of old.
  function pick(target) {
    jobs = [{ old: { id: old.id, title: old.title }, target: target, result: "" }]
    busyText = "Reading " + target.title
    step = "busy"
    prepare(0, function(failed) {
      if (view.step !== "busy") return
      if (failed) view.fail(failed)
      else view.step = "confirm"
    })
  }

  function startBatch() {
    if (!config || running) return
    seq++
    batchMode = true
    merge = null
    from = null
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

  // list: LibraryCheck.migrateList(). A stalled manga needs its highest
  // chapter number first.
  function startList(list) {
    if (!config || running || !list.length) return
    seq++
    batchMode = true
    merge = null
    from = null
    jobs = []
    var s = seq
    var go = function(withHighest) { view.loadSources(function(sources) { view.begin(withHighest, sources) }) }
    if (!list.some(function(m) { return m.stalled })) return go(list)
    busyText = "Reading the manga"
    step = "busy"
    send({ query: Migrate.HIGHEST_QUERY, variables: { ids: list.map(function(m) { return m.id }) } }, function(reply) {
      if (s !== view.seq) return
      if (reply.state !== "ok") return view.fail(reply)
      go(Migrate.withHighest(list, reply.data))
    })
  }

  // list: the batch's manga with sourceId and sourceName. With no
  // same-named or pinned source for any, the user picks one target.
  function begin(list, sources) {
    manga = list
    to = null
    var each = Migrate.withTargets(list, sources, pinned)
    if (each) return match(each)
    tos = sources.filter(function(s) { return !list.every(function(m) { return String(m.sourceId) === s.id }) })
    cursor = 0
    step = "to"
  }

  function match(each) {
    seq++
    batch = Migrate.batch(each)
    cursor = 0
    step = "match"
    pumpBatch()
  }

  function pumpSearch() {
    var s = seq
    var cfg = config
    GlobalSearch.due(search).forEach(function(i) {
      var payload = GlobalSearch.payload(view.search.groups[i])
      view.search = GlobalSearch.reduce(view.search, i, { type: "request", now: Date.now() })
      var attempt = view.search.groups[i].attempt
      view.searchXhrs[i] = send(payload, function(reply) {
        if (s !== view.seq) return
        view.search = GlobalSearch.reduce(view.search, i, { type: "reply", attempt: attempt, reply: reply, config: cfg })
        view.pumpSearch()
      })
    })
  }

  function pumpBatch() {
    var s = seq
    var cfg = config
    Migrate.checks(batch).forEach(function(i) {
      var payload = Migrate.checkPayload(view.batch, i)
      view.batch = Migrate.reduceBatch(view.batch, i, { type: "check" })
      view.batchXhrs[i] = send(payload, function(reply) {
        if (s !== view.seq) return
        view.batch = Migrate.reduceBatch(view.batch, i, { type: "checked", reply: reply })
        view.pumpBatch()
      })
    })
    Migrate.due(batch).forEach(function(i) {
      var payload = GlobalSearch.payload(view.batch.search.groups[i])
      view.batch = Migrate.reduceBatch(view.batch, i, { type: "request", now: Date.now() })
      var attempt = view.batch.search.groups[i].attempt
      view.batchXhrs[i] = send(payload, function(reply) {
        if (s !== view.seq) return
        view.batch = Migrate.reduceBatch(view.batch, i, { type: "reply", attempt: attempt, reply: reply, config: cfg })
        view.pumpBatch()
      })
    })
  }

  // Times out before aborting: abort() answers at once with status 0,
  // which would read as a server that is down.
  function expire() {
    var now = Date.now()
    if (search) GlobalSearch.expired(search, now).forEach(function(i) {
      view.search = GlobalSearch.reduce(view.search, i, { type: "timeout" })
      view.searchXhrs[i].abort()
    })
    if (batch) GlobalSearch.expired(batch.search, now).forEach(function(i) {
      view.batch = Migrate.reduceBatch(view.batch, i, { type: "timeout" })
      view.batchXhrs[i].abort()
    })
    if (search) pumpSearch()
    if (batch) pumpBatch()
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
    var next = function(result, ok) {
      view.setJob(i, { result: result, ok: ok === true })
      view.runJob(i + 1, replace)
    }
    var write = function() {
      var p = view.jobs[i]
      var tracks = view.withTracks ? Migrate.movingTracks(p.oldNode, view.merge).length : 0
      view.send(Migrate.targetPayload(p.oldNode, p.target.id, p.plan, view.withTracks, view.merge), function(reply) {
        if (reply.state !== "ok") return next("Failed: " + view.errorText(reply))
        var done = (replace ? "Migrated. " : "Copied. ") + Migrate.planText(p.plan, p.chapters.length) + (tracks ? " " + tracks + (tracks === 1 ? " track" : " tracks") + " along." : "")
        var after = Migrate.oldPayload(p.oldNode, replace, view.deleteDownloads)
        if (!after) return next(done, true)
        view.send(after, function(r) {
          if (r.state === "ok") next(done, true)
          else next(done + " Failed on the old manga: " + view.errorText(r))
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
    if (!batchMode && step === "busy" && j && j.ok) {
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

  // A click moves the cursor as the keys do (move() makes the change); a
  // double click then sends Enter. Not while the search field types.
  function point(move, twice) {
    if (editing) return
    move()
    if (twice) key(Commands.enter())
  }

  function moveList(delta) {
    if (rows.length) cursor = Math.max(0, Math.min(rows.length - 1, cursor + delta))
  }

  function run(id) {
    switch (id) {
      case "migrate.back":
        if (step === "busy" && running) break
        if (step === "busy" && !batchMode && search) {
          step = "search"
          break
        }
        // The searches keep running under the confirm, so going back to
        // them drops nothing.
        if (step === "confirm" && (batchMode || search)) {
          step = batchMode ? "match" : "search"
          break
        }
        if (step === "match") {
          seq++
          batch = null
        }
        if (step === "match" && to) {
          step = "to"
        } else if ((step === "to" || step === "match") && from) {
          step = "from"
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
          if (t) pick({ id: t.id, title: t.title, source: search.groups[searchCursor.row].source.name })
        } else if (step === "from") {
          from = froms[cursor] || null
          if (!from) break
          var chosen = from
          loadSources(function(sources) {
            view.begin(chosen.manga.map(function(m) { return { id: m.id, title: m.title, sourceId: chosen.id, sourceName: chosen.sourceName } }), sources)
          })
        } else if (step === "to") {
          to = tos[cursor] || null
          if (to) match(Migrate.withTarget(manga, to))
        } else if (step === "match") {
          jobs = Migrate.jobs(batch).map(function(j) { return { old: j.old, target: j.target, result: "" } })
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
      case "migrate.tracks":
        withTracks = !withTracks
        break
    }
  }

  Timer {
    interval: 1000
    repeat: true
    running: [view.search, view.batch && view.batch.search].some(function(s) { return s && s.groups.some(function(g) { return g.state === "loading" }) })
    onTriggered: view.expire()
  }

  // Over the whole window: a click never reaches the view below.
  MouseArea {
    anchors.fill: parent
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
    config: view.config
    search: view.search
    cursor: view.searchCursor
    editing: view.editing
    configPath: view.configPath
    onKey: function(event) { view.key(event) }
    onPicked: function(row, col, twice) { view.point(function() { view.searchCursor = { row: row, col: Math.max(0, col) } }, twice) }
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

      MouseArea {
        anchors.fill: parent
        onClicked: view.point(function() { view.cursor = row.index }, false)
        onDoubleClicked: view.point(function() { view.cursor = row.index }, true)
      }

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
        color: /Failed|^skip|^No manga|^No source|needs|error|not running|rejected/.test(row.modelData.right) ? view.theme.urgent : row.current ? view.theme.selectedText : view.theme.muted
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
          lines.push({ text: "Migrate " + view.jobs.length + " of " + view.batch.manga.length + " manga" + (view.from ? " from " + view.from.name : "") + (view.to ? " to " + view.to.name : " to their matches") + ".", strong: true })
          lines.push({ text: "Each keeps its read chapters, bookmarks and categories, matched by chapter number." })
          lines.push({ text: "d   Delete the old manga's downloads: " + (view.deleteDownloads ? "yes" : "no") })
          lines.push({ text: "t   Take the old manga's tracks along: " + (view.withTracks ? "yes" : "no") })
        } else {
          var names = view.categories.filter(function(c) { return j.oldNode.categories.nodes.some(function(n) { return n.id === c.id }) }).map(function(c) { return c.name })
          lines.push({ text: (view.merge ? "Merge " : "Migrate ") + view.old.title + " from " + view.old.source + (view.merge ? " into " : " to ") + j.target.title + " on " + j.target.source + ".", strong: true })
          lines.push({ text: Migrate.planText(j.plan, j.chapters.length) })
          lines.push({ text: view.merge ? "Keeps its own categories and adds: " + (names.join(", ") || "none") : "Categories: " + (names.join(", ") || "Default") })
          if (view.downloads) lines.push({ text: "d   Delete its " + view.downloads + " downloaded chapters: " + (view.deleteDownloads ? "yes" : "no") })
          if (view.tracks.length) lines.push({ text: "t   Take its tracks along (" + view.tracks.map(function(t) { return t.tracker }).join(", ") + "): " + (view.withTracks ? "yes" : "no") })
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
