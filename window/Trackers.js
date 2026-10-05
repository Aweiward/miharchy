.pragma library

// Trackers: the user's tracker logins (Settings) and a manga's tracks (the
// tracking panel on its detail). Pure, so tests/trackers.test.js pins it;
// SettingsView.qml and TrackPanel.qml send the payloads built here.
//
// Suwayomi keeps every tracker token; Miharchy stores no credential. Every
// read of a logged-out tracker builds a fresh authUrl, and MyAnimeList's
// carries a new PKCE verifier that replaces the last one. So the login asks
// for its link at Enter and nothing reads the trackers again until the
// login ends.

var TRACKER_FIELDS = "id name isLoggedIn authUrl"
var LIST_QUERY = "{ trackers { nodes { " + TRACKER_FIELDS + " } } }"
var LINK_QUERY = "query($id: Int!) { tracker(id: $id) { " + TRACKER_FIELDS + " } }"
var OAUTH_MUTATION = "mutation($id: Int!, $url: String!) { loginTrackerOAuth(input: { trackerId: $id, callbackUrl: $url }) { isLoggedIn tracker { " + TRACKER_FIELDS + " } } }"
var CREDENTIALS_MUTATION = "mutation($id: Int!, $username: String!, $password: String!) {"
  + " loginTrackerCredentials(input: { trackerId: $id, username: $username, password: $password }) { isLoggedIn tracker { " + TRACKER_FIELDS + " } } }"
var LOGOUT_MUTATION = "mutation($id: Int!) { logoutTracker(input: { trackerId: $id }) { isLoggedIn tracker { " + TRACKER_FIELDS + " } } }"

var RECORD_FIELDS = "id trackerId remoteId title status displayScore lastChapterRead totalChapters remoteUrl"
var PANEL_QUERY = "query($id: Int!) { trackers { nodes { id name isLoggedIn scores statuses { value name } } }"
  + " manga(id: $id) { trackRecords { nodes { " + RECORD_FIELDS + " } } } }"
var SEARCH_QUERY = "query($id: Int!, $query: String!) { searchTracker(input: { trackerId: $id, query: $query }) {"
  + " trackSearches { remoteId title publishingType startDate totalChapters } } }"
var BIND_MUTATION = "mutation($mangaId: Int!, $trackerId: Int!, $remoteId: LongString!) {"
  + " bindTrack(input: { mangaId: $mangaId, trackerId: $trackerId, remoteId: $remoteId }) { trackRecord { " + RECORD_FIELDS + " } } }"
var UPDATE_MUTATION = "mutation($input: UpdateTrackInput!) { updateTrack(input: $input) { trackRecord { " + RECORD_FIELDS + " } } }"
// Only Miharchy's record goes; the entry stays on the tracker's list.
var UNBIND_MUTATION = "mutation($id: Int!) { unbindTrack(input: { recordId: $id }) { trackRecord { id } } }"

function copy(o, changes) {
  var c = {}
  for (var k in o) c[k] = o[k]
  for (var j in changes) c[j] = changes[j]
  return c
}

// --- Settings: logins ---

// state: "loading" | "ok" | a failed connection state. login: the login
// or logout under way, or null. error: the last one's failure.
function initial() {
  return { state: "loading", message: "", list: [], login: null, error: "" }
}

function toTracker(n) {
  return { id: n.id, name: String(n.name), loggedIn: n.isLoggedIn === true, authUrl: n.authUrl ? String(n.authUrl) : "" }
}

function listPayload() {
  return { query: LIST_QUERY }
}

function withTracker(s, tracker) {
  return s.list.map(function(t) { return t.id === tracker.id ? tracker : t })
}

// The callback key the provider puts in the address it ends on: AniList
// answers an implicit grant with #access_token=, the others with ?code=.
function callbackKey(authUrl) {
  return /[?&]response_type=token\b/.test(authUrl) ? "access_token" : "code"
}

// The pasted address -> "" when it carries the key the server reads, else
// what to tell the user.
function callbackError(text, authUrl) {
  var key = callbackKey(authUrl)
  if (new RegExp("[?#&]" + key + "=[^&\\s]+").test(String(text))) return ""
  return "That address has no " + key + "=. Copy the whole address the browser shows after you allow access."
}

// Enter on tracker row i: a logged-in tracker logs out, a logged-out one
// starts its login. An OAuth tracker has an authUrl; the others take a
// username and password.
function begin(s, i) {
  var t = s.list[i]
  if (!t || s.login) return s
  var oauth = t.authUrl !== ""
  return copy(s, { error: "", login: {
    trackerId: t.id, name: t.name, oauth: oauth, logout: t.loggedIn,
    step: t.loggedIn ? "logout" : oauth ? "link" : "username",
    url: "", callback: "", username: "", password: "", error: ""
  } })
}

