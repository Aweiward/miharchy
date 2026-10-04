pragma ComponentBehavior: Bound

import QtQuick
import "Commands.js" as Commands
import "Model.js" as Model
import "Browse.js" as Browse

// The Browse view past its extensions: the source list and a source's
// manga. It talks to the server itself; Browse.js decides. shell.qml
// forwards every "browse.", "sources." and "source." command to run(),
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

  // "sources" | "extensions" | "source"
  property string screen: "sources"
  property var src: ({ state: "idle", message: "", sources: [] })
  property int sourceCursor: 0
  property var listing: null
  property int gridCursor: 0
  // "" | "source": the search field is open.
  property string editing: ""
  // Only the latest request of each kind may update its state.
  property int sourcesSeq: 0
  property int listingSeq: 0

  readonly property var hint: ({
    sources: "j k move   enter open   l languages   r refresh   tab extensions   ",
    extensions: "r refresh   tab sources   ",
    source: "hjkl move   enter open   p popular   n latest   / search   r retry   esc back   "
  })[screen]

  signal key(var event)
  signal editEnded()
  signal openManga(int mangaId)

  onActiveChanged: if (active && screen === "sources" && src.state === "idle") loadSources()
  onConfigChanged: {
    if (editing) closeSearch()
    sourcesSeq++
    listingSeq++
    screen = "sources"
    listing = null
    src = config ? { state: "idle", message: "", sources: [] } : { state: "no-config", message: "", sources: [] }
    if (active && config) loadSources()
  }
  onShowNsfwChanged: if (src.state !== "idle") loadSources()

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

  function openListing(mode, query) {
    // Before the new listing lands: the emptied grid reports its end at
    // once, and the page that starts must carry the new number.
    listingSeq++
    listing = Browse.listing(listing.source, mode, query)
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

  function run(id) {
    switch (id) {
      case "browse.tab":
        screen = screen === "sources" ? "extensions" : "sources"
        if (screen === "sources") loadSources()
        break
      case "browse.back":
        if (screen === "source") {
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
        if (q) openListing("search", q)
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

        Image {
          id: sourceIcon
          x: view.theme.fontSize * 0.5
          anchors.verticalCenter: parent.verticalCenter
          width: view.theme.fontSize * 1.7
          height: width
          source: row.modelData.icon
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
    listing: view.listing
    cursor: view.gridCursor
    editing: view.editing === "source"
    notice: view.listing ? Browse.notice(view.listing, view.configPath) : null
    onKey: function(event) { view.key(event) }
    onNearEnd: view.moreManga()
  }
}
