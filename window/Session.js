.pragma library
.import "Model.js" as Model

// Every request to miharchy-core (ADR 0010) goes through here: the window's
// and the plugin's. Core takes core.json's secret as the bearer token on
// every request: no login and no refresh.

var JSON_KIND = {
  read: function(xhr) { return Model.coreReply(xhr.status, xhr.responseText) },
  failed: function(reply) { return reply }
}
var IMAGE = {
  binary: true,
  read: function(xhr) { return { status: xhr.status, data: xhr.response, contentType: xhr.getResponseHeader("Content-Type") || "" } },
  failed: function() { return { status: 0, data: null, contentType: "" } }
}

// One XHR with the secret.
function open(url, payload, binary, token, back) {
  var xhr = new XMLHttpRequest()
  if (binary) xhr.responseType = "arraybuffer"
  xhr.onreadystatechange = function() {
    if (xhr.readyState === XMLHttpRequest.DONE) back(xhr)
  }
  xhr.open(payload ? "POST" : "GET", url)
  if (payload) xhr.setRequestHeader("Content-Type", "application/json")
  if (token) xhr.setRequestHeader("Authorization", "Bearer " + token)
  xhr.send(payload ? JSON.stringify(payload) : "")
  return xhr
}

// One request; done gets one answer. Returns { abort }, which answers done
// at once as a request with no answer (status 0).
function call(config, url, payload, kind, done) {
  var c = { xhr: null, over: false }
  var finish = function(result) {
    if (c.over) return
    c.over = true
    done(result)
  }
  c.xhr = open(url, payload, kind.binary, config.secret, function(xhr) {
    c.xhr = null
    finish(kind.read(xhr))
  })
  return {
    abort: function() {
      if (c.xhr) c.xhr.abort()
      finish(kind.failed(Model.coreReply(0, "")))
    }
  }
}

// A payload that is not a core route fails at once, and is logged: some
// sends drop their reply, and a drive greps the log for it.
function refused(done) {
  console.warn("miharchy: refused a request that is not a miharchy-core route")
  done({ state: "error", message: "This request is not a miharchy-core route.", data: null, kind: "internal" })
  return { abort: function() {} }
}

// payload: { route, body? }; done(reply), reply as Model.coreReply gives.
function send(config, payload, done) {
  if (!payload || typeof payload.route !== "string") return refused(done)
  return call(config, config.url + "/api/" + payload.route, payload.body || {}, JSON_KIND, done)
}

// A server image's bytes: done({ status, data, contentType }).
function image(config, url, done) {
  return call(config, url, null, IMAGE, done)
}

if (typeof module !== "undefined") {
  module.exports = {
    send: send,
    image: image
  }
}