// The request the login step is due to send, or null.
function loginPayload(s) {
  var l = s.login
  if (!l) return null
  if (l.step === "link") return { query: LINK_QUERY, variables: { id: l.trackerId } }
  if (l.step === "logout") return { query: LOGOUT_MUTATION, variables: { id: l.trackerId } }
  if (l.step !== "send") return null
  if (l.oauth) return { query: OAUTH_MUTATION, variables: { id: l.trackerId, url: l.callback } }
  return { query: CREDENTIALS_MUTATION, variables: { id: l.trackerId, username: l.username, password: l.password } }
}

// Whether the login shows its text field.
function editing(s) {
  return s.login !== null && ["paste", "username", "password"].indexOf(s.login.step) !== -1
}

function retry(l, error) {
  return copy(l, l.oauth ? { step: "paste", error: error } : { step: "password", password: "", error: error })
}

// event.type:
//   "request"  the list went out          "list"   { reply } for it
//   "sent"     loginPayload() went out    "link"   { reply } for the link
//   "commit"   { text } from the field    "cancel" Esc in the field
//   "reply"    { reply } for a login or logout mutation
function reduce(s, event) {
  var l = s.login
  switch (event.type) {
    case "request":
      return copy(s, { state: "loading", message: "" })
    case "list":
      if (event.reply.state !== "ok") return copy(s, { state: event.reply.state, message: event.reply.message })
      return copy(s, { state: "ok", message: "", list: ((event.reply.data.trackers && event.reply.data.trackers.nodes) || []).map(toTracker) })
    case "sent":
      if (!l) return s
      return copy(s, { login: copy(l, { step: l.step === "link" ? "linking" : "sending" }) })
    case "link":
      if (!l) return s
      if (event.reply.state !== "ok") return copy(s, { login: null, error: "Could not get the " + l.name + " login link: " + (event.reply.message || event.reply.state) })
      var t = toTracker(event.reply.data.tracker)
      if (t.loggedIn || !t.authUrl) return copy(s, { login: null, list: withTracker(s, t) })
      return copy(s, { login: copy(l, { step: "paste", url: t.authUrl }) })
    case "commit":
      if (!l) return s
      var text = String(event.text).trim()
      if (l.step === "paste") {
        var bad = callbackError(text, l.url)
        return copy(s, { login: copy(l, bad ? { error: bad } : { step: "send", callback: text, error: "" }) })
      }
      if (l.step === "username") return copy(s, { login: copy(l, text ? { step: "password", username: text, error: "" } : { error: "Enter your " + l.name + " username." }) })
      if (l.step === "password") return copy(s, { login: copy(l, event.text ? { step: "send", password: String(event.text), error: "" } : { error: "Enter your " + l.name + " password." }) })
      return s
    case "cancel":
      return copy(s, { login: null, error: "" })
    case "reply":
      if (!l) return s
      if (event.reply.state !== "ok") {
        var why = event.reply.message || event.reply.state
        if (l.logout) return copy(s, { login: null, error: "Could not log out of " + l.name + ": " + why })
        return copy(s, { login: retry(l, l.name + " did not accept the login: " + why + (l.oauth ? ". Press Esc, then Enter for a fresh link." : "")) })
      }
      var d = event.reply.data
      var p = d.loginTrackerOAuth || d.loginTrackerCredentials || d.logoutTracker
      var next = copy(s, { list: withTracker(s, toTracker(p.tracker)) })
      if (!l.logout && !p.isLoggedIn) return copy(next, { login: retry(l, l.name + " did not accept the login.") })
      return copy(next, { login: null, error: "" })
  }
  return s
}

// What tracker row i shows right of its name, while its field is closed.
function status(s, i) {
  var t = s.list[i]
  var l = s.login && s.login.trackerId === t.id ? s.login : null
  if (l && (l.step === "link" || l.step === "linking")) return "opening the browser"
  if (l && l.step === "logout") return "logging out"
  if (l && (l.step === "send" || l.step === "sending")) return t.loggedIn ? "logging out" : "logging in"
  return t.loggedIn ? "logged in" : "not logged in"
}

// The field's label: what to type.
function prompt(login) {
  return { paste: "address", username: "username", password: "password" }[login.step] || ""
}

