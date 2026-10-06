.pragma library
.import "Model.js" as Model

// Live updates: one GraphQL subscription over a WebSocket on /api/graphql,
// in the graphql-transport-ws protocol. Pure, so tests/live.test.js pins it;
// LiveSocket.qml runs the socket.

var PROTOCOL = "graphql-transport-ws"
// The server closes a socket that sends nothing for 30 s, and never pings
// on its own.
var PING_MS = 10000
var PING = JSON.stringify({ type: "ping" })
var PONG = JSON.stringify({ type: "pong" })

function url(config) {
  return config.url.replace(/^http/, "ws") + "/api/graphql"
}

// The server reads the bare access token here; "Bearer " in front of it
// refuses the socket. Without one it acks and refuses every subscription.
function initMessage(token) {
  return JSON.stringify({ type: "connection_init", payload: { Authorization: token } })
}

// One socket carries one subscription. The server holds subscription ids
// across every socket, its other clients' too, and closes a socket that
// reuses one in use (4409 "Subscriber for 1 already exists"), so each
// subscribe takes a fresh id.
function subscribeMessage(query, random) {
  return JSON.stringify({ id: "miharchy-" + String(random).slice(2), type: "subscribe", payload: { query: query } })
}

// What one message from the server asks of the socket:
//   { type: "ack" }           connection_init accepted: subscribe
//   { type: "data", data }    the subscription's next result
//   { type: "ping" }          answer PONG
//   { type: "unauthorized" }  the token was stale: renew it and reconnect
//   { type: "ended", message } the subscription failed or completed: reconnect
//   { type: "none" }          nothing to do (a pong, or anything else)
// An access token that expires while the socket is open does not stop it;
// only a new connection_init is checked.
function parse(text) {
  var m
  try {
    m = JSON.parse(text)
  } catch (e) {
    return { type: "none" }
  }
  switch (m.type) {
    case "connection_ack":
      return { type: "ack" }
    case "ping":
      return { type: "ping" }
    case "next":
      if (m.payload && m.payload.errors && m.payload.errors.length) return refused(m.payload.errors)
      return { type: "data", data: (m.payload && m.payload.data) || {} }
    case "error":
      return refused(m.payload)
    case "complete":
      return { type: "ended", message: "" }
  }
  return { type: "none" }
}

function refused(errors) {
  var message = Model.errorText(errors && errors[0] && errors[0].message)
  return message === "Unauthorized" ? { type: "unauthorized" } : { type: "ended", message: message }
}

// The wait before reconnect attempt n, counted from 0 since the last ack:
// 1, 2, 4, 8, then 15 s, so a restarted server is back within 15 s.
function backoff(attempt) {
  return Math.min(15000, 1000 * Math.pow(2, attempt))
}

if (typeof module !== "undefined") {
  module.exports = {
    PROTOCOL: PROTOCOL,
    PING_MS: PING_MS,
    PING: PING,
    PONG: PONG,
    url: url,
    initMessage: initMessage,
    subscribeMessage: subscribeMessage,
    parse: parse,
    backoff: backoff
  }
}
