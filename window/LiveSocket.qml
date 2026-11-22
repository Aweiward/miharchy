import QtQuick
import "Live.js" as Live

// One live topic (Live.js) while running: a WebSocket on miharchy-core's
// /api/live, whose first message is the secret. A socket that closes or
// fails, as when the server restarts, opens again after Live.backoff(). The
// WebSocket type comes from qt6-websockets, which Setup asks for. It is
// made at run time, so the window still loads without the module, with
// nothing live.
Item {
  id: live

  property var config: null
  property string topic: ""
  // Unused. DownloadsView.qml still binds it; remove with that binding.
  property string query: ""
  property bool running: false
  // A result has come since the socket opened: the stream carries every
  // change from here on.
  property bool subscribed: false

  property var socket: null
  // The socket is meant to be open; a close while it is, is the server's.
  property bool wanted: false
  property int attempt: 0

  signal result(var data)

  onRunningChanged: restart()
  onConfigChanged: restart()
  Component.onCompleted: restart()

  function restart() {
    close()
    attempt = 0
    if (running && config) connect()
  }

  function close() {
    wanted = false
    subscribed = false
    retry.stop()
    if (socket) socket.active = false
  }

  function connect() {
    if (!socket) socket = make()
    if (!socket) return
    // Core takes the secret as the first message: no login, no token.
    wanted = true
    socket.url = Live.coreUrl(config)
    socket.active = true
  }

  function later() {
    close()
    retry.interval = Live.backoff(attempt++)
    retry.start()
  }

  // WebSocket.status: 1 Open, 3 Closed, 4 Error. The enum is the module's,
  // which this file cannot import.
  function make() {
    var ws
    try {
      ws = Qt.createQmlObject("import QtWebSockets\nWebSocket { }", live, "LiveSocket")
    } catch (e) {
      console.warn("Live updates need qt6-websockets:", e.message || e)
      return null
    }
    ws.statusChanged.connect(function(status) {
      if (status === 1 && live.wanted) Live.coreOpen(live.config.secret, live.topic).forEach(function(m) { ws.sendTextMessage(m) })
      if ((status === 3 || status === 4) && live.wanted) live.later()
    })
    ws.textMessageReceived.connect(received)
    return ws
  }

  function received(text) {
    var m = Live.parseCore(text, topic)
    switch (m.type) {
      case "data":
        attempt = 0
        subscribed = true
        result(m.data)
        break
      case "ended":
        console.warn("Live updates ended:", m.message)
        later()
        break
    }
  }

  Timer {
    id: retry
    onTriggered: live.connect()
  }

  Timer {
    interval: Live.PING_MS
    repeat: true
    running: live.wanted
    onTriggered: if (live.socket.status === 1) live.socket.sendTextMessage(Live.PING)
  }
}
