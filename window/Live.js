.pragma library

// Live updates: one topic on miharchy-core's WebSocket (ADR 0010). Pure, so
// tests/live.test.js pins it; LiveSocket.qml runs the socket.

// The socket pings every PING_MS; core answers with a pong, which parseCore
// ignores.
var PING_MS = 10000
var PING = JSON.stringify({ type: "ping" })

// miharchy-core's live socket: /api/live, no subprotocol. The first
// message is the secret, then one subscribe per topic; a wrong secret
// closes the socket (4401), which reconnects as any close does.
function coreUrl(config) {
  return config.url.replace(/^http/, "ws") + "/api/live"
}

function coreOpen(secret, topic) {
  return [JSON.stringify({ secret: secret }), JSON.stringify({ subscribe: topic })]
}

// What one message from core asks of the socket:
//   { type: "data", data }     the topic's whole state
//   { type: "ended", message } the topic failed: reconnect
//   { type: "none" }           nothing to do (a pong, or another topic)
function parseCore(text, topic) {
  var m
  try {
    m = JSON.parse(text)
  } catch (e) {
    return { type: "none" }
  }
  if (!m || m.topic !== topic) return { type: "none" }
  if (m.error) return { type: "ended", message: String(m.error.message || "") }
  return { type: "data", data: m.data }
}

// The wait before reconnect attempt n, counted from 0 since the last data:
// 1, 2, 4, 8, then 15 s, so a restarted server is back within 15 s.
function backoff(attempt) {
  return Math.min(15000, 1000 * Math.pow(2, attempt))
}

if (typeof module !== "undefined") {
  module.exports = {
    PING_MS: PING_MS,
    PING: PING,
    coreUrl: coreUrl,
    coreOpen: coreOpen,
    parseCore: parseCore,
    backoff: backoff
  }
}