// The line under the trackers: how to finish the login, or what failed.
function note(s) {
  var l = s.login
  if (!l) return s.error
  if (l.error) return l.error
  if (l.step === "paste") return "Allow access in the browser. It ends on a suwayomi.org page: copy that page's whole address and paste it here. No browser? Open " + l.url
  if (l.step === "username") return "The server sends your " + l.name + " login once and keeps only its token."
  return ""
}

// --- Manga detail: the tracking panel ---

// panel.state: "loading" | "ok" | a failed connection state.
// rows: { tracker, record } for each tracker that is logged in or holds a
// track of this manga. mode: "list" | "query" (the search field) |
// "searching" | "pick" (a list in pick) | "progress" (the chapters field).
// pick: { kind: "results" | "status" | "score", items: [{ label, detail,
// value }], cursor }. busy: a write is in flight.
function panel(mangaId, title) {
  return { mangaId: mangaId, title: String(title || ""), state: "loading", message: "", rows: [], cursor: 0, mode: "list", pick: null, busy: false, error: "" }
}

function panelPayload(p) {
  return { query: PANEL_QUERY, variables: { id: p.mangaId } }
}

function toRecord(n) {
  return {
    id: n.id,
    trackerId: n.trackerId,
    remoteId: String(n.remoteId),
    title: String(n.title || ""),
    status: n.status,
    score: String(n.displayScore || ""),
    read: Number(n.lastChapterRead) || 0,
    total: n.totalChapters || 0,
    url: String(n.remoteUrl || "")
  }
}

function toRows(data) {
  var records = {}
  ;((data.manga && data.manga.trackRecords && data.manga.trackRecords.nodes) || []).forEach(function(n) { records[n.trackerId] = toRecord(n) })
  return ((data.trackers && data.trackers.nodes) || []).filter(function(t) {
    return t.isLoggedIn === true || records[t.id]
  }).map(function(t) {
    return {
      tracker: { id: t.id, name: String(t.name), loggedIn: t.isLoggedIn === true, statuses: t.statuses || [], scores: t.scores || [] },
      record: records[t.id] || null
    }
  })
}

function number(n) {
  return String(Math.round(n * 100) / 100)
}

function statusName(tracker, value) {
  for (var i = 0; i < tracker.statuses.length; i++) if (tracker.statuses[i].value === value) return tracker.statuses[i].name
  return ""
}

// What a row shows right of the tracker's name.
function summary(row) {
  if (!row.tracker.loggedIn) return "log in under Settings to change it"
  var r = row.record
  if (!r) return "not tracked"
  var parts = [statusName(row.tracker, r.status), number(r.read) + " / " + (r.total || "?") + " chapters"]
  if (r.score && r.score !== "0" && r.score !== "-") parts.push("score " + r.score)
  return parts.filter(function(x) { return x }).join("   ")
}

function current(p) {
  return p.rows[p.cursor] || null
}

function index(items, value) {
  for (var i = 0; i < items.length; i++) if (items[i].value === value) return i
  return 0
}

function fail(p, reply) {
  return copy(p, { busy: false, error: reply.message || reply.state })
}

function write(p, payload) {
  return { panel: copy(p, { mode: "list", pick: null, busy: true, error: "" }), payload: payload }
}

function update(record, changes) {
  return { query: UPDATE_MUTATION, variables: { input: copy({ recordId: record.id }, changes) } }
}

function stay(p) {
  return { panel: p, payload: null }
}

