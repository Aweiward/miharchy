pragma ComponentBehavior: Bound

import QtQuick
import "Commands.js" as Commands
import "Extensions.js" as Extensions
import "LibraryCheck.js" as LibraryCheck
import "Model.js" as Model
import "Session.js" as Session

// The library check: the problems LibraryCheck.js finds, grouped by kind and
// source. Like Setup, a screen and not a view. It loads each time it shows,
// and when the Settings row asks for its count. shell.qml forwards every
// "check." command to run().
Item {
  id: view

  required property Theme theme
  property var config: null
  property string configPath: ""
  property bool active: false

  // state: the connection states (Model.problem words a failure), "idle"
  // before the first load.
  property var check: ({ state: "idle", message: "", problems: [] })
  property bool showDismissed: false
  property int cursor: 0
  // { problem key: true }; selectedIds is what a batch action takes.
  property var selected: ({})
  property string error: ""
  property int seq: 0
  // Enter on a duplicate: { copies: LibraryCheck.mergeCopies(), cursor },
  // the prompt that asks which copy stays.
  property var merge: null
  readonly property bool merging: merge !== null

  readonly property var rows: LibraryCheck.rows(check.problems, showDismissed)
  readonly property var selectedIds: LibraryCheck.selectedIds(selected, rows)
  readonly property int count: LibraryCheck.count(check.problems)
  // The Settings row's value: empty until the first load answers.
  readonly property string countText: check.state === "ok" ? LibraryCheck.countText(count) : ""
  readonly property var current: rows[cursor] || null
  // A failed load, worded; null while it loads or after it answers.
  readonly property var problem: Model.problem(check, configPath)
  readonly property string hint: merging ? (merge.cursor === -1 ? "esc close   " : "j k move   enter keep this one   esc cancel   ") : "j k move   space select   x " + (showDismissed ? "bring back" : "dismiss") + "   X " + (showDismissed ? "problems" : "dismissed") + "   "
    + (current && current.kind === "extension" && current.type === "problem" ? "enter update   " : "")
    + (current && current.kind === "duplicate" && current.type === "problem" ? "enter merge   " : "") + "M migrate   "

  signal key(var event)
  // The copy chosen to stay: LibraryCheck.mergeJob().
  signal mergeChosen(var job)

  onActiveChanged: {
    merge = null
    if (active) load()
  }
  onConfigChanged: if (active) load()
  onCursorChanged: list.positionViewAtIndex(cursor, ListView.Contain)

  function send(payload, done) {
    return Session.send(config, payload, done)
  }

  function load() {
    if (!config) return
    var s = ++seq
    check = { state: "loading", message: "", problems: check.problems }
    send({ query: LibraryCheck.QUERY }, function(reply) {
      if (s !== view.seq) return
      view.check = reply.state === "ok"
        ? { state: "ok", message: "", problems: LibraryCheck.problems(reply.data, Date.now()) }
        : { state: reply.state, message: reply.message, problems: view.check.problems }
      view.cursor = Math.max(0, Math.min(view.rows.length - 1, view.cursor))
    })
  }

  function mutate(payload) {
    if (!payload || !config) return
    error = ""
    send(payload, function(reply) {
      if (reply.state !== "ok") view.error = reply.message || Model.problem(reply, view.configPath).title
      view.load()
    })
  }

  // What M migrates: the selection, else the group or row under the cursor.
  function migrateList() {
    return LibraryCheck.migrateList(LibraryCheck.targets(rows, selected, cursor), check.problems)
  }

  // A click moves the cursor as j and k do; a double click then sends Enter.
  function point(index, twice) {
    cursor = index
    if (twice) key(Commands.enter())
  }

  function run(id) {
    switch (id) {
      case "check.up":
      case "check.down":
        if (rows.length) cursor = Math.max(0, Math.min(rows.length - 1, cursor + (id === "check.up" ? -1 : 1)))
        break
      case "check.select":
        selected = LibraryCheck.select(selected, rows, cursor)
        break
      case "check.dismiss":
        mutate(LibraryCheck.dismissPayload(LibraryCheck.targets(rows, selected, cursor), Date.now(), showDismissed))
        selected = {}
        break
      case "check.dismissed":
        showDismissed = !showDismissed
        selected = {}
        cursor = 0
        break
      case "check.activate":
        if (current && current.type === "problem" && current.kind === "extension") mutate(Extensions.actionPayload(current.pkgName, "update"))
        if (current && current.type === "problem" && current.kind === "duplicate") openMerge(current)
        break
      case "check.mergeUp":
      case "check.mergeDown":
        if (merge.cursor !== -1) merge = { copies: merge.copies, cursor: LibraryCheck.mergeMove(merge.copies, merge.cursor, id === "check.mergeUp" ? -1 : 1) }
        break
      case "check.mergeKeep":
        if (merge.cursor === -1) break
        var job = LibraryCheck.mergeJob(merge.copies, merge.cursor)
        merge = null
        mergeChosen(job)
        break
      case "check.mergeClose":
        merge = null
        break
    }
  }

  function openMerge(problem) {
    error = ""
    var s = seq
    send({ query: LibraryCheck.MERGE_QUERY, variables: LibraryCheck.mergeVariables(problem) }, function(reply) {
      if (s !== view.seq || !view.active) return
      if (reply.state !== "ok") view.error = reply.message || Model.problem(reply, view.configPath).title
      else {
        var copies = LibraryCheck.mergeCopies(reply.data)
        view.merge = { copies: copies, cursor: LibraryCheck.mergeStart(copies) }
      }
    })
  }

  Text {
    id: head
    anchors.top: parent.top
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.margins: view.theme.fontSize * 2
    wrapMode: Text.Wrap
    text: view.error ? view.error
      : view.problem ? view.problem.title
      : (view.showDismissed ? "Dismissed problems. x brings one back." : "Problems in the library, found from what the server knows.")
        + (view.selectedIds.length ? "   " + view.selectedIds.length + " selected" : "")
    color: view.error || view.problem ? view.theme.urgent : view.theme.muted
    font.family: view.theme.fontFamily
    font.pixelSize: view.theme.fontSmall
  }

  Text {
    anchors.centerIn: parent
    visible: view.check.state === "ok" && !view.rows.length
    text: view.showDismissed ? "No dismissed problems" : "No problems found"
    color: view.theme.foreground
    font.family: view.theme.fontFamily
    font.pixelSize: view.theme.fontHeading
  }

  ListView {
    id: list
    anchors.top: head.bottom
    anchors.bottom: parent.bottom
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.leftMargin: view.theme.fontSize * 2
    anchors.rightMargin: view.theme.fontSize * 2
    anchors.topMargin: view.theme.fontSize
    clip: true
    model: RowModel {
      items: view.rows
      key: function(r) { return r.key }
    }

    delegate: Rectangle {
      id: row
      required property var modelData
      required property int index
      readonly property bool current: index === view.cursor
      readonly property bool group: modelData.type === "group"
      readonly property bool picked: !group && view.selected[modelData.key] === true
      width: list.width
      height: view.theme.fontSize * (group ? 2.6 : 3.4)
      color: current ? view.theme.selected : "transparent"

      MouseArea {
        anchors.fill: parent
        onClicked: view.point(row.index, false)
        onDoubleClicked: view.point(row.index, true)
      }

      Text {
        visible: row.group
        anchors.left: parent.left
        anchors.leftMargin: view.theme.fontSize * 0.5
        anchors.bottom: parent.bottom
        anchors.bottomMargin: view.theme.fontSize * 0.4
        text: row.modelData.label || ""
        color: row.current ? view.theme.selectedText : view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSize
      }

      Column {
        visible: !row.group
        anchors.left: parent.left
        anchors.leftMargin: view.theme.fontSize * 1.5
        anchors.right: parent.right
        anchors.rightMargin: view.theme.fontSize * 0.75
        anchors.verticalCenter: parent.verticalCenter

        Text {
          width: parent.width
          elide: Text.ElideRight
          text: (row.picked ? "● " : "") + (row.modelData.title || "")
          color: row.current ? view.theme.selectedText : row.picked ? view.theme.accent : view.theme.foreground
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize
        }

        Text {
          width: parent.width
          elide: Text.ElideRight
          text: row.modelData.reason || ""
          color: view.theme.muted
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSmall
        }
      }
    }
  }

  // Under the merge prompt: a click outside it never reaches a row.
  MouseArea {
    anchors.fill: parent
    visible: view.merging
  }

  Rectangle {
    anchors.centerIn: parent
    width: Math.min(parent.width - view.theme.fontSize * 4, view.theme.fontSize * 50)
    height: mergeColumn.height + view.theme.fontSize * 2
    visible: view.merging
    color: Qt.alpha(view.theme.panel, 1)
    border.width: 1
    border.color: view.theme.panelBorder

    Column {
      id: mergeColumn
      x: view.theme.fontSize
      y: view.theme.fontSize
      width: parent.width - view.theme.fontSize * 2
      spacing: view.theme.fontSize * 0.5

      Text {
        width: parent.width
        wrapMode: Text.Wrap
        bottomPadding: view.theme.fontSize * 0.5
        text: view.merge && view.merge.cursor === -1 ? "No copy can be kept: both sources are missing. Install one, then merge."
          : "Merge the duplicates. Pick the copy that stays; the other migrates into it and leaves the library. A copy whose source is missing cannot stay."
        color: view.merge && view.merge.cursor === -1 ? view.theme.urgent : view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }

      Repeater {
        model: view.merge ? view.merge.copies : []

        Rectangle {
          id: copyRow
          required property var modelData
          required property int index
          readonly property bool current: view.merge !== null && index === view.merge.cursor
          width: mergeColumn.width
          height: copyText.implicitHeight + view.theme.fontSize * 0.6
          color: current ? view.theme.selected : "transparent"

          MouseArea {
            anchors.fill: parent
            enabled: !copyRow.modelData.missing
            onClicked: view.merge = { copies: view.merge.copies, cursor: copyRow.index }
            onDoubleClicked: {
              view.merge = { copies: view.merge.copies, cursor: copyRow.index }
              view.key(Commands.enter())
            }
          }

          Column {
            id: copyText
            anchors.left: parent.left
            anchors.leftMargin: view.theme.fontSize * 0.5
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter

            Text {
              width: parent.width
              elide: Text.ElideRight
              text: copyRow.modelData.title
              color: copyRow.current ? view.theme.selectedText : view.theme.foreground
              font.family: view.theme.fontFamily
              font.pixelSize: view.theme.fontSize
            }

            Text {
              width: parent.width
              wrapMode: Text.Wrap
              text: LibraryCheck.copyText(copyRow.modelData)
              color: copyRow.current ? view.theme.selectedText : view.theme.muted
              font.family: view.theme.fontFamily
              font.pixelSize: view.theme.fontSmall
            }
          }
        }
      }
    }
  }
}
