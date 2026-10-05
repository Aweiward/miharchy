pragma ComponentBehavior: Bound

import QtQuick
import "Commands.js" as Commands
import "Model.js" as Model
import "Browse.js" as Browse
import "GlobalSearch.js" as GlobalSearch
import "Widgets.js" as Widgets

// The Browse view past its extensions: the source list, a source's manga
// and a search across every source, and a source's filters or settings
// over them. It talks to the server itself; Browse.js, GlobalSearch.js and
// Widgets.js decide. shell.qml forwards every "browse.", "sources.",
// "source.", "global." and "panel." command to run(), reads scope,
// shows ExtensionsView while screen is "extensions", and opens a manga's
// detail on openManga.
Item {
  id: view

  required property Theme theme
  property var config: null
  property string configPath: ""
  property bool active: false
  property bool showNsfw: false
  property bool allLanguages: false

  // "sources" | "extensions" | "source" | "global"
  property string screen: "sources"
  property var src: ({ state: "idle", message: "", sources: [] })
  property int sourceCursor: 0
  property var listing: null
  property int gridCursor: 0
  property var global: null
  property var globalCursor: ({ row: 0, col: 0 })
  // A source's filters or settings (Widgets.panel) over the screen, or null.
  property var panel: null
  // Each source's filter panel by source id, kept for the window's life
  // as Mihon keeps them for its browse screen; never stored.
  property var filterPanels: ({})
  // The path of the text row the panel field types.
  property var panelEditPath: null
  readonly property var panelRows: panel ? Widgets.rows(panel.widgets, panel.open) : []
  // The command scope: the open panel, else the screen.
  readonly property string scope: panel ? (panel.kind === "filters" ? "source-filters" : "source-settings") : screen
  // "" | "source" | "global" | "panel": a text field is open.
  property string editing: ""
  // Only the latest request of each kind may update its state.
  property int sourcesSeq: 0
  property int listingSeq: 0
  property int globalSeq: 0
  property int panelSeq: 0
  // The global search's requests by group index, to abort.
  property var globalXhrs: []

  readonly property string settingsHint: {
    var s = screen === "source" && listing ? listing.source : src.sources[sourceCursor]
    return s && s.configurable ? "S settings   " : ""
  }
  readonly property var hint: ({
    sources: "j k move   enter open   / search all   l languages   " + settingsHint + "r refresh   tab extensions   ",
    extensions: "r refresh   tab sources   ",
    source: "hjkl move   enter open   p popular   n latest   / search   F filter   " + settingsHint + "r retry   esc back   ",
    global: "hjkl move   enter open   / search   r retry   esc back   ",
    "source-filters": "j k move   enter change   a apply   x reset   esc close   ",
    "source-settings": "j k move   enter change   esc close   "
  })[scope]

  signal key(var event)
  signal editEnded()
  signal openManga(int mangaId)

  onActiveChanged: if (active && screen === "sources" && src.state === "idle") loadSources()
  onConfigChanged: {
    if (editing) closeSearch()
    sourcesSeq++
    listingSeq++
    globalSeq++
    panelSeq++
    screen = "sources"
    listing = null
    global = null
    panel = null
    filterPanels = {}
    src = config ? { state: "idle", message: "", sources: [] } : { state: "no-config", message: "", sources: [] }
    if (active && config) loadSources()
  }
  onShowNsfwChanged: if (src.state !== "idle") loadSources()
  // Frees the connections a dropped search still holds.
  onGlobalSeqChanged: {
    globalXhrs.forEach(function(x) { x.abort() })
    globalXhrs = []
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
    return xhr
  }

  function loadSources() {
    if (!config) return
    var seq = ++sourcesSeq
    var cfg = config
    src = { state: "loading", message: "", sources: src.sources }
    send({ query: Browse.SOURCES_QUERY }, function(reply) {
      if (seq !== view.sourcesSeq) return
      view.src = Browse.sources(reply, cfg, view.showNsfw, view.allLanguages)
      view.sourceCursor = Math.min(view.sourceCursor, Math.max(0, view.src.sources.length - 1))
    })
  }

  function openListing(mode, query, filters) {
    // Before the new listing lands: the emptied grid reports its end at
    // once, and the page that starts must carry the new number.
    listingSeq++
    listing = Browse.listing(listing.source, mode, query, filters)
    gridCursor = 0
    moreManga()
  }

  function moreManga() {
    var payload = listing ? Browse.listingPayload(listing) : null
    if (!payload) return
    var seq = listingSeq
    var cfg = config
    listing = Browse.reduceListing(listing, { type: "request" })
    send(payload, function(reply) {
      if (seq !== view.listingSeq) return
      view.listing = Browse.reduceListing(view.listing, { type: "reply", reply: reply, config: cfg })
      if (view.listing.items.length && view.gridCursor >= view.listing.items.length - grid.columns * 2) view.moreManga()
    })
  }

  function markInLibrary(mangaId, inLibrary) {
    if (listing) listing = Browse.markInLibrary(listing, mangaId, inLibrary)
    if (global) global = GlobalSearch.markInLibrary(global, mangaId, inLibrary)
  }

  // Starts every group with a free slot; each reply or timeout starts the
  // next.
  function pumpGlobal() {
    var seq = globalSeq
    var cfg = config
    GlobalSearch.due(global).forEach(function(i) {
      var payload = GlobalSearch.payload(view.global.groups[i])
      view.global = GlobalSearch.reduce(view.global, i, { type: "request", now: Date.now() })
      var attempt = view.global.groups[i].attempt
      view.globalXhrs[i] = send(payload, function(reply) {
        if (seq !== view.globalSeq) return
        view.global = GlobalSearch.reduce(view.global, i, { type: "reply", attempt: attempt, reply: reply, config: cfg })
        view.pumpGlobal()
      })
    })
  }

  // Times out before aborting: abort() answers at once with status 0,
  // which would read as a server that is down.
  function expireGlobal() {
    GlobalSearch.expired(global, Date.now()).forEach(function(i) {
      view.global = GlobalSearch.reduce(view.global, i, { type: "timeout" })
      view.globalXhrs[i].abort()
    })
    pumpGlobal()
  }

  function moveGrid(delta) {
    if (!listing || !listing.items.length) return
    gridCursor = Math.max(0, Math.min(listing.items.length - 1, gridCursor + delta))
    if (gridCursor >= listing.items.length - grid.columns * 2) moreManga()
  }

  function closeSearch() {
    editing = ""
    editEnded()
  }

  // A filter panel reopens as it was left; settings always load fresh.
  function openPanel(kind, source) {
    panelSeq++
    var kept = kind === "filters" ? filterPanels[source.id] : null
    panel = kept || Widgets.panel(kind, source)
    if (kept) return
    var seq = panelSeq
    send(Widgets.loadPayload(panel), function(reply) {
      if (seq !== view.panelSeq) return
      view.panel = Widgets.reducePanel(view.panel, { type: "reply", reply: reply })
      if (view.panel.kind === "filters" && view.panel.state === "ok") view.filterPanels[source.id] = view.panel
    })
  }

  // Settings save at once; filters wait for apply.
  function editPanel(widgets, path) {
    var before = panel.widgets
    panel = Widgets.reducePanel(panel, { type: "edit", widgets: widgets })
    if (panel.kind === "filters") {
      filterPanels[panel.source.id] = panel
      return
    }
    var seq = panelSeq
    send(Widgets.savePayload(panel, path), function(reply) {
      if (seq !== view.panelSeq) return
      view.panel = Widgets.reducePanel(view.panel, { type: "reply", reply: reply, before: before })
    })
  }

  // Closing settings over a source loads it again, so the listing shows
  // what the new values give.
  function closePanel() {
    if (editing === "panel") closeSearch()
    var stale = panel.kind === "preferences" && panel.saved && screen === "source"
    panelSeq++
    panel = null
    if (stale) openListing(listing.mode, listing.query, listing.filters)
  }

  function run(id) {
    switch (id) {
      case "browse.tab":
        screen = screen === "sources" ? "extensions" : "sources"
        if (screen === "sources") loadSources()
        break
      case "browse.back":
        if (screen === "global") {
          globalSeq++
          global = null
          screen = "sources"
        } else if (screen === "source") {
          listingSeq++
          screen = "sources"
        }
        break
      case "sources.up":
      case "sources.down":
        sourceCursor = Commands.moveCursor(sourceCursor, id === "sources.up" ? -1 : 1, src.sources.length)
        break
      case "sources.open":
        var s = src.sources[sourceCursor]
        if (!s) break
        listing = Browse.listing(s, "popular", "")
        screen = "source"
        openListing("popular", "")
        break
      case "sources.languages":
        allLanguages = !allLanguages
        loadSources()
        break
      case "sources.refresh":
        loadSources()
        break
      case "source.left":
        moveGrid(-1)
        break
      case "source.right":
        moveGrid(1)
        break
      case "source.up":
        moveGrid(-grid.columns)
        break
      case "source.down":
        moveGrid(grid.columns)
        break
      case "source.popular":
        openListing("popular", "")
        break
      case "source.latest":
        openListing("latest", "")
        break
      case "source.search":
        editing = "source"
        grid.searchField.text = listing.mode === "search" ? listing.query : ""
        grid.searchField.selectAll()
        grid.searchField.forceActiveFocus()
        break
      case "source.commit":
        var q = grid.searchField.text.trim()
        closeSearch()
        // As Mihon: a search from a search keeps its filters; from
        // popular or latest it starts without them.
        if (q) openListing("search", q, listing.mode === "search" ? listing.filters : [])
        break
      case "source.filters":
        openPanel("filters", listing.source)
        break
      case "source.settings":
        var ss = screen === "source" ? listing.source : src.sources[sourceCursor]
        if (ss && ss.configurable) openPanel("preferences", ss)
        break
      case "panel.up":
      case "panel.down":
        panel = Widgets.reducePanel(panel, { type: "move", delta: id === "panel.up" ? -1 : 1 })
        break
      case "panel.choose":
        if (panel.state !== "ok") break
        var row = panelRows[panel.cursor]
        var act = Widgets.activate(panel.widgets, row)
        if (act.toggle) {
          panel = Widgets.reducePanel(panel, { type: "toggle", key: act.toggle })
        } else if (act.widgets) {
          editPanel(act.widgets, row.path)
        } else if (act.edit !== undefined) {
          panelEditPath = row.path
          editing = "panel"
          panelView.field.text = act.edit
          panelView.field.selectAll()
          panelView.field.forceActiveFocus()
        }
        break
      case "panel.commit":
        var typed = panelView.field.text
        closeSearch()
        editPanel(Widgets.setText(panel.widgets, panelEditPath, typed), panelEditPath)
        break
      case "panel.cancel":
        closeSearch()
        break
      case "panel.reset":
        if (panel.state === "ok") editPanel(Widgets.reset(panel.widgets), null)
        break
      case "panel.apply":
        if (panel.state !== "ok") break
        // Filters reach a source only in a search, so applying searches,
        // with the query of a search already showing.
        var applied = Widgets.filterChanges(panel.widgets)
        closePanel()
        openListing("search", listing.mode === "search" ? listing.query : "", applied)
        break
      case "panel.closeFilters":
      case "panel.closeSettings":
        closePanel()
        break
      case "source.cancel":
        closeSearch()
        break
      case "source.retry":
        listing = Browse.reduceListing(listing, { type: "retry" })
        moreManga()
        break
      case "source.open":
        var m = listing && listing.items[gridCursor]
        if (m) openManga(m.id)
        break
      case "global.search":
        screen = "global"
        editing = "global"
        globalView.searchField.text = global ? global.query : ""
        globalView.searchField.selectAll()
        globalView.searchField.forceActiveFocus()
        break
      case "global.commit":
        var gq = globalView.searchField.text.trim()
        closeSearch()
        if (gq) {
          globalSeq++
          global = GlobalSearch.search(src.sources, gq)
          globalCursor = { row: 0, col: 0 }
          pumpGlobal()
        } else if (!global) {
          screen = "sources"
        }
        break
      case "global.cancel":
        closeSearch()
        if (!global) screen = "sources"
        break
      case "global.left":
      case "global.right":
      case "global.up":
      case "global.down":
        if (global) globalCursor = GlobalSearch.move(global, globalCursor, id === "global.up" ? -1 : id === "global.down" ? 1 : 0, id === "global.left" ? -1 : id === "global.right" ? 1 : 0)
        break
      case "global.retry":
        if (!global) break
        global = GlobalSearch.retry(global)
        pumpGlobal()
        break
      case "global.open":
        var gm = global && GlobalSearch.current(global, globalCursor)
        if (gm) openManga(gm.id)
        break
    }
  }

  Item {
    anchors.fill: parent
    visible: view.screen === "sources"

    Text {
      id: sourcesProblem
      anchors.top: parent.top
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.margins: view.theme.fontSize * 2
      visible: text !== ""
      wrapMode: Text.Wrap
      text: { var p = Model.problem(view.src, view.configPath); return p ? p.title + ". " + p.detail : "" }
      color: view.theme.urgent
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSize
    }

    ListView {
      id: sourceList
      anchors.top: sourcesProblem.visible ? sourcesProblem.bottom : parent.top
      anchors.bottom: parent.bottom
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.margins: view.theme.fontSize * 2
      clip: true
      model: view.src.sources
      currentIndex: view.sourceCursor
      highlightFollowsCurrentItem: false
      onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)

      delegate: Rectangle {
        id: row
        required property var modelData
        required property int index
        readonly property bool current: index === view.sourceCursor
        width: sourceList.width
        height: view.theme.fontSize * 2.4
        color: current ? view.theme.selected : "transparent"

        ServerImage {
          id: sourceIcon
          x: view.theme.fontSize * 0.5
          anchors.verticalCenter: parent.verticalCenter
          width: view.theme.fontSize * 1.7
          height: width
          config: view.config
          url: row.modelData.icon
          sourceSize.width: width
          asynchronous: true
        }

        Text {
          id: sourceName
          anchors.left: sourceIcon.right
          anchors.leftMargin: view.theme.fontSize * 0.75
          anchors.verticalCenter: parent.verticalCenter
          text: row.modelData.name
          color: row.current ? view.theme.selectedText : view.theme.foreground
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize
        }

        Text {
          anchors.left: sourceName.right
          anchors.leftMargin: view.theme.fontSize * 0.75
          anchors.verticalCenter: parent.verticalCenter
          text: row.modelData.lang + (row.modelData.warning === "NSFW" ? "   18+" : "")
          color: view.theme.muted
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSmall
        }
      }
    }

    Text {
      anchors.centerIn: sourceList
      visible: view.src.sources.length === 0 && Model.problem(view.src, view.configPath) === null
      text: view.src.state === "ok" ? "No source yet. Press tab, then install an extension." : "Loading sources"
      color: view.theme.muted
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSize
    }
  }

  SourceGrid {
    id: grid
    anchors.fill: parent
    visible: view.screen === "source"
    theme: view.theme
    config: view.config
    listing: view.listing
    cursor: view.gridCursor
    editing: view.editing === "source"
    notice: view.listing ? Browse.notice(view.listing, view.configPath) : null
    onKey: function(event) { view.key(event) }
    onNearEnd: view.moreManga()
  }

  Timer {
    interval: 1000
    repeat: true
    running: view.global !== null && view.global.groups.some(function(g) { return g.state === "loading" })
    onTriggered: view.expireGlobal()
  }

  GlobalSearchView {
    id: globalView
    anchors.fill: parent
    visible: view.screen === "global"
    theme: view.theme
    config: view.config
    search: view.global
    cursor: view.globalCursor
    editing: view.editing === "global"
    configPath: view.configPath
    onKey: function(event) { view.key(event) }
  }

  WidgetPanel {
    id: panelView
    anchors.top: parent.top
    anchors.bottom: parent.bottom
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    width: Math.min(parent.width - view.theme.fontSize * 4, view.theme.fontSize * 34)
    visible: view.panel !== null
    theme: view.theme
    title: !view.panel ? "" : view.panel.kind === "filters" ? "Filter " + view.panel.source.name : view.panel.source.name + " settings"
    rows: view.panelRows
    cursor: view.panel ? view.panel.cursor : 0
    editing: view.editing === "panel"
    editLabel: view.editing === "panel" && view.panelEditPath ? (view.panelRows.filter(function(r) { return r.option === -1 && r.path.join("/") === view.panelEditPath.join("/") }).map(function(r) { return r.label })[0] || "") : ""
    problem: {
      if (!view.panel) return ""
      if (view.panel.state === "loading") return "Loading"
      var p = Model.problem(view.panel, view.configPath)
      if (p) return p.title + ". " + p.detail
      if (view.panel.error) return "Not saved: " + view.panel.error
      return view.panel.state === "ok" && view.panelRows.length === 0 ? (view.panel.kind === "filters" ? "This source has no filters." : "This source has no settings.") : ""
    }
    onKey: function(event) { view.key(event) }
  }
}