// Every key and reply goes through here: -> { panel, payload } with payload
// the request to send, or null. event.type:
//   "loaded" { reply }      "move" { delta }    "back"
//   "search"  Enter on a row: the search field, holding the manga's title
//   "query" { text }        the search field committed
//   "results" { reply }     "choose"  Enter in a pick list
//   "status" | "score"      the pick list of the tracker's own values
//   "chapters"              the chapters read field
//   "progress" { text }     that field committed
//   "unbind"                "written" { trackerId, reply } for a write
function act(p, event) {
  var row = current(p)
  switch (event.type) {
    case "loaded":
      if (event.reply.state !== "ok") return stay(copy(p, { state: event.reply.state, message: event.reply.message }))
      var rows = toRows(event.reply.data)
      return stay(copy(p, { state: "ok", message: "", rows: rows, cursor: Math.max(0, Math.min(rows.length - 1, p.cursor)) }))
    case "move":
      if (p.mode === "pick") return stay(copy(p, { pick: copy(p.pick, { cursor: Math.max(0, Math.min(p.pick.items.length - 1, p.pick.cursor + event.delta)) }) }))
      return stay(copy(p, { cursor: Math.max(0, Math.min(p.rows.length - 1, p.cursor + event.delta)) }))
    case "back":
      return stay(copy(p, { mode: "list", pick: null }))
    case "written":
      if (event.reply.state !== "ok") return stay(fail(p, event.reply))
      var d = event.reply.data
      var w = (d.bindTrack || d.updateTrack || {}).trackRecord
      var record = d.unbindTrack ? null : w ? toRecord(w) : undefined
      return stay(copy(p, {
        busy: false,
        rows: p.rows.map(function(x) { return x.tracker.id === event.trackerId && record !== undefined ? copy(x, { record: record }) : x })
      }))
  }
  if (p.busy || !row) return stay(p)
  if (!row.tracker.loggedIn) return stay(copy(p, { error: "Log in to " + row.tracker.name + " under Settings first." }))
  var r = row.record
  switch (event.type) {
    case "search":
      return stay(copy(p, { mode: "query", error: "" }))
    case "query":
      var q = String(event.text).trim()
      if (!q) return stay(copy(p, { error: "Enter a title to search for." }))
      return { panel: copy(p, { mode: "searching", error: "" }), payload: { query: SEARCH_QUERY, variables: { id: row.tracker.id, query: q } } }
    case "results":
      if (p.mode !== "searching") return stay(p)
      if (event.reply.state !== "ok") return stay(copy(fail(p, event.reply), { mode: "list" }))
      var found = (event.reply.data.searchTracker.trackSearches || []).map(function(m) {
        var year = /^\d{4}/.exec(String(m.startDate || ""))
        return { label: String(m.title), detail: [m.publishingType, year ? year[0] : "", m.totalChapters ? m.totalChapters + " chapters" : ""].filter(function(x) { return x }).join("   "), value: String(m.remoteId) }
      })
      if (!found.length) return stay(copy(p, { mode: "list", error: "Nothing on " + row.tracker.name + " matches. Press Enter to search another title." }))
      return stay(copy(p, { mode: "pick", pick: { kind: "results", items: found, cursor: r ? index(found, r.remoteId) : 0 } }))
    case "status":
      if (!r) return stay(copy(p, { error: "Find the manga on " + row.tracker.name + " first: Enter." }))
      var statuses = row.tracker.statuses.map(function(st) { return { label: st.name, detail: "", value: st.value } })
      return stay(copy(p, { mode: "pick", error: "", pick: { kind: "status", items: statuses, cursor: index(statuses, r.status) } }))
    case "score":
      if (!r) return stay(copy(p, { error: "Find the manga on " + row.tracker.name + " first: Enter." }))
      var scores = row.tracker.scores.map(function(sc) { return { label: sc, detail: "", value: sc } })
      return stay(copy(p, { mode: "pick", error: "", pick: { kind: "score", items: scores, cursor: index(scores, r.score) } }))
    case "chapters":
      if (!r) return stay(copy(p, { error: "Find the manga on " + row.tracker.name + " first: Enter." }))
      return stay(copy(p, { mode: "progress", error: "" }))
    case "progress":
      var t = String(event.text).trim()
      var n = Number(t)
      if (!r || p.mode !== "progress") return stay(p)
      if (!/^\d+(\.\d+)?$/.test(t)) return stay(copy(p, { error: "Enter the number of the last chapter read, such as 12." }))
      return write(p, update(r, { lastChapterRead: n }))
    case "choose":
      if (p.mode !== "pick") return stay(p)
      var item = p.pick.items[p.pick.cursor]
      if (!item) return stay(p)
      if (p.pick.kind === "results") return write(p, { query: BIND_MUTATION, variables: { mangaId: p.mangaId, trackerId: row.tracker.id, remoteId: item.value } })
      if (p.pick.kind === "status") return write(p, update(r, { status: item.value }))
      return write(p, update(r, { scoreString: item.value }))
    case "unbind":
      if (!r) return stay(p)
      return write(p, { query: UNBIND_MUTATION, variables: { id: r.id } })
  }
  return stay(p)
}

// The text a panel field starts with.
function fieldStart(p) {
  var row = current(p)
  if (p.mode === "progress" && row && row.record) return number(row.record.read)
  return p.title
}

if (typeof module !== "undefined") {
  module.exports = {
    initial: initial,
    listPayload: listPayload,
    callbackError: callbackError,
    begin: begin,
    loginPayload: loginPayload,
    editing: editing,
    reduce: reduce,
    status: status,
    prompt: prompt,
    note: note,
    panel: panel,
    panelPayload: panelPayload,
    summary: summary,
    act: act,
    fieldStart: fieldStart
  }
}
