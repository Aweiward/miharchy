import QtQuick
import "Model.js" as Model
import "Prefs.js" as Prefs

// One view's choices (a Prefs.js table) as the server keeps them, global or
// for one manga. A choice shows at once and saves in the background, one
// save at a time; a choice not yet saved wins over a load.
QtObject {
  id: store

  property var config: null
  property var table: []
  // -1 for global meta, else that manga's meta over the global defaults.
  property int mangaId: -1
  property var values: Prefs.defaults(table)
  // Saves waiting, as Prefs.enqueue() keeps them, and the one in flight.
  property var queue: []
  property var sending: null
  // Only the latest load may set values.
  property int loadSeq: 0

  readonly property var target: mangaId < 0 ? undefined : mangaId

  signal failed(var reply)

  onConfigChanged: pump()

  function send(payload, done) {
    var req = Model.request(config, payload)
    var xhr = new XMLHttpRequest()
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== XMLHttpRequest.DONE) return
      var reply = Model.reply(xhr.status, xhr.responseText)
      if (reply.state !== "ok") store.failed(reply)
      done(reply)
    }
    xhr.open("POST", req.url)
    xhr.setRequestHeader("Content-Type", "application/json")
    xhr.setRequestHeader("Authorization", req.authorization)
    xhr.send(req.body)
  }

  // Switches to a manga's choices, or the global ones with -1.
  function open(id) {
    mangaId = id
    values = Prefs.defaults(table)
    load()
  }

  function load() {
    if (!config) return
    var seq = ++loadSeq
    var scope = Prefs.scope(target)
    send(Prefs.loadPayload(table, target), function(reply) {
      if (seq !== store.loadSeq || reply.state !== "ok") return
      var waiting = store.queue.concat(store.sending ? [store.sending] : []).some(function(e) { return e.scope === scope })
      if (!waiting) store.values = Prefs.read(store.table, reply.data, Prefs.defaults(store.table))
    })
  }

  // changes: [{ key, value }].
  function set(changes) {
    var next = {}
    for (var k in values) next[k] = values[k]
    changes.forEach(function(c) {
      next[c.key] = c.value
      store.save(Prefs.scope(store.target), c.key, Prefs.savePayload(c.key, c.value, store.target))
    })
    values = next
    pump()
  }

  // The current choices become the global default; with mangaIds, those
  // manga drop their own choices to follow it.
  function saveDefault(mangaIds) {
    table.forEach(function(c) { store.save("global", c.key, Prefs.savePayload(c.key, store.values[c.key])) })
    var reset = Prefs.resetPayload(table, mangaIds || [])
    if (reset) save("global", "reset", reset)
    pump()
  }

  function save(scope, key, payload) {
    queue = Prefs.enqueue(queue, { scope: scope, key: key, payload: payload })
  }

  function pump() {
    if (sending || !queue.length || !config) return
    sending = queue[0]
    queue = queue.slice(1)
    send(sending.payload, function() {
      store.sending = null
      store.pump()
    })
  }
}
