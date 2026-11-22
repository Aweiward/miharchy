import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Mark.js" as Mark
import "../window/Model.js" as Model
import "../window/Session.js" as Session
import "../window/Sync.js" as Sync

// The mark in the Omarchy bar and its popup of recent updates. It stays thin
// (ADR 0003): it polls the server and starts the window, which runs as its
// own process through window/miharchy. Mark.js decides what shows; Sync
// runs the same sync the window runs: miharchy-core's sync.run.
Panel {
  id: root
  moduleName: "miharchy"

  readonly property string configPath: Quickshell.env("MIHARCHY_CORE_CONFIG") || Quickshell.env("HOME") + "/.config/miharchy/core.json"
  readonly property string phoneBaseline: Mark.phoneBaseline({ HOME: Quickshell.env("HOME"), MIHARCHY_CORE_DATA: Quickshell.env("MIHARCHY_CORE_DATA") })
  readonly property string launcher: decodeURIComponent(Qt.resolvedUrl("../window/miharchy").toString().replace(/^file:\/\//, ""))
  property var config: null
  property var mark: Mark.initial()
  readonly property string notifyIcon: decodeURIComponent(Qt.resolvedUrl("../icons/miharchy.svg").toString().replace(/^file:\/\//, ""))
  property var sync: Sync.initial()
  property int cursor: 0
  // Only the latest poll may land.
  property int pollSeq: 0
  // The phone backup ("<mtime> <path>") the mark last synced on its own:
  // each is tried once, so a failed or held sync does not rerun every poll.
  property string lastTried: ""
  // The running sync started on a phone backup, so it notifies.
  property bool autoRun: false
  // Sync health for the popup line, read again when the newest phone backup
  // (lastPhone, "<mtime> <path>") changes and after each sync. now moves on
  // each poll, so a phone that went quiet shows without a new file.
  property var health: ({ state: "idle" })
  property string lastPhone: ""
  property double now: Date.now()

  readonly property var rows: mark.rows
  readonly property var notice: Mark.notice(mark, configPath)
  readonly property int more: mark.count - rows.length
  // Up next's reply, null while it loads; asked for only when the popup
  // opens, never in the poll.
  property var upNextReply: null
  property int upNextSeq: 0
  readonly property var entries: Mark.entries(Mark.upNext(upNextReply, now), rows)
  property var lastEntries: []
  onEntriesChanged: {
    cursor = Mark.follow(lastEntries, entries, cursor)
    lastEntries = entries
  }

  implicitWidth: icon.implicitWidth + (count.visible ? count.implicitWidth : 0)
  implicitHeight: icon.implicitHeight

  onOpenedChanged: if (opened) {
    cursor = 0
    poll()
    loadUpNext()
  }

  function loadUpNext() {
    var seq = ++upNextSeq
    upNextReply = null
    var cfg = config
    if (!cfg) return
    Mark.loadUpNext(function(payload, done) { Session.send(cfg, payload, done) }, function(reply) {
      if (seq === root.upNextSeq) root.upNextReply = reply
    })
  }

  FileView {
    id: configFile
    path: root.configPath
    watchChanges: true
    printErrors: false
    onLoaded: root.applyConfig(text())
    onLoadFailed: root.applyConfig("")
    // An editor's save can truncate before it writes.
    onFileChanged: configReload.restart()
  }

  Timer {
    id: configReload
    interval: 300
    onTriggered: configFile.reload()
  }

  function applyConfig(text) {
    config = Model.parseCoreConfig(text)
    if (config) return poll()
    pollSeq++
    mark = Mark.reduce(mark, { type: "config-missing" })
  }

  function poll() {
    if (!config) return
    var seq = ++pollSeq
    var cfg = config
    Mark.load(function(payload, done) { Session.send(cfg, payload, done) }, Date.now(), function(reply) {
      if (seq !== root.pollSeq) return
      root.mark = Mark.reduce(root.mark, { type: "reply", reply: reply, config: cfg, now: Date.now() })
      var n = Mark.notification(root.mark)
      if (n) Quickshell.execDetached(Mark.notifyCommand(n, root.launcher, root.notifyIcon))
      root.now = Date.now()
      if (root.mark.syncFolder && !newestPhone.running) {
        newestPhone.command = Mark.newestPhoneCommand(root.mark.syncFolder)
        newestPhone.running = true
      }
      if (root.mark.autoSync && root.mark.syncFolder && root.sync.state !== "running" && !phoneCheck.running) {
        phoneCheck.command = Mark.phoneCheckCommand(root.mark.syncFolder, root.phoneBaseline)
        phoneCheck.running = true
      }
    })
  }

  Process {
    id: phoneCheck
    stdout: StdioCollector {
      onStreamFinished: {
        var found = Mark.found(text)
        if (!found || found === root.lastTried || root.sync.state === "running") return
        root.lastTried = found
        root.autoRun = true
        root.startSync()
      }
    }
  }

  Process {
    id: newestPhone
    stdout: StdioCollector {
      onStreamFinished: {
        var found = Mark.found(text)
        if (found === root.lastPhone) return
        root.lastPhone = found
        root.refreshHealth()
      }
    }
  }

  // Core's requests have no deadline of their own, so these timers give
  // one; a reply after one is dropped.
  property bool healthBusy: false
  property int healthSeq: 0
  property int syncSeq: 0

  function refreshHealth() {
    if (healthBusy || !config) return
    healthBusy = true
    var seq = ++healthSeq
    healthDeadline.restart()
    Session.send(config, Sync.HEALTH_PAYLOAD, function(reply) {
      if (seq !== root.healthSeq) return
      healthDeadline.stop()
      root.healthBusy = false
      root.health = Sync.healthReply(reply)
    })
  }

  // One poll of core a minute; opening the popup polls too.
  // ponytail: each monitor's bar polls on its own; a service-kind entry
  // point could share one poll if that ever costs anything.
  Timer {
    interval: 60000
    running: root.config !== null
    repeat: true
    onTriggered: root.poll()
  }

  function openWindow() {
    Quickshell.execDetached(["sh", launcher])
    close()
  }

  // entry: one of entries, an Up next row (peek-open) or an update (open-chapter).
  function read(entry) {
    if (!entry) return
    Quickshell.execDetached(["sh", launcher].concat(entry.open))
    close()
  }

  function startSync() {
    if (sync.state === "running") return
    sync = Sync.reduce(sync, { type: "start" })
    if (!config) return finishSync({ type: "reply", reply: { state: "no-config", message: "" } })
    var seq = ++syncSeq
    syncDeadline.restart()
    Session.send(config, Sync.corePayload(false), function(reply) {
      if (seq !== root.syncSeq) return
      syncDeadline.stop()
      root.finishSync({ type: "reply", reply: reply })
    })
  }

  // event: Sync.reduce's "reply".
  function finishSync(event) {
    sync = Sync.reduce(sync, event)
    if (autoRun) {
      // The backup's mtime: the same on every bar, so one marker.
      var n = Mark.syncNotification(sync, "sync-" + lastTried.split(" ")[0].replace(/[^0-9]/g, ""))
      if (n) Quickshell.execDetached(Mark.notifyCommand(n, launcher, notifyIcon))
      autoRun = false
    }
    refreshHealth()
    poll()
  }

  Timer {
    id: syncDeadline
    interval: 1800 * 1000
    onTriggered: {
      root.syncSeq++
      root.finishSync({ type: "reply", reply: { state: "error", message: "miharchy-core did not finish the sync in 30 minutes." } })
    }
  }

  Timer {
    id: healthDeadline
    interval: 120 * 1000
    onTriggered: {
      root.healthSeq++
      root.healthBusy = false
      root.health = Sync.healthReply({ state: "error", message: "miharchy-core did not answer the health check in 2 minutes." })
    }
  }

  function pressed(button) {
    if (button === Qt.MiddleButton) openWindow()
    else toggle()
  }

  BarIconButton {
    id: icon
    anchors.left: parent.left
    anchors.top: parent.top
    anchors.bottom: parent.bottom
    bar: root.bar
    tooltipText: Mark.tooltip(root.mark)
    onPressed: function(button) { root.pressed(button) }
    // The rays turn green while a sync runs (icons/miharchy-active.svg).
    iconComponent: Component {
      MiharchyIcon {
        iconSize: icon.opticalSize
        color: icon.foreground
        rayColor: root.sync.state === "running" ? "#9ece6a" : color
        badgeColor: root.bar ? root.bar.urgent : Commons.Color.urgent
        warning: Mark.down(root.mark)
      }
    }
  }

  WidgetButton {
    id: count
    anchors.left: icon.right
    anchors.top: parent.top
    anchors.bottom: parent.bottom
    width: visible ? implicitWidth : 0
    bar: root.bar
    text: Mark.label(root.mark)
    fontSize: Style.font.bodySmall
    horizontalMargin: 3
    tooltipText: Mark.tooltip(root.mark)
    onPressed: function(button) { root.pressed(button) }
  }

  KeyboardPanel {
    id: popup
    anchorItem: icon
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keys
    contentWidth: popup.fittedContentWidth(Style.space(360))
    contentHeight: popup.fittedContentHeight(column.implicitHeight)

    PanelKeyCatcher {
      id: keys
      anchors.fill: parent
      onMoveRequested: function(dx, dy) { root.cursor = Mark.move(root.entries, root.cursor, dy) }
      onActivateRequested: root.read(root.entries[root.cursor])
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(t) {
        if (t === "w") root.openWindow()
        else if (t === "r") {
          root.poll()
          root.loadUpNext()
        }
        else if (t === "s") root.startSync()
      }

      Column {
        id: column
        width: parent.width
        spacing: Style.spacing.sm

        Text {
          textFormat: Text.PlainText
          text: "Miharchy"
          color: Commons.Color.popups.text
          font.family: Style.font.family
          font.pixelSize: Style.font.title
        }

        Text {
          textFormat: Text.PlainText
          width: parent.width
          visible: root.sync.state !== "idle"
          wrapMode: Text.Wrap
          text: Sync.oneLine(root.sync)
          color: root.sync.state === "failed" ? Commons.Color.urgent : Commons.Color.muted
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
        }

        Text {
          textFormat: Text.PlainText
          width: parent.width
          visible: text !== ""
          wrapMode: Text.Wrap
          text: root.health.state === "ready" ? Sync.healthPopupLine(root.health.health, root.now) : ""
          color: Commons.Color.urgent
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
        }

        // Up next, then the updates (Mark.entries); the notice stands in for
        // the updates, below Up next.
        Repeater {
          model: root.entries

          Column {
            id: entry
            required property var modelData
            required property int index
            width: column.width
            spacing: Style.spacing.sm

            Text {
              textFormat: Text.PlainText
              visible: entry.modelData.section !== ""
              text: entry.modelData.section
              color: Commons.Color.muted
              font.family: Style.font.family
              font.pixelSize: Style.font.bodySmall
            }

            Rectangle {
              width: column.width
              height: lines.implicitHeight + Style.spacing.md * 2
              radius: Style.cornerRadius
              color: entry.index === root.cursor ? Style.selectedAccentFill : "transparent"

              Column {
                id: lines
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                anchors.leftMargin: Style.spacing.md
                anchors.rightMargin: Style.spacing.md

                Text {
                  textFormat: Text.PlainText
                  width: parent.width
                  elide: Text.ElideRight
                  text: entry.modelData.title
                  color: Commons.Color.popups.text
                  font.family: Style.font.family
                  font.pixelSize: Style.font.body
                }

                Item {
                  width: parent.width
                  height: chapter.implicitHeight

                  Text {
                    id: chapter
                    textFormat: Text.PlainText
                    anchors.left: parent.left
                    anchors.right: date.left
                    anchors.rightMargin: Style.spacing.md
                    elide: Text.ElideRight
                    text: entry.modelData.chapter
                    color: Commons.Color.muted
                    font.family: Style.font.family
                    font.pixelSize: Style.font.bodySmall
                  }

                  Text {
                    id: date
                    textFormat: Text.PlainText
                    anchors.right: parent.right
                    text: entry.modelData.side
                    color: Commons.Color.muted
                    font.family: Style.font.family
                    font.pixelSize: Style.font.bodySmall
                  }
                }
              }

              MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onEntered: root.cursor = entry.index
                onClicked: root.read(entry.modelData)
              }
            }
          }
        }

        Text {
          textFormat: Text.PlainText
          width: parent.width
          visible: root.notice !== null
          wrapMode: Text.Wrap
          text: root.notice ? root.notice.title : ""
          color: Mark.down(root.mark) ? Commons.Color.urgent : Commons.Color.popups.text
          font.family: Style.font.family
          font.pixelSize: Style.font.body
        }

        Text {
          textFormat: Text.PlainText
          width: parent.width
          visible: root.notice !== null && root.notice.detail !== ""
          wrapMode: Text.Wrap
          text: root.notice ? root.notice.detail : ""
          color: Commons.Color.muted
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
        }

        Text {
          textFormat: Text.PlainText
          visible: root.notice === null && root.more > 0
          text: root.more + " more in the window"
          color: Commons.Color.muted
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
        }

        Text {
          textFormat: Text.PlainText
          text: "enter read   w window   s sync   r refresh"
          color: Commons.Color.muted
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
        }
      }
    }
  }
}
