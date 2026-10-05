pragma ComponentBehavior: Bound

import QtQuick
import "Commands.js" as Commands
import Quickshell
import Quickshell.Io
import "Model.js" as Model
import "Settings.js" as Settings
import "Storage.js" as Storage
import "Trackers.js" as Trackers

// The Settings view: one row per Settings.ROWS entry, the cache clear (row
// Settings.ROWS.length) under the storage sizes, then one per tracker the
// server offers. Its edit fields send every key to `key` first, so the
// window's one dispatcher decides what Esc and Enter do. The tracker rows
// talk to the server themselves; Trackers.js decides.
Item {
  id: view

  required property Theme theme
  property var config: null
  property var trackers: Trackers.initial()
  readonly property bool loginEditing: Trackers.editing(trackers)
  readonly property string loginStep: loginEditing ? trackers.login.step : ""
  property var values: ({})
  property int cursor: 0
  property bool editing: false
  // Model.problem() of the settings state, or null.
  property var problem: null
  property string editError: ""
  // Set editStart before editing turns on; editValue follows the field.
  property string editStart: ""
  property string editValue: ""

  // Bytes from Storage.sizes(), null until du answers; the note is the
  // last clear's outcome.
  property var storage: null
  property string storageNote: ""
  property bool clearing: false
  // Taken when the clear starts, so freed is what it removed.
  property var storageBefore: null
  // A string, so a settings load that keeps the folder measures nothing.
  readonly property string downloadsPath: values.downloadsPath || ""
  readonly property var storageDirs: Storage.dirs({
    HOME: Quickshell.env("HOME"),
    MIHARCHY_SERVER_ROOT: Quickshell.env("MIHARCHY_SERVER_ROOT"),
    MIHARCHY_SERVER_TMPDIR: Quickshell.env("MIHARCHY_SERVER_TMPDIR")
  }, downloadsPath)

  signal key(var event)
  signal editEnded()
  // A click puts shell.qml's cursor on a row; a double click then sends Enter.
  signal picked(int index)

  function point(index, twice) {
    if (editing || loginEditing) return
    picked(index)
    if (twice) key(Commands.enter())
  }

  onVisibleChanged: if (visible) {
    loadTrackers()
    storageNote = ""
    measure()
  }
  onDownloadsPathChanged: if (visible) measure()
  onConfigChanged: {
    trackers = Trackers.initial()
    loadTrackers()
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
  }

  // Never during a login: reading the trackers makes a new MyAnimeList
  // link, and the old one the browser holds stops working.
  function loadTrackers() {
    if (!config || !visible || trackers.login) return
    trackers = Trackers.reduce(trackers, { type: "request" })
    send(Trackers.listPayload(), function(reply) {
      view.trackers = Trackers.reduce(view.trackers, { type: "list", reply: reply })
    })
  }

  function startLogin(i) {
    trackers = Trackers.begin(trackers, i)
    advance()
  }

  function advance() {
    var payload = Trackers.loginPayload(trackers)
    if (!payload) return
    var answer = trackers.login.step === "link" ? "link" : "reply"
    trackers = Trackers.reduce(trackers, { type: "sent" })
    send(payload, function(reply) {
      view.trackers = Trackers.reduce(view.trackers, { type: answer, reply: reply })
      var l = view.trackers.login
      if (answer === "link" && l && l.step === "paste") {
        browser.command = ["xdg-open", l.url]
        browser.running = true
      }
    })
  }

  function measure() {
    if (du.running) return
    du.command = Storage.command(storageDirs)
    du.running = true
  }

  function clearCache() {
    if (!config || clearing || du.running || !storage) return
    clearing = true
    storageBefore = storage
    storageNote = ""
    send(Storage.clearPayload(), function(reply) {
      if (reply.state !== "ok" || !Storage.cleared(reply.data)) {
        view.clearing = false
        view.storageNote = reply.state !== "ok" ? reply.message || Model.problem(reply, "server.json").title : "The server could not empty the cache."
        return
      }
      view.measure()
    })
  }

  // du's exit code is 1 when a folder is missing; sizes() reads what it
  // listed.
  Process {
    id: du
    stdout: StdioCollector {
      onStreamFinished: {
        view.storage = Storage.sizes(view.storageDirs, text)
        if (!view.clearing) return
        view.clearing = false
        view.storageNote = "Freed " + Storage.format(Math.max(0, (view.storageBefore ? view.storageBefore.cache : 0) - view.storage.cache))
      }
    }
  }

  function run(id) {
    trackers = Trackers.reduce(trackers, id === "login.commit" ? { type: "commit", text: loginField.text } : { type: "cancel" })
    advance()
    if (!loginEditing) editEnded()
  }

  // The user's browser, opened by the Enter that started the login.
  Process { id: browser }

  // Each step of a login starts with an empty field.
  onLoginStepChanged: {
    if (!loginStep) return
    loginField.text = ""
    Qt.callLater(loginField.forceActiveFocus)
  }

  Column {
    anchors.fill: parent
    anchors.margins: view.theme.fontSize * 2
    spacing: view.theme.fontSize

    Text {
      width: parent.width
      visible: view.problem !== null
      wrapMode: Text.Wrap
      text: view.problem ? view.problem.title + ". " + view.problem.detail : ""
      color: view.theme.urgent
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSize
    }

    Column {
      width: Math.min(parent.width, view.theme.fontSize * 60)

      Repeater {
        model: Settings.ROWS

        Rectangle {
          id: row
          required property var modelData
          required property int index
          readonly property bool current: index === view.cursor
          readonly property bool editingThis: current && view.editing
          width: parent.width
          height: view.theme.fontSize * 2.4
          color: current ? view.theme.selected : "transparent"

          MouseArea {
            anchors.fill: parent
            onClicked: view.point(row.index, false)
            onDoubleClicked: view.point(row.index, true)
          }

          Text {
            id: label
            anchors.left: parent.left
            anchors.leftMargin: view.theme.fontSize * 0.75
            anchors.verticalCenter: parent.verticalCenter
            text: row.modelData.label
            color: row.current ? view.theme.selectedText : view.theme.foreground
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSize
          }

          Text {
            anchors.left: label.right
            anchors.leftMargin: view.theme.fontSize * 2
            anchors.right: parent.right
            anchors.rightMargin: view.theme.fontSize * 0.75
            anchors.verticalCenter: parent.verticalCenter
            horizontalAlignment: Text.AlignRight
            elide: Text.ElideLeft
            visible: !row.editingThis
            text: Settings.display(row.modelData, view.values[row.modelData.key])
            color: row.current ? view.theme.selectedText : view.theme.muted
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSize
          }

          TextInput {
            id: field
            anchors.right: parent.right
            anchors.rightMargin: view.theme.fontSize * 0.75
            anchors.verticalCenter: parent.verticalCenter
            width: parent.width / 2
            visible: row.editingThis
            horizontalAlignment: TextInput.AlignRight
            clip: true
            color: view.theme.selectedText
            selectionColor: view.theme.accent
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSize
            onTextChanged: if (row.editingThis) view.editValue = text
            Keys.onPressed: function(event) { view.key(event) }
          }

          onEditingThisChanged: {
            if (!editingThis) return
            field.text = view.editStart
            view.editValue = field.text
            field.selectAll()
            field.forceActiveFocus()
          }
        }
      }
    }

    Text {
      width: parent.width
      visible: view.editError !== ""
      text: view.editError
      color: view.theme.urgent
      font.family: view.theme.fontFamily
      font.pixelSize: view.theme.fontSmall
    }

    Column {
      width: Math.min(parent.width, view.theme.fontSize * 60)

      Text {
        leftPadding: view.theme.fontSize * 0.75
        bottomPadding: view.theme.fontSize * 0.5
        text: "Storage   downloads " + (view.storage ? Storage.format(view.storage.downloads) : "measuring")
        color: view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }

      Rectangle {
        readonly property bool current: view.cursor === Settings.ROWS.length
        width: parent.width
        height: view.theme.fontSize * 2.4
        color: current ? view.theme.selected : "transparent"

        MouseArea {
          anchors.fill: parent
          onClicked: view.point(Settings.ROWS.length, false)
          onDoubleClicked: view.point(Settings.ROWS.length, true)
        }

        Text {
          anchors.left: parent.left
          anchors.leftMargin: view.theme.fontSize * 0.75
          anchors.verticalCenter: parent.verticalCenter
          text: "Clear the cache"
          color: parent.current ? view.theme.selectedText : view.theme.foreground
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize
        }

        Text {
          anchors.right: parent.right
          anchors.rightMargin: view.theme.fontSize * 0.75
          anchors.verticalCenter: parent.verticalCenter
          text: view.clearing ? "clearing" : (view.storageNote ? view.storageNote + "   " : "") + (view.storage ? Storage.format(view.storage.cache) : "measuring")
          color: parent.current ? view.theme.selectedText : view.theme.muted
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize
        }
      }
    }

    Column {
      id: trackerRows
      width: Math.min(parent.width, view.theme.fontSize * 60)

      Text {
        leftPadding: view.theme.fontSize * 0.75
        bottomPadding: view.theme.fontSize * 0.5
        text: view.trackers.state === "loading" && !view.trackers.list.length ? "Trackers   loading" : "Trackers"
        color: view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }

      Repeater {
        model: view.trackers.list

        Rectangle {
          id: tracker
          required property var modelData
          required property int index
          readonly property bool current: index + Settings.ROWS.length + 1 === view.cursor
          width: parent.width
          height: view.theme.fontSize * 2.4
          color: current ? view.theme.selected : "transparent"

          MouseArea {
            anchors.fill: parent
            onClicked: view.point(tracker.index + Settings.ROWS.length + 1, false)
            onDoubleClicked: view.point(tracker.index + Settings.ROWS.length + 1, true)
          }

          Text {
            anchors.left: parent.left
            anchors.leftMargin: view.theme.fontSize * 0.75
            anchors.verticalCenter: parent.verticalCenter
            text: tracker.modelData.name
            color: tracker.current ? view.theme.selectedText : view.theme.foreground
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSize
          }

          Text {
            anchors.right: parent.right
            anchors.rightMargin: view.theme.fontSize * 0.75
            anchors.verticalCenter: parent.verticalCenter
            text: Trackers.status(view.trackers, tracker.index)
            color: tracker.current ? view.theme.selectedText : tracker.modelData.loggedIn ? view.theme.accent : view.theme.muted
            font.family: view.theme.fontFamily
            font.pixelSize: view.theme.fontSize
          }
        }
      }

      Row {
        visible: view.loginEditing
        width: parent.width
        height: view.theme.fontSize * 2.4
        leftPadding: view.theme.fontSize * 0.75
        spacing: view.theme.fontSize

        Text {
          id: loginPrompt
          anchors.verticalCenter: parent.verticalCenter
          text: view.loginEditing ? view.trackers.login.name + " " + Trackers.prompt(view.trackers.login) : ""
          color: view.theme.muted
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize
        }

        TextInput {
          id: loginField
          anchors.verticalCenter: parent.verticalCenter
          width: parent.width - loginPrompt.width - parent.spacing - parent.leftPadding * 2
          clip: true
          echoMode: view.loginStep === "password" ? TextInput.Password : TextInput.Normal
          color: view.theme.selectedText
          selectionColor: view.theme.accent
          font.family: view.theme.fontFamily
          font.pixelSize: view.theme.fontSize
          Keys.onPressed: function(event) { view.key(event) }
        }
      }

      // Selectable, so the login link can be copied when no browser opens.
      TextEdit {
        width: parent.width
        visible: text !== ""
        leftPadding: view.theme.fontSize * 0.75
        topPadding: view.theme.fontSize * 0.5
        readOnly: true
        selectByMouse: true
        wrapMode: TextEdit.WrapAnywhere
        text: view.trackers.state !== "ok" && view.trackers.state !== "loading" ? (Model.problem(view.trackers, "server.json") || { title: "" }).title : Trackers.note(view.trackers)
        color: view.trackers.error || (view.trackers.login && view.trackers.login.error) ? view.theme.urgent : view.theme.muted
        selectionColor: view.theme.accent
        font.family: view.theme.fontFamily
        font.pixelSize: view.theme.fontSmall
      }
    }
  }
}
