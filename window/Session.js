.pragma library
.import "Model.js" as Model

// This process's login to the server (ADR 0005). Every request to the server
// goes through here: the window's and the plugin's. The first one logs in
// with server.json's username and password, the rest send the access token.
// When the server refuses the token, one refresh (or, failing that, a new
// login) runs for every request waiting on it, and each request goes once
// more. The tokens live in this module only: .pragma library keeps one copy
// per process, and nothing writes them to a file or a URL.

var LOGIN = "mutation($username: String!, $password: String!) { login(input: { username: $username, password: $password }) { accessToken refreshToken } }"
var REFRESH = "mutation($refreshToken: String!) { refreshToken(input: { refreshToken: $refreshToken }) { accessToken } }"

// key: the config the tokens belong to. waiting: the callbacks of the login
// or refresh in flight, null while none is.
var session = { key: "", access: "", refresh: "", waiting: null }

function loginPayload(config) {
  return { query: LOGIN, variables: { username: config.username, password: config.password } }
}

function refreshPayload(refreshToken) {
  return { query: REFRESH, variables: { refreshToken: refreshToken } }
}

function keyOf(config) {
  return [config.url, config.username, config.password].join("\n")
}

// What each kind of request makes of its XHR, whether that answer refuses
// the token, and what it answers when no login succeeds. GraphQL refuses
// with an "Unauthorized" error (Model.reply), an image with HTTP 401.
var GRAPHQL = {
  read: function(xhr) { return Model.reply(xhr.status, xhr.responseText) },
  refused: function(reply) { return reply.state === "unauthorized" },
  failed: function(reply) { return reply }
}
var IMAGE = {
  binary: true,
  read: function(xhr) { return { status: xhr.status, data: xhr.response, contentType: xhr.getResponseHeader("Content-Type") || "" } },
  refused: function(r) { return r.status === 401 },
  failed: function() { return { status: 0, data: null, contentType: "" } }
}

// One XHR. With no token it sends none: login refuses a request that
// carries a valid one.
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

function graphql(config, payload, back) {
  open(config.url + "/api/graphql", payload, false, "", function(xhr) { back(Model.reply(xhr.status, xhr.responseText)) })
}

// Calls back(null) once this process holds an access token other than
// stale, or back(reply) with the failed login's reply. A refresh comes
// first when there is a refresh token; a login follows when it fails.
function renew(config, stale, back) {
  var key = keyOf(config)
  if (session.key !== key) session = { key: key, access: "", refresh: "", waiting: null }
  if (session.access && session.access !== stale) return back(null)
  if (session.waiting) return session.waiting.push(back)
  var s = session
  s.waiting = [back]
  var finish = function(failure) {
    var waiting = s.waiting
    s.waiting = null
    waiting.forEach(function(w) { w(failure) })
  }
  var login = function() {
    graphql(config, loginPayload(config), function(reply) {
      var t = reply.state === "ok" && reply.data.login
      if (t && t.accessToken) {
        s.access = t.accessToken
        s.refresh = t.refreshToken
        return finish(null)
      }
      s.access = ""
      s.refresh = ""
      finish(reply.message === "Incorrect username or password." ? { state: "unauthorized", message: "", data: null } : reply)
    })
  }
  if (!s.refresh) return login()
  graphql(config, refreshPayload(s.refresh), function(reply) {
    var t = reply.state === "ok" && reply.data.refreshToken
    if (!t || !t.accessToken) return login()
    s.access = t.accessToken
    finish(null)
  })
}

// Sends one request of a kind, done gets one answer. Returns { abort },
// which answers done at once as a request with no answer (status 0).
function call(config, url, payload, kind, done) {
  var c = { xhr: null, over: false }
  var finish = function(result) {
    if (c.over) return
    c.over = true
    done(result)
  }
  var attempt = function(retried) {
    if (c.over) return
    var token = session.key === keyOf(config) ? session.access : ""
    if (!token) return renew(config, "", function(failure) { failure ? finish(kind.failed(failure)) : attempt(retried) })
    c.xhr = open(url, payload, kind.binary, token, function(xhr) {
      c.xhr = null
      var result = kind.read(xhr)
      if (retried || !kind.refused(result)) return finish(result)
      renew(config, token, function(failure) { failure ? finish(kind.failed(failure)) : attempt(true) })
    })
  }
  attempt(false)
  return {
    abort: function() {
      if (c.xhr) c.xhr.abort()
      finish(kind.failed(Model.reply(0, "")))
    }
  }
}

// payload: { query, variables? }; done(reply), reply as Model.reply gives.
function send(config, payload, done) {
  return call(config, config.url + "/api/graphql", payload, GRAPHQL, done)
}

// A server image's bytes: done({ status, data, contentType }).
function image(config, url, done) {
  return call(config, url, null, IMAGE, done)
}

if (typeof module !== "undefined") {
  module.exports = {
    loginPayload: loginPayload,
    refreshPayload: refreshPayload,
    send: send,
    image: image
  }
}
