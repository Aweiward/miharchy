import QtQuick
import "Live.js" as Live
import "Session.js" as Session

// One live subscription (Live.js) while running: a WebSocket whose
// connection_init carries this process's access token (Session.token). A
// socket that closes or fails, as when the server restarts, opens again
// after Live.backoff(); a token the server refuses is renewed first. The
// WebSocket type comes from qt6-websockets, which Setup asks for. It is
// made at run time, so the window still loads without the module, with
// nothing live.
Item {
  id: live

  property var config: null
  property string query: ""
  property bool running: false
  // A result has come since the socket opened: the stream carries every
  // change from here on.
  property bool subscribed: false

  property var socket: null
  // The socket is meant to be open; a close while it is, is the server's.
  property bool wanted: false
  property string token: ""
  // The token the server refused, for the next connect to renew.
  property string stale: ""
  property int attempt: 0
  // Drops a token that arrives after a stop.
  property int seq: 0

  signal result(var data)

  onRunningChanged: restart()
  onConfigChanged: restart()
  Component.onCompleted: restart()

  function restart() {
    close()
    attempt = 0
    stale = ""
    if (running && config) connect()
  }

  function close() {
    seq++
    wanted = false
    subscribed = false
    retry.stop()
    if (socket) socket.active = false
  }

  function connect() {
    if (!socket) socket = make()
    if (!socket) return
    var s = ++seq
    Session.token(config, stale, function(failure, t) {
      if (s !== live.seq) return
      if (failure) return live.later()
      live.token = t
      live.stale = ""
      live.wanted = true
      live.socket.url = Live.url(live.config)
      live.socket.active = true
    })
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
      ws = Qt.createQmlObject("import QtWebSockets\nWebSocket { requestedSubprotocols: [\"" + Live.PROTOCOL + "\"] }", live, "LiveSocket")
    } catch (e) {
      console.warn("Live updates need qt6-websockets:", e.message || e)
      return null
    }
    ws.statusChanged.connect(function(status) {
      if (status === 1 && live.wanted) ws.sendTextMessage(Live.initMessage(live.token))
      if ((status === 3 || status === 4) && live.wanted) live.later()
    })
    ws.textMessageReceived.connect(received)
    return ws
  }

  function received(text) {
    var m = Live.parse(text)
    switch (m.type) {
      case "ack":
        socket.sendTextMessage(Live.subscribeMessage(query, Math.random()))
        break
      case "ping":
        socket.sendTextMessage(Live.PONG)
        break
      case "data":
        attempt = 0
        subscribed = true
        result(m.data)
        break
      case "unauthorized":
        stale = token
        later()
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
