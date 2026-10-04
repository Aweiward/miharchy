import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Mark.js" as Mark
import "../window/Model.js" as Model
import "../window/Sync.js" as Sync

// The mark in the Omarchy bar and its popup of recent updates. It stays thin
// (ADR 0003): it polls the server and starts the window, which runs as its
// own process through window/miharchy. Mark.js decides what shows; Sync now
// runs the same sync helper the window runs.
Panel {
  id: root
  moduleName: "miharchy"

  readonly property string configPath: Quickshell.env("MIHARCHY_SERVER_JSON") || Quickshell.env("HOME") + "/.config/miharchy/server.json"
  readonly property string launcher: decodeURIComponent(Qt.resolvedUrl("../window/miharchy").toString().replace(/^file:\/\//, ""))
  property var config: null
  property var mark: Mark.initial()
  readonly property string devHelper: decodeURIComponent(Qt.resolvedUrl(Sync.DEV_HELPER).toString().replace(/^file:\/\//, ""))
  property var sync: Sync.initial()
  property int cursor: 0
  // Only the latest poll may land.
  property int pollSeq: 0

  readonly property var rows: mark.rows
  readonly property var notice: Mark.notice(mark, configPath)
  readonly property int more: mark.count - rows.length

  implicitWidth: icon.implicitWidth + (count.visible ? count.implicitWidth : 0)
  implicitHeight: icon.implicitHeight

  onOpenedChanged: if (opened) {
    cursor = 0
    poll()
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
    config = Model.parseConfig(text)
    if (config) return poll()
    pollSeq++
    mark = Mark.reduce(mark, { type: "config-missing" })
  }

  function poll() {
    if (!config) return
    var seq = ++pollSeq
    var cfg = config
    var req = Model.request(cfg, Mark.listPayload())
    var xhr = new XMLHttpRequest()
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== XMLHttpRequest.DONE || seq !== root.pollSeq) return
      root.mark = Mark.reduce(root.mark, { type: "reply", reply: Model.reply(xhr.status, xhr.responseText), config: cfg, now: Date.now() })
    }
    xhr.open("POST", req.url)
    xhr.setRequestHeader("Content-Type", "application/json")
    xhr.setRequestHeader("Authorization", req.authorization)
    xhr.send(req.body)
  }

  // One GraphQL query to localhost a minute; opening the popup polls too.
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

  function read(row) {
    if (!row) return
    Quickshell.execDetached(["sh", launcher, "open-chapter", String(row.mangaId), String(row.id)])
    close()
  }

  function startSync() {
    if (sync.state === "running") return
    sync = Sync.reduce(sync, { type: "start" })
    syncJob.command = Sync.command(devHelper)
    syncJob.running = true
  }

  Process {
    id: syncJob
    stdout: StdioCollector {
      onStreamFinished: {
        root.sync = Sync.reduce(root.sync, { type: "finish", text: text })
        root.poll()
      }
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
    // nf-fa-book
    text: ""
    tooltipText: Mark.tooltip(root.mark)
    onPressed: function(button) { root.pressed(button) }

    Rectangle {
      visible: Mark.down(root.mark)
      width: Style.space(6)
      height: width
      radius: width / 2
      color: root.bar ? root.bar.urgent : Color.urgent
      anchors.right: parent.right
      anchors.top: parent.top
      anchors.rightMargin: Style.space(3)
      anchors.topMargin: (parent.height - Style.bar.iconCanvas) / 2
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
      onMoveRequested: function(dx, dy) {
        if (root.rows.length) root.cursor = Math.max(0, Math.min(root.rows.length - 1, root.cursor + dy))
      }
      onActivateRequested: root.read(root.rows[root.cursor])
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(t) {
        if (t === "w") root.openWindow()
        else if (t === "r") root.poll()
        else if (t === "s") root.startSync()
      }

      Column {
        id: column
        width: parent.width
        spacing: Style.spacing.sm

        Text {
          text: "Miharchy"
          color: Color.popups.text
          font.family: Style.font.family
          font.pixelSize: Style.font.title
        }

        Text {
          width: parent.width
          visible: root.sync.state !== "idle"
          wrapMode: Text.Wrap
          text: Sync.oneLine(root.sync)
          color: root.sync.state === "failed" ? Color.urgent : Color.muted
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
        }

        Text {
          width: parent.width
          visible: root.notice !== null
          wrapMode: Text.Wrap
          text: root.notice ? root.notice.title : ""
          color: Mark.down(root.mark) ? Color.urgent : Color.popups.text
          font.family: Style.font.family
          font.pixelSize: Style.font.body
        }

        Text {
          width: parent.width
          visible: root.notice !== null && root.notice.detail !== ""
          wrapMode: Text.Wrap
          text: root.notice ? root.notice.detail : ""
          color: Color.muted
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
        }

        Repeater {
          model: root.notice === null ? root.rows : []

          Rectangle {
            id: entry
            required property var modelData
            required property int index
            width: column.width
            height: lines.implicitHeight + Style.spacing.md * 2
            radius: Style.cornerRadius
            color: index === root.cursor ? Style.selectedAccentFill : "transparent"

            Column {
              id: lines
              anchors.left: parent.left
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              anchors.leftMargin: Style.spacing.md
              anchors.rightMargin: Style.spacing.md

              Text {
                width: parent.width
                elide: Text.ElideRight
                text: entry.modelData.title
                color: Color.popups.text
                font.family: Style.font.family
                font.pixelSize: Style.font.body
              }

              Item {
                width: parent.width
                height: chapter.implicitHeight

                Text {
                  id: chapter
                  anchors.left: parent.left
                  anchors.right: date.left
                  anchors.rightMargin: Style.spacing.md
                  elide: Text.ElideRight
                  text: entry.modelData.chapter
                  color: Color.muted
                  font.family: Style.font.family
                  font.pixelSize: Style.font.bodySmall
                }

                Text {
                  id: date
                  anchors.right: parent.right
                  text: entry.modelData.date
                  color: Color.muted
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

        Text {
          visible: root.notice === null && root.more > 0
          text: root.more + " more in the window"
          color: Color.muted
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
        }

        Text {
          text: "enter read   w window   s sync   r refresh"
          color: Color.muted
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
        }
      }
    }
  }
}
