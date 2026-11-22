pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import "Model.js" as Model
import "Session.js" as Session
import "Commands.js" as Commands
import "Settings.js" as Settings
import "Setup.js" as Setup
import "Chapters.js" as Chapters
import "Downloads.js" as Downloads
import "Library.js" as Library
import "Browse.js" as Browse
import "Storage.js" as Storage
import "Restart.js" as Restart
import "Images.js" as Images
import "Runtime.js" as Runtime
import "UpNext.js" as UpNext
import "Sync.js" as Sync
import "Overlays.js" as Overlays

// The Miharchy window, run as its own Quickshell process (ADR 0003):
// `quickshell -p window`. Decisions live in Model.js and Commands.js; this
// file wires them to the server, the theme and the views.
ShellRoot {
  id: root

  // Quickshell would reload the window in place when its files change. An
  // update writes them one at a time, so a reload can catch half of it, and
  // it drops the reader without the quit path's save. Q restarts instead.
  settings.watchFiles: false

  readonly property string configPath: Quickshell.env("MIHARCHY_SERVER_JSON") || Quickshell.env("HOME") + "/.config/miharchy/server.json"
  // The developer switch (ADR 0010): with MIHARCHY_BACKEND=core the views
  // moved so far (Extensions) talk to miharchy-core through core.json, and
  // the rest stay on Suwayomi. Users never set it; #373 flips the default.
  readonly property bool coreBackend: Quickshell.env("MIHARCHY_BACKEND") === "core"
  // A view on the server the Downloads view does not show says this.
  // A detail or reader on Suwayomi under the switch: a target from a mark
  // without the switch.
  readonly property string downloadsElsewhere: "This manga is open on Suwayomi; downloads run on miharchy-core"
  // Migrate follows the switch (#394), so its ids are that server's.
  readonly property string migrateElsewhere: coreBackend ? "This manga is open on Suwayomi; Migrate runs on miharchy-core"
    : "This manga is open on miharchy-core; Migrate runs on Suwayomi"
  readonly property string coreConfigPath: Quickshell.env("MIHARCHY_CORE_CONFIG") || Quickshell.env("HOME") + "/.config/miharchy/core.json"
  property var coreConfig: null
  // The library and categories on miharchy-core, beside connection's on
  // Suwayomi: Library, Categories and Updates show it with the switch on,
  // while Settings, Migrate and the status bar stay on connection.
  property var coreConnection: Model.initial()
  property int coreRequestSeq: 0
  property int coreOpenSeq: 0

  // The launcher's open-updates starts a window on Updates.
  property string view: Quickshell.env("MIHARCHY_OPEN_VIEW") === "updates" ? "updates" : "library"
  property var config: null
  property var connection: Model.initial()
  property bool paletteOpen: false
  // A mark read's question to the trackers (Chapters.trackAsk), or null.
  property var trackAsk: null
  // The top overlay's scope, editing prefix and hint (Overlays.js).
  readonly property var overlay: Overlays.top({ trackAsk: trackAsk, readingCard: readingCard, nextChapters: nextChapters, restoreView: restoreView, syncView: syncView, downloadsView: downloadsView, reader: reader, migrateView: migrateView, trackPanel: trackPanel, mangaDetail: mangaDetail, view: view, browseView: browseView, extensionsView: extensionsView, checkView: checkView, updatesView: updatesView, settingsEditing: settingsEditing, libraryView: libraryView, historyView: historyView, settingsView: settingsView, setupView: setupView, categoriesView: categoriesView })
  readonly property bool downloadedOnly: settingsState.values.downloadedOnly === true
  property var settingsState: Settings.initial()
  property int settingsCursor: 0
  property bool settingsEditing: false
  property string settingsError: ""
  // A save core refused: { key, message }, shown under that row until the next save.
  property var settingsRefusal: ({ key: "", message: "" })
  property int settingsSeq: 0
  // Only the latest library request may update the connection.
  property int requestSeq: 0
  // { mangaId, chapterId } to read once the config loads, or null.
  property var pendingChapter: Model.chapterTarget(Quickshell.env("MIHARCHY_OPEN_CHAPTER"))
  // The launcher's peek starts a window with MIHARCHY_PEEK=1, its
  // peek-next with MIHARCHY_PEEK=next, its peek-open with
  // MIHARCHY_PEEK="<mangaId> <chapterId>"; "" for none.
  property string pendingPeek: Quickshell.env("MIHARCHY_PEEK") || ""
  // The manga ids of Up next when the run of next presses began
  // (UpNext.after); in memory only.
  property var upNextOrder: []

  Theme { id: theme }

  // Whether the window's code on disk differs from what this process loaded,
  // as after `omarchy plugin update`. Q restarts on the new code.
  property var code: Restart.INITIAL
  property bool restarting: false

  Process {
    id: codeCheck
    command: Restart.fingerprintCommand(Quickshell.shellDir)
    stdout: StdioCollector {
      onStreamFinished: root.code = Restart.check(root.code, text)
    }
  }

  // The runtime folder (Runtime.js) is decided before the config applies:
  // all that writes there (server images, the reading card, Setup's QR
  // code) follows the config. heldConfig waits for it.
  property bool runtimeChecked: runtimeCheck.dir === ""
  property var heldConfig: null

  Process {
    id: runtimeCheck
    readonly property string dir: Runtime.candidate(Quickshell.env("XDG_RUNTIME_DIR"))
    command: Runtime.checkCommand(dir)
    running: dir !== ""
    stdout: StdioCollector {
      onStreamFinished: {
        var folder = Runtime.decide(runtimeCheck.dir, text)
        if (folder) {
          imageSweep.dir = folder + "/images/"
          imageSweep.running = true
        }
        root.runtimeChecked = true
        if (root.heldConfig !== null) root.applyConfig(root.heldConfig)
      }
    }
  }

  // Server images left in the runtime folder by windows that crashed or
  // were killed go at start (Images.sweep).
  Process {
    id: imageSweep
    property string dir: ""
    command: Images.sweepCommand(dir)
    stdout: StdioCollector {
      onStreamFinished: {
        var paths = Images.sweep(text, imageSweep.dir, Quickshell.processId)
        if (paths.length) Quickshell.execDetached(["rm", "-f", "--"].concat(paths))
      }
    }
  }

  Timer {
    interval: 30000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: if (!codeCheck.running) codeCheck.running = true
  }

  FileView {
    id: configFile
    path: root.configPath
    watchChanges: true
    printErrors: false
    onLoaded: root.applyConfig(text())
    onLoadFailed: root.applyConfig("")
    // An editor's save can truncate before it writes; reading at once would
    // see an empty file, drop the config and reset every view.
    onFileChanged: configReload.restart()
  }

  FileView {
    id: coreConfigFile
    path: root.coreBackend ? root.coreConfigPath : ""
    watchChanges: true
    printErrors: false
    onLoaded: root.applyCoreConfig(text())
    onLoadFailed: root.applyCoreConfig("")
    onFileChanged: coreConfigReload.restart()
  }

  Timer {
    id: coreConfigReload
    interval: 300
    onTriggered: coreConfigFile.reload()
  }

  function applyCoreConfig(text) {
    var next = Model.parseCoreConfig(text)
    if (next && coreConfig && JSON.stringify(next) === JSON.stringify(coreConfig)) return
    coreConfig = next
    if (coreConfig) {
      fetchLibrary(true)
      libraryView.reload()
      loadSettings()
      applyPending()
      return
    }
    coreRequestSeq++
    coreConnection = Model.reduce(coreConnection, { type: "config-missing" })
    // Without the switch Settings is Suwayomi's, and this file's empty path reads as missing.
    if (!coreBackend) return
    settingsSeq++
    settingsState = Settings.reduce(settingsState, { type: "config-missing" })
  }

  Timer {
    id: configReload
    interval: 300
    onTriggered: configFile.reload()
  }

  function applyConfig(text) {
    if (!runtimeChecked) {
      heldConfig = text
      return
    }
    var next = Model.parseConfig(text)
    if (next && config && JSON.stringify(next) === JSON.stringify(config)) return
    config = next
    if (!config) {
      requestSeq++
      connection = Model.reduce(connection, { type: "config-missing" })
      if (!coreBackend) settingsState = Settings.reduce(settingsState, { type: "config-missing" })
      return
    }
    fetchLibrary()
    if (!coreBackend) loadSettings()
    if (!coreBackend) libraryView.reload()
    applyPending()
  }

  // A launcher target that came before its server's config: each config
  // that loads tries again, and a target waits for its own server's.
  function applyPending() {
    var peekTarget = Model.chapterTarget(pendingPeek)
    if (pendingChapter) openChapter(pendingChapter)
    else if (peekTarget) {
      if (!targetReady(peekTarget)) return
      pendingPeek = ""
      peekOpen(peekTarget)
    }
    else if (pendingPeek) peek(pendingPeek === "next")
  }

  // A target's server has its config, or cannot get one: a core target in a
  // window without the switch, which openChapter turns down.
  function targetReady(target) {
    if (target.core) return !coreBackend || !!coreConfig
    return !!config
  }

  // Every path that opens a view or a chapter closes these first. A running
  // sync or restore goes on under its closed panel; a running migration
  // keeps Migrate open (MigrateView.close).
  function closeOverlays() {
    syncView.open = false
    restoreView.close()
    migrateView.close()
    if (reader.open) reader.close()
    mangaDetail.close()
    downloadsView.open = false
    readingCard.open = false
  }

  // The mark's update rows land here, through the launcher's open-chapter.
  // peek: a peek opens it, so Catch-up counts from 0 in the new reader;
  // every peek that opens a manga comes through here.
  // target.core: the row holds miharchy-core's ids (the mark under the
  // switch); without it, Suwayomi's. Both number from 1, so each opens on
  // its own server.
  function openChapter(target, peek) {
    pendingChapter = target
    if (!targetReady(target)) return
    pendingChapter = null
    closeOverlays()
    if (target.core && !coreBackend) {
      view = "library"
      return libraryView.fail("This chapter is on miharchy-core. Start the window with MIHARCHY_BACKEND=core to open it.")
    }
    view = "updates"
    if (target.core) openOn(target, peek, true)
    else if (updatesView.core) openOn(target, peek, false)
    else updatesView.openChapter(target.mangaId, target.chapterId, peek === true)
  }

  // The mark's new-chapter notification lands here, through the
  // launcher's open-updates.
  function openUpdates() {
    closeOverlays()
    view = "updates"
  }

  // The launcher's peek: the reader on the head of Up next, else the
  // Library with its search open. next (the launcher's peek-next): the
  // manga after the reader's in Up next (UpNext.after).
  function peek(next) {
    pendingPeek = next ? "next" : "1"
    if (!upNextConfig()) return
    pendingPeek = ""
    var library = function(reply) {
      root.closeOverlays()
      root.view = "library"
      if (reply && reply.state !== "ok") libraryView.report(reply)
      else libraryView.openSearch()
    }
    var core = coreBackend
    loadUpNext(function(reply) {
      if (reply.state !== "ok") return library(reply)
      var list = UpNext.list(reply.data, root.downloadedOnly, Date.now())
      if (!next) root.upNextOrder = list.map(function(e) { return e.mangaId })
      var target = next ? root.nextInOrder(list, reader.open && reader.onCore === core ? reader.reader.mangaId : null) : list[0]
      if (!target) library()
      else if (core) root.openOnCore(target, true)
      else root.openChapter(target, true)
    })
  }

  // Up next comes from the Library's server: core's with the switch on.
  function upNextConfig() {
    return coreBackend ? coreConfig : config
  }

  function loadUpNext(done) {
    var cfg = upNextConfig()
    UpNext.load(function(payload, d) { Session.send(cfg, payload, d) }, coreBackend, done)
  }

  // A chapter in the reader, as Updates opens one: core's Up next, or the
  // bar's rows on Suwayomi while Updates is core's.
  function openOnCore(target, peek) {
    openOn(target, peek, true)
  }

  function openOn(target, peek, core) {
    var cfg = core ? coreConfig : config
    var seq = ++coreOpenSeq
    var d = Browse.detail(target.mangaId, false, core)
    Session.send(cfg, Browse.detailPayload(d), function(reply) {
      if (seq !== root.coreOpenSeq) return
      d = Browse.reduceDetail(d, { type: "reply", reply: reply, config: cfg })
      root.closeOverlays()
      if (!d.manga) {
        root.view = "library"
        return libraryView.fail(Browse.notice(d, core ? root.coreConfigPath : root.configPath).title)
      }
      reader.start(d.manga, d.chapters, target.chapterId, root.settingsState.values.defaultReadingMode, peek === true, core)
    })
  }

  // The launcher's peek-open (the popup's Up next rows): that chapter as a
  // peek opens it, and the next key starts a new run from it.
  function peekOpen(target) {
    root.upNextOrder = []
    root.openChapter(target, true)
  }

  // The next key's pick from list: the manga after current in the run's
  // order, which starts over when current is not in it.
  function nextInOrder(list, current) {
    if (current === null || root.upNextOrder.indexOf(current) === -1)
      root.upNextOrder = list.map(function(e) { return e.mangaId })
    return UpNext.after(list, root.upNextOrder, current)
  }

  // A Catch-up stop names the manga the next key would open; n then runs
  // the next key (peek(true)). Itself again, or none, is nothing to offer.
  function lookUpNext(mangaId) {
    var core = coreBackend
    if (!upNextConfig()) return
    loadUpNext(function(reply) {
      if (!reader.open || reader.onCore !== core || reader.reader.mangaId !== mangaId) return
      var next = reply.state === "ok" ? root.nextInOrder(UpNext.list(reply.data, root.downloadedOnly, Date.now()), mangaId) : null
      if (next && next.mangaId === mangaId) next = null
      var manga = next ? ((core ? root.coreConnection : root.connection).manga || []).filter(function(m) { return m.id === next.mangaId })[0] : null
      reader.upNext = next ? { target: next, title: manga ? manga.title : "Manga " + next.mangaId } : null
    })
  }

  IpcHandler {
    target: "miharchy"

    function peek(): void {
      root.peek(false)
    }

    function peekNext(): void {
      root.peek(true)
    }

    function peekOpen(mangaId: int, chapterId: int): void {
      root.peekOpen({ mangaId: mangaId, chapterId: chapterId })
    }

    function openChapter(mangaId: int, chapterId: int): void {
      root.openChapter({ mangaId: mangaId, chapterId: chapterId })
    }

    // The launcher's open-chapter and peek-open with a trailing server name.
    function openChapterOn(mangaId: int, chapterId: int, backend: string): void {
      root.openChapter(Model.chapterTarget(mangaId + " " + chapterId + (backend === "core" ? " core" : "")))
    }

    function peekOpenOn(mangaId: int, chapterId: int, backend: string): void {
      root.peekOpen(Model.chapterTarget(mangaId + " " + chapterId + (backend === "core" ? " core" : "")))
    }

    function openUpdates(): void {
      root.openUpdates()
    }
  }

  // Loads and saves alike: every reply carries the values it touched.
  // Settings' server: miharchy-core's under the switch (#385), Suwayomi's otherwise.
  function settingsConfig() {
    return coreBackend ? coreConfig : config
  }

  // The load: one request on Suwayomi, two on core, each after the last
  // succeeded, so a later success never hides an earlier failure.
  function loadSettings() {
    var cfg = settingsConfig()
    if (!cfg) {
      settingsState = Settings.reduce(settingsState, { type: "config-missing" })
      return
    }
    var list = Settings.loadPayloads(coreBackend)
    var seq = ++settingsSeq
    settingsState = Settings.reduce(settingsState, { type: "request" })
    var next = function(i) {
      Session.send(cfg, list[i], function(reply) {
        if (seq !== root.settingsSeq) return
        root.settingsState = Settings.reduce(root.settingsState, { type: "response", reply: reply })
        if (reply.state === "ok" && i + 1 < list.length) next(i + 1)
      })
    }
    next(0)
  }

  function saveSetting(row, value) {
    var cfg = settingsConfig()
    if (!cfg) return
    settingsRefusal = { key: "", message: "" }
    settingsState = Settings.reduce(settingsState, { type: "request" })
    Session.send(cfg, Settings.savePayload(row, value, coreBackend), function(reply) {
      // Core refuses a value its rules do not take: the row says why, and the view stays.
      if (Settings.refused(reply)) {
        root.settingsRefusal = { key: row.key, message: reply.message }
        reply = { state: "ok", message: "", data: {}, kind: "" }
      }
      root.settingsState = Settings.reduce(root.settingsState, { type: "response", reply: reply })
    })
  }

  // A folder row saves once the folder exists, checked as Setup checks it.
  Process {
    id: folderCheck
    property var row: null
    property string folder: ""

    function check(r, f) {
      folderCheck.row = r
      folderCheck.folder = f
      folderCheck.command = Setup.runCommand("syncFolder", { folder: f })
      folderCheck.running = true
    }

    stdout: StdioCollector {
      onStreamFinished: {
        var job = Setup.parseJob(text, Setup.LIMITS.syncFolder[0])
        if (job.code !== 0) {
          root.settingsError = job.output
          return
        }
        root.endEdit()
        root.saveSetting(folderCheck.row, folderCheck.folder)
      }
    }
  }

  function endEdit() {
    settingsEditing = false
    settingsError = ""
    keyRoot.forceActiveFocus()
  }

  function send(payload, done) {
    return Session.send(config, payload, done)
  }

  // The one path that marks chapters, from any view. action: "read",
  // "unread" or "bookmark" (a toggle). The trackers hear of a mark read, and
  // every view showing read state or bookmarks reloads.
  // core: the chapters are miharchy-core's (the detail's on core): core's
  // trackers hear of it, and no Suwayomi view refreshes.
  function markChapters(chapters, action, mangaIds, core) {
    if (core === true) return markOnCore(chapters, action, mangaIds)
    var payload = action === "bookmark" ? Chapters.bookmarkPayload(chapters) : Chapters.markPayload(chapters, action === "read")
    if (!payload || !config) return
    // Mihon's delete after marked read takes the chapters this mark reads.
    var marked = chapters.filter(function(c) { return !c.read }).map(function(c) { return c.id })
    send(payload, function(reply) {
      // The push waits for the mark: the server reads the chapters it marked.
      var read = reply.state === "ok" && action === "read"
      var after = read ? Chapters.afterMarkRead(root.settingsState.values.trackOnMarkRead) : null
      var check = after === "check" ? Chapters.trackCheckPayload(mangaIds) : null
      if (after === "push") root.pushTrackers(mangaIds)
      if (check) root.askTrackers(mangaIds, false)
      if (read && root.settingsState.values.deleteAfterMarkRead) root.deleteRead(marked, refresh)
      else refresh()
      function refresh() {
        // Updates marks chapters of many manga; the detail hears only of its own.
        if (mangaDetail.open && mangaIds.indexOf(mangaDetail.detail.mangaId) !== -1) mangaDetail.markReply(reply)
        updatesView.load()
        root.fetchLibrary()
      }
    })
  }

  function markOnCore(chapters, action, mangaIds) {
    var payload = action === "bookmark" ? Chapters.bookmarkPayload(chapters, true) : Chapters.markPayload(chapters, action === "read", true)
    if (!payload || !coreConfig) return
    var marked = chapters.filter(function(c) { return !c.read }).map(function(c) { return c.id })
    Session.send(coreConfig, payload, function(reply) {
      var read = reply.state === "ok" && action === "read"
      var after = read ? Chapters.afterMarkRead(root.settingsState.values.trackOnMarkRead) : null
      if (after === "push") root.pushTrackers(mangaIds, true)
      if (after === "check") root.askTrackers(mangaIds, true)
      if (read && root.settingsState.values.deleteAfterMarkRead) root.deleteRead(marked, refresh, true)
      else refresh()
      function refresh() {
        if (mangaDetail.open && mangaDetail.onCore && mangaIds.indexOf(mangaDetail.detail.mangaId) !== -1) mangaDetail.markReply(reply)
        root.fetchLibrary(true)
        if (updatesView.core) updatesView.load()
      }
    })
  }

  // core: the manga are miharchy-core's.
  function pushTrackers(mangaIds, core) {
    var track = Chapters.trackPayload(mangaIds, core === true)
    var cfg = core === true ? coreConfig : config
    if (track && cfg) Session.send(cfg, track, function() {})
  }

  // Mihon's question before a push: asked only when a logged-in tracker
  // sits below the chapter the push would send.
  function askTrackers(mangaIds, core) {
    var cfg = core === true ? coreConfig : config
    if (!cfg) return
    Chapters.trackCheckLoad(function(payload, d) { Session.send(cfg, payload, d) }, core === true, mangaIds, function(r) {
      var ask = r.state === "ok" ? Chapters.trackAsk(r.data) : null
      root.trackAsk = ask ? Object.assign(ask, { core: core === true }) : null
    })
  }

  // Deletes the downloads of the read chapters that Downloads.autoDeletePayload
  // lets go, then calls done, whatever happened.
  // core: the chapters are miharchy-core's.
  function deleteRead(chapterIds, done, core) {
    var cfg = core === true ? coreConfig : config
    var on = function(payload, d) { Session.send(cfg, payload, d) }
    Downloads.autoDeleteLoad(on, core === true, chapterIds, function(reply) {
      var payload = reply.state === "ok" ? Downloads.autoDeletePayload(reply.data, root.settingsState.values.deleteBookmarked, [], core === true) : null
      if (payload) on(payload, done)
      else done()
    })
  }

  // Mihon's default category on core. Under the switch the setting is
  // core's (#385), so it holds a core category id.
  function addedOnCore(mangaId) {
    var cats = coreConnection.categories
    var to = coreBackend ? Library.defaultCategory(settingsState.values.defaultCategory, cats) : (cats.length ? -1 : 0)
    if (to === -1 && mangaDetail.open && mangaDetail.onCore && mangaDetail.detail.mangaId === mangaId) mangaDetail.run("manga.categories")
    if (to === -1 || !cats.length) return fetchLibrary(true)
    Session.send(coreConfig, Library.moveToPayload(mangaId, to, cats, true), function(reply) {
      libraryView.report(reply)
      mangaDetail.reload()
      root.fetchLibrary(true)
    })
  }

  // Mihon's default category: a manga the detail adds goes to the chosen
  // category, or the detail's categories picker opens to ask.
  function addedToLibrary(mangaId) {
    // Under the switch the setting holds a core id, which may name another
    // category on Suwayomi: ask instead.
    var to = coreBackend ? (connection.categories.length ? -1 : 0) : Library.defaultCategory(settingsState.values.defaultCategory, connection.categories)
    if (to === -1 && mangaDetail.open && mangaDetail.detail.mangaId === mangaId) mangaDetail.run("manga.categories")
    if (to === -1 || !connection.categories.length) return fetchLibrary()
    send(Library.moveToPayload(mangaId, to, connection.categories), function(reply) {
      libraryView.report(reply)
      mangaDetail.reload()
      root.fetchLibrary()
    })
  }

  // core: refresh miharchy-core's library instead, for an event that came from it.
  function fetchLibrary(core) {
    if (core === true) {
      var ccfg = coreConfig
      if (!ccfg) return
      var cseq = ++coreRequestSeq
      coreConnection = Model.reduce(coreConnection, { type: "request" })
      Session.send(ccfg, Model.libraryPayload(true), function(reply) {
        if (cseq === root.coreRequestSeq) root.coreConnection = Model.reduce(root.coreConnection, { type: "response", reply: reply, config: ccfg })
      })
      return
    }
    var cfg = config
    var seq = ++requestSeq
    connection = Model.reduce(connection, { type: "request" })
    Session.send(cfg, { query: Model.LIBRARY_QUERY }, function(reply) {
      if (seq === root.requestSeq) root.connection = Model.reduce(root.connection, { type: "response", reply: reply, config: cfg })
    })
  }

  // The one key path: the window and the palette field both land here.
  // Returns whether a command took the key.
  function handleKey(event) {
    var id = Commands.dispatch({ palette: paletteOpen, view: overlay.scope, editing: overlay.editing, confirming: setupView.confirming }, Commands.keyEvent(event.key, event.text, event.modifiers))
    // Every key, even one no command takes, clears the Library's note; all
    // but x and X also disarm and clear its error (Library.reduce "key").
    libraryView.keyed(id)
    if (id !== "updates.deleteDownload") updatesView.armed = false
    if (id !== "downloads.clear") downloadsView.armed = false
    if (id !== null) run(id)
    return id !== null
  }

  // A sync or a restore changed the library, and the source names in meta.
  function reloadAfterImport() {
    // A sync or a restore on core changed core's library.
    if (coreBackend) {
      fetchLibrary(true)
      libraryView.reload()
      updatesView.load()
    }
    loadSettings()
    if (!config) return
    fetchLibrary()
    if (!coreBackend) updatesView.load()
  }

  function closePalette() {
    paletteOpen = false
    keyRoot.forceActiveFocus()
  }

  function run(id) {
    if (id.indexOf("view.") === 0) {
      closeOverlays()
      view = id.slice(5)
      return
    }
    if (id.indexOf("extensions.") === 0 || id.indexOf("extension.") === 0) {
      extensionsView.run(id)
      return
    }
    if (/^(browse|sources|source|global|panel)\./.test(id)) {
      browseView.run(id)
      return
    }
    if ((id.indexOf("library.") === 0 || id === "categories.back") && libraryView.run(id)) return
    if (id.indexOf("categories.") === 0) {
      categoriesView.run(id)
      return
    }
    if (id === "trackAsk.yes" || id === "trackAsk.no") {
      if (id === "trackAsk.yes") pushTrackers(trackAsk.mangaIds, trackAsk.core)
      trackAsk = null
      return
    }
    // A detail on the other server than Migrate's says so.
    if (mangaDetail.open && mangaDetail.migrateGate && mangaDetail.migrateIds[id]) {
      mangaDetail.run(id)
      return
    }
    if (id === "manga.track") {
      trackPanel.show(mangaDetail.manga, mangaDetail.onCore)
      return
    }
    if (id.indexOf("track.") === 0) {
      trackPanel.run(id)
      return
    }
    if (id.indexOf("login.") === 0) {
      settingsView.run(id)
      return
    }
    if (id === "manga.searchTitle") {
      var title = mangaDetail.manga ? mangaDetail.manga.title : ""
      if (!title) return
      run("view.browse")
      browseView.searchEverywhere(title)
      return
    }
    if (id === "manga.migrate") {
      migrateView.startSingle(mangaDetail.manga)
      return
    }
    if (id === "manga.duplicateMigrate") {
      var dupe = mangaDetail.dupes[mangaDetail.dupesCursor]
      mangaDetail.dupes = []
      migrateView.startWith(dupe, mangaDetail.manga)
      return
    }
    if (id === "nextChapters.upNext") {
      nextChapters.openUpNext()
      return
    }
    if (id.indexOf("nextChapters.") === 0) {
      nextChapters.run(id)
      return
    }
    if (id === "migrate.batch") {
      migrateView.startBatch()
      return
    }
    if (id === "check.migrate") {
      migrateView.startList(checkView.migrateList())
      return
    }
    if (id.indexOf("migrate.") === 0) {
      migrateView.run(id)
      return
    }
    if (id.indexOf("manga.") === 0) {
      mangaDetail.run(id)
      return
    }
    if (id.indexOf("downloads.") === 0) {
      downloadsView.run(id)
      return
    }
    if (id.indexOf("reader.") === 0) {
      reader.run(id)
      return
    }
    if (id.indexOf("readingCard.") === 0) {
      readingCard.run(id)
      return
    }
    if (id === "history.clearSearch" && !historyView.query) {
      run("window.quit")
      return
    }
    if (id.indexOf("history.") === 0) {
      historyView.run(id)
      return
    }
    if (id.indexOf("setup.") === 0) {
      setupView.run(id)
      return
    }
    if (id.indexOf("check.") === 0) {
      checkView.run(id)
      return
    }
    if (id === "updates.clearSelection" && !updatesView.selected.length) {
      run("window.quit")
      return
    }
    if (id.indexOf("updates.") === 0) {
      updatesView.run(id)
      return
    }
    if (id === "sync.undo") {
      // Core keeps the file in its own data folder and names it.
      if (coreBackend) restoreView.openPreSync()
      else restoreView.openFile(Quickshell.env("HOME") + "/" + Sync.PRE_SYNC)
      return
    }
    if (id.indexOf("sync.") === 0) {
      syncView.run(id)
      return
    }
    if (id.indexOf("restore.") === 0) {
      restoreView.run(id)
      return
    }
    switch (id) {
      // Its row in Settings shows the outcome.
      case "backup.create":
        view = "settings"
        settingsCursor = Settings.ROWS.map(function(r) { return r.command }).indexOf(id)
        settingsView.createBackup()
        break
      case "mode.incognito":
      case "mode.downloadedOnly":
        var mode = Settings.toggle(id.slice(5), settingsState.values)
        saveSetting(mode.row, mode.value)
        break
      case "palette.open":
        paletteOpen = true
        palette.open()
        break
      case "palette.close":
        closePalette()
        break
      case "palette.up":
      case "palette.down":
        palette.cursor = Commands.moveCursor(palette.cursor, id === "palette.up" ? -1 : 1, palette.rows.length)
        break
      case "palette.run":
        var row = palette.currentRow()
        closePalette()
        if (row) run(row.id)
        break
      case "settings.up":
      case "settings.down":
        settingsCursor = Commands.moveCursor(settingsCursor, id === "settings.up" ? -1 : 1, Settings.ROWS.length + 1 + settingsView.trackers.list.length)
        break
      case "settings.activate":
        // After the rows: the cache clear, then the trackers.
        if (settingsCursor === Settings.ROWS.length) {
          settingsView.clearCache()
          break
        }
        if (settingsCursor > Settings.ROWS.length) {
          settingsView.startLogin(settingsCursor - Settings.ROWS.length - 1)
          break
        }
        var srow = Settings.ROWS[settingsCursor]
        var act = Settings.activate(srow, settingsState.values[srow.key], (coreBackend ? coreConnection : connection).categories)
        if ("run" in act) {
          run(act.run)
        } else if ("save" in act) {
          saveSetting(srow, act.save)
        } else {
          settingsView.editStart = act.edit
          settingsEditing = true
        }
        break
      case "settings.commit":
        var erow = Settings.ROWS[settingsCursor]
        var done = Settings.commit(erow, settingsView.editValue, Quickshell.env("HOME"), settingsState.values)
        if ("error" in done) {
          settingsError = done.error
        } else if ("folder" in done) {
          folderCheck.check(erow, done.folder)
        } else {
          endEdit()
          saveSetting(erow, done.save)
        }
        break
      case "settings.cancel":
        endEdit()
        break
      case "library.reload":
        // The Library's prefs live on the server it shows.
        if (coreBackend) {
          fetchLibrary(true)
          libraryView.reload()
          updatesView.load()
        }
        loadSettings()
        settingsView.reload()
        if (config) {
          fetchLibrary()
          if (!coreBackend) libraryView.reload()
          if (!coreBackend) updatesView.load()
        }
        // The check follows the switch (#394).
        if (view === "check") checkView.load()
        configFile.reload()
        break
      case "window.fullscreen":
        // xdg-shell's own fullscreen request, so the compositor acts on
        // this window and no other.
        window.fullscreen = !window.fullscreen
        break
      case "window.quit":
        reader.quit()
        break
      case "window.restart":
        // The new window starts once this process is gone, after the quit
        // path's saves.
        if (restarting) break
        restarting = true
        Quickshell.execDetached(Restart.relaunchCommand(Quickshell.processId, Quickshell.shellPath("miharchy")))
        reader.quit()
        break
    }
  }

  // Mihon's keep screen on: the compositor's idle inhibit holds hypridle
  // off while the reader shows and the window is visible.
  IdleInhibitor {
    id: idleInhibitor
    window: window
    enabled: reader.open && root.settingsState.values.keepScreenOn
  }

  FloatingWindow {
    id: window
    title: "Miharchy"
    color: theme.background
    implicitWidth: 1280
    implicitHeight: 800
    minimumSize: Qt.size(560, 360)

    onVisibleChanged: if (!visible) reader.quit()

    FocusScope {
      id: keyRoot
      anchors.fill: parent
      focus: true

      Keys.onPressed: function(event) {
        root.handleKey(event)
        event.accepted = true
      }

      Row {
        id: tabs
        x: theme.fontSize * 2
        height: theme.fontSize * 3.5
        spacing: theme.fontSize * 2

        Repeater {
          model: Model.VIEWS

          Item {
            id: tab
            required property var modelData
            readonly property bool current: modelData.id === root.view
            width: label.implicitWidth
            height: tabs.height

            Text {
              id: label
              anchors.verticalCenter: parent.verticalCenter
              // Styled for the key's color; Model.VIEWS is constant text.
              textFormat: Text.StyledText
              text: "<font color='" + theme.muted + "'>" + tab.modelData.key + "</font> " + tab.modelData.title
              color: tab.current ? theme.foreground : theme.muted
              font.family: theme.fontFamily
              font.pixelSize: theme.fontSize
            }

            Rectangle {
              anchors.bottom: parent.bottom
              anchors.bottomMargin: theme.fontSize * 0.6
              width: parent.width
              height: 2
              color: theme.accent
              visible: tab.current
            }

            MouseArea {
              anchors.fill: parent
              cursorShape: Qt.PointingHandCursor
              onClicked: root.handleKey({ key: tab.modelData.key.charCodeAt(0), text: tab.modelData.key, modifiers: 0 })
            }
          }
        }
      }

      Item {
        anchors.top: tabs.bottom
        anchors.bottom: status.top
        anchors.left: parent.left
        anchors.right: parent.right

        LibraryView {
          id: libraryView
          anchors.fill: parent
          visible: root.view === "library" && screen === "grid"
          theme: theme
          // With the switch on, the Library is miharchy-core's, as the
          // Downloads view is.
          config: root.coreBackend ? root.coreConfig : root.config
          configPath: root.coreBackend ? root.coreConfigPath : root.configPath
          backend: root.coreBackend ? "core" : ""
          connection: root.coreBackend ? root.coreConnection : root.connection
          downloadedOnly: root.downloadedOnly
          categoriesHint: categoriesView.hint
          queue: downloadsView.queue.items
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onEditEnded: keyRoot.forceActiveFocus()
          onMark: function(chapters, action, mangaIds) { root.markChapters(chapters, action, mangaIds, libraryView.core) }
          onDownloads: function(reply) { downloadsView.apply(reply) }
          onEdited: root.fetchLibrary(libraryView.core)
          onRead: function(manga, chapters, chapterId) { reader.start(manga, chapters, chapterId, root.settingsState.values.defaultReadingMode, false, libraryView.core) }
          onOpenManga: function(mangaId) { mangaDetail.openManga(mangaId, false, libraryView.core) }
          onDownloadMenu: function(set) { nextChapters.openFor(set) }
          onCheck: function(categories, done) { done(updatesView.check(categories)) }
          onQuit: root.run("window.quit")
        }

        CategoriesView {
          id: categoriesView
          anchors.fill: parent
          visible: root.view === "library" && libraryView.screen === "categories"
          theme: theme
          config: root.coreBackend ? root.coreConfig : root.config
          backend: root.coreBackend ? "core" : ""
          categories: (root.coreBackend ? root.coreConnection : root.connection).categories
          manga: (root.coreBackend ? root.coreConnection : root.connection).manga
          loading: (root.coreBackend ? root.coreConnection : root.connection).state === "loading"
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onEditEnded: keyRoot.forceActiveFocus()
          onEdited: if (config) root.fetchLibrary(core)
        }

        SettingsView {
          id: settingsView
          anchors.fill: parent
          visible: root.view === "settings"
          theme: theme
          config: root.settingsConfig()
          configPath: root.coreBackend ? root.coreConfigPath : root.configPath
          backend: root.coreBackend ? "core" : ""
          unapplied: root.settingsState.unapplied || []
          refusal: root.settingsRefusal
          values: root.settingsState.values
          categories: (root.coreBackend ? root.coreConnection : root.connection).categories
          cursor: root.settingsCursor
          editing: root.settingsEditing
          problem: Model.problem(root.settingsState, root.coreBackend ? root.coreConfigPath : root.configPath, root.coreBackend ? "core" : "")
          editError: root.settingsError
          health: syncView.health
          onHealthWanted: syncView.refreshHealth()
          checkCount: checkView.countText
          // The library check stays on Suwayomi until #394, so Settings does not start it on core.
          onCheckWanted: checkView.load()
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onPicked: function(index) { root.settingsCursor = index }
          onEditEnded: keyRoot.forceActiveFocus()
        }

        ExtensionsView {
          id: extensionsView
          anchors.fill: parent
          visible: root.view === "browse" && browseView.screen === "extensions"
          theme: theme
          config: root.coreBackend ? root.coreConfig : root.config
          configPath: root.coreBackend ? root.coreConfigPath : root.configPath
          backend: root.coreBackend ? "core" : ""
          active: visible
          showNsfw: root.settingsState.values.showNsfw
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onEditEnded: keyRoot.forceActiveFocus()
          onOpenSettings: function(source) { browseView.openPanel("preferences", source) }
        }

        // Over the extensions, it shows only its settings panel there.
        BrowseView {
          id: browseView
          anchors.fill: parent
          visible: root.view === "browse" && (screen !== "extensions" || panel !== null)
          theme: theme
          config: root.coreBackend ? root.coreConfig : root.config
          configPath: root.coreBackend ? root.coreConfigPath : root.configPath
          backend: root.coreBackend ? "core" : ""
          active: root.view === "browse"
          showNsfw: root.settingsState.values.showNsfw
          localFolder: Storage.localFolder({ HOME: Quickshell.env("HOME"), MIHARCHY_SERVER_ROOT: Quickshell.env("MIHARCHY_SERVER_ROOT") }, root.settingsState.values.localSourcePath)
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onEditEnded: keyRoot.forceActiveFocus()
          onOpenManga: function(mangaId) { mangaDetail.openManga(mangaId, true, root.coreBackend) }
        }

        HistoryView {
          id: historyView
          anchors.fill: parent
          visible: root.view === "history"
          theme: theme
          config: root.coreBackend ? root.coreConfig : root.config
          configPath: root.coreBackend ? root.coreConfigPath : root.configPath
          backend: root.coreBackend ? "core" : ""
          // Off while the reader shows, so closing it reloads what it read.
          active: root.view === "history" && !reader.open
          onResume: function(manga, chapters, chapterId) { reader.start(manga, chapters, chapterId, root.settingsState.values.defaultReadingMode, false, historyView.core) }
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onEditEnded: keyRoot.forceActiveFocus()
        }

        UpdatesView {
          id: updatesView
          anchors.fill: parent
          visible: root.view === "updates"
          downloadedOnly: root.downloadedOnly
          theme: theme
          config: root.coreBackend ? root.coreConfig : root.config
          configPath: root.coreBackend ? root.coreConfigPath : root.configPath
          backend: root.coreBackend ? "core" : ""
          active: visible
          queue: downloadsView.queue.items
          categories: (root.coreBackend ? root.coreConnection : root.connection).categories
          onRead: function(manga, chapters, chapterId, peek) { reader.start(manga, chapters, chapterId, root.settingsState.values.defaultReadingMode, peek, updatesView.core) }
          onMark: function(chapters, action, mangaIds) { root.markChapters(chapters, action, mangaIds, updatesView.core) }
          onDownloads: function(reply) { downloadsView.apply(reply) }
          onKey: function(event) { event.accepted = root.handleKey(event) }
        }

        SetupView {
          id: setupView
          anchors.fill: parent
          visible: root.view === "setup"
          theme: theme
          config: root.coreBackend ? root.coreConfig : root.config
          configPath: root.configPath
          backend: root.coreBackend ? "core" : ""
          coreConfigPath: root.coreConfigPath
          home: Quickshell.env("HOME")
          onKey: function(event) { event.accepted = root.handleKey(event) }
          offers: Setup.offersOnStart({ MIHARCHY_PEEK: Quickshell.env("MIHARCHY_PEEK"), MIHARCHY_OPEN_CHAPTER: Quickshell.env("MIHARCHY_OPEN_CHAPTER"), MIHARCHY_OPEN_VIEW: Quickshell.env("MIHARCHY_OPEN_VIEW") })
          onNeeded: if (root.view === "library") root.view = "setup"
          onWrote: {
            configFile.reload()
            if (root.coreBackend) coreConfigFile.reload()
          }
          onMoved: {
            root.fetchLibrary(true)
            libraryView.reload()
            root.loadSettings()
          }
          onEditEnded: keyRoot.forceActiveFocus()
        }

        LibraryCheckView {
          id: checkView
          anchors.fill: parent
          visible: root.view === "check"
          active: visible
          theme: theme
          config: root.coreBackend ? root.coreConfig : root.config
          configPath: root.coreBackend ? root.coreConfigPath : root.configPath
          core: root.coreBackend
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onMergeChosen: function(job) { migrateView.startWith(job.old, job.kept) }
        }

        Text {
          textFormat: Text.PlainText
          anchors.centerIn: parent
          visible: Model.viewIndex(root.view) !== -1 && ["library", "updates", "history", "settings", "browse"].indexOf(root.view) === -1
          text: visible ? Model.VIEWS[Model.viewIndex(root.view)].title + " comes in a later version" : ""
          color: theme.muted
          font.family: theme.fontFamily
          font.pixelSize: theme.fontSize
        }

        MangaDetail {
          id: mangaDetail
          anchors.fill: parent
          theme: theme
          // On core (onCore) nothing of Suwayomi's reaches it: both servers
          // number their manga, chapters and categories from 1.
          config: onCore ? root.coreConfig : root.config
          downloadedOnly: root.downloadedOnly
          configPath: onCore ? root.coreConfigPath : root.configPath
          categories: onCore ? root.coreConnection.categories : root.connection.categories
          onCategorized: if (config) root.fetchLibrary(onCore)
          onLibraryChanged: function(mangaId, inLibrary, core) {
            // Browse's rows are core's with the switch on, Suwayomi's without.
            if (core === root.coreBackend) browseView.markInLibrary(mangaId, inLibrary)
            if (core) return inLibrary ? root.addedOnCore(mangaId) : root.fetchLibrary(true)
            if (inLibrary) root.addedToLibrary(mangaId)
            else if (root.config) root.fetchLibrary()
          }
          // The Downloads view's server only: a chapter id means nothing to the other.
          readonly property bool downloadsHere: onCore === root.coreBackend
          queue: downloadsHere ? downloadsView.queue.items : []
          migrateGate: onCore === root.coreBackend ? "" : root.migrateElsewhere
          downloadsGate: downloadsHere ? "" : root.downloadsElsewhere
          onDownloads: function(reply) { if (downloadsHere) downloadsView.apply(reply) }
          libraryManga: onCore ? root.coreConnection.manga : root.connection.manga
          onRead: function(chapters, chapterId) { reader.start(mangaDetail.manga, chapters, chapterId, root.settingsState.values.defaultReadingMode, false, mangaDetail.onCore) }
          onMark: function(chapters, action, mangaId, core) { root.markChapters(chapters, action, [mangaId], core) }
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onEditEnded: keyRoot.forceActiveFocus()
          skipFiltered: root.settingsState.values.skipFiltered
        }

        // Under the tracking panel: a click outside it never reaches a chapter.
        MouseArea {
          anchors.fill: parent
          visible: trackPanel.open
        }

        TrackPanel {
          id: trackPanel
          anchors.top: parent.top
          anchors.right: parent.right
          anchors.margins: theme.fontSize * 2
          width: Math.min(parent.width - theme.fontSize * 4, theme.fontSize * 52)
          theme: theme
          config: root.config
          configPath: root.configPath
          coreConfig: root.coreConfig
          coreConfigPath: root.coreConfigPath
          active: mangaDetail.open
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onEditEnded: keyRoot.forceActiveFocus()
        }

        MigrateView {
          id: migrateView
          anchors.fill: parent
          theme: theme
          config: root.coreBackend ? root.coreConfig : root.config
          configPath: root.coreBackend ? root.coreConfigPath : root.configPath
          core: root.coreBackend
          showNsfw: root.settingsState.values.showNsfw
          categories: root.coreBackend ? root.coreConnection.categories : root.connection.categories
          pinned: Browse.pinned(browseView.prefs)
          onKey: function(event) { event.accepted = root.handleKey(event) }
          onEditEnded: keyRoot.forceActiveFocus()
          onLibraryChanged: {
            if (root.coreBackend) root.fetchLibrary(true)
            else if (root.config) root.fetchLibrary()
            if (checkView.active) checkView.load()
          }
          onMigrated: function(mangaId) { mangaDetail.openManga(mangaId, false, root.coreBackend) }
        }
      }

      Item {
        id: status
        anchors.bottom: parent.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.leftMargin: theme.fontSize * 2
        anchors.rightMargin: theme.fontSize * 2
        // A hint wider than the space beside the connection state wraps,
        // and the bar grows up to hold it.
        height: Math.max(theme.fontSize * 2.5, hintBar.height + theme.fontSize)

        Text {
          id: connectionText
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
          // The modes on follow, in the accent color, as Mihon's banners.
          // Styled for that color; the states and Settings.modes are constant text.
          textFormat: Text.StyledText
          text: [({ loading: "connecting", ok: "connected", "no-config": "no server config", down: "server down", unauthorized: "unauthorized", error: "server error" })[(root.coreBackend ? root.coreConnection : root.connection).state]].concat(Settings.modes(root.settingsState.values).map(function(m) { return "<font color='" + theme.accent + "'>" + m + "</font>" })).join("&nbsp;&nbsp;&nbsp;")
          readonly property string barState: (root.coreBackend ? root.coreConnection : root.connection).state
          color: barState === "ok" || barState === "loading" ? theme.muted : theme.urgent
          font.family: theme.fontFamily
          font.pixelSize: theme.fontSmall
        }

        HintBar {
          id: hintBar
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          text: root.overlay.hint
          maxWidth: parent.width - connectionText.width - theme.fontSize * 2 - (codeHint.visible ? codeHint.width + theme.fontSize * 2 : 0)
          theme: theme
          onKey: function(event) { root.handleKey(event) }
        }

        HintBar {
          id: codeHint
          anchors.left: connectionText.right
          anchors.leftMargin: theme.fontSize * 2
          anchors.verticalCenter: parent.verticalCenter
          visible: root.code.changed
          text: root.code.changed ? "new version   Q restart" : ""
          color: theme.accent
          theme: theme
          onKey: function(event) { root.handleKey(event) }
        }
      }

      ReaderView {
        id: reader
        anchors.fill: parent
        theme: theme
        config: onCore ? root.coreConfig : root.config
        configPath: onCore ? root.coreConfigPath : root.configPath
        downloadsOff: onCore !== root.coreBackend
        values: root.settingsState.values
        onKey: function(event) { event.accepted = root.handleKey(event) }
        onEditEnded: keyRoot.forceActiveFocus()
        onSetting: function(row, value) { root.saveSetting(row, value) }
        onClosed: function(chapterId) {
          // A chapter id means something only to the server it came from.
          if (mangaDetail.onCore === reader.onCore) mangaDetail.reread(chapterId)
          if (updatesView.core === reader.onCore) updatesView.load()
          if (reader.onCore) return root.fetchLibrary(true)
          if (root.config) root.fetchLibrary()
        }
        onDeleted: mangaDetail.reload()
        // ponytail: Up next reads Suwayomi's library until #379 moves it.
        // Up next is the Library's server's: a reader on the other one gets no offer.
        onCaughtUpOn: function(mangaId) { if (reader.onCore === root.coreBackend) root.lookUpNext(mangaId) }
        onNextManga: root.peek(true)
      }

      DownloadsView {
        id: downloadsView
        anchors.fill: parent
        theme: theme
        // With the switch on, the queue is miharchy-core's.
        config: root.coreBackend ? root.coreConfig : root.config
        configPath: root.coreBackend ? root.coreConfigPath : root.configPath
        backend: root.coreBackend ? "core" : ""
        flareOn: root.settingsState.values.flareSolverrEnabled === true
        lastRun: nextChapters.lastRun
        onLeftQueue: function(items) {
          mangaDetail.downloadsLeft(items)
          updatesView.load()
        }
        onKey: function(event) { root.handleKey(event) }
      }

      NextChaptersMenu {
        id: nextChapters
        anchors.fill: parent
        theme: theme
        // The Library and Up next it opens from follow the switch.
        config: root.coreBackend ? root.coreConfig : root.config
        backend: root.coreBackend ? "core" : ""
        queueItems: downloadsView.queue.items
        onDownloads: function(reply) { downloadsView.apply(reply) }
        onQueued: {
          downloadsView.cursor = -1
          downloadsView.run("downloads.open")
        }
        onKey: function(event) { event.accepted = root.handleKey(event) }
        onEditEnded: keyRoot.forceActiveFocus()
      }

      SyncView {
        id: syncView
        anchors.fill: parent
        theme: theme
        config: root.coreBackend ? root.coreConfig : null
        backend: root.coreBackend ? "core" : ""
        onSynced: root.reloadAfterImport()
        onKey: function(event) { root.handleKey(event) }
      }

      RestoreView {
        id: restoreView
        anchors.fill: parent
        theme: theme
        folder: root.settingsState.values.syncFolder
        config: root.coreBackend ? root.coreConfig : null
        backend: root.coreBackend ? "core" : ""
        onKey: function(event) { event.accepted = root.handleKey(event) }
        onEditEnded: keyRoot.forceActiveFocus()
        onRestored: root.reloadAfterImport()
      }

      ReadingCard {
        id: readingCard
        anchors.fill: parent
        theme: theme
        config: root.coreBackend ? root.coreConfig : root.config
        configPath: root.coreBackend ? root.coreConfigPath : root.configPath
        backend: root.coreBackend ? "core" : ""
        folder: root.settingsState.values.pageFolder || ""
        onKey: function(event) { root.handleKey(event) }
      }

      // Mihon's snackbar after a mark read, kept until answered.
      Rectangle {
        anchors.bottom: status.top
        anchors.horizontalCenter: parent.horizontalCenter
        width: askText.implicitWidth + theme.fontSize * 3
        height: askText.implicitHeight + theme.fontSize * 1.5
        visible: root.trackAsk !== null
        color: theme.panel
        border.width: 1
        border.color: theme.panelBorder

        Text {
          id: askText
          textFormat: Text.PlainText
          anchors.centerIn: parent
          text: root.trackAsk ? Chapters.trackAskText(root.trackAsk) : ""
          color: theme.foreground
          font.family: theme.fontFamily
          font.pixelSize: theme.fontSize
        }
      }

      CommandPalette {
        id: palette
        anchors.fill: parent
        visible: root.paletteOpen
        theme: theme
        onKey: function(event) { event.accepted = root.handleKey(event) }
      }
    }
  }
}
