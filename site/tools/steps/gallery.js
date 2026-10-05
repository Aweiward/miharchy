(function() {
  function state(l) { log(l, { view: root.view, detail: mangaDetail.open, reader: reader.open, mode: reader.open ? reader.reader.mode : null }) }
  function times(k, n) { for (var i = 0; i < n; i++) key(k) }
  function upd() { var u = updatesView.updates; return { running: u.running, checking: u.checking, finished: u.finished, total: u.total, skipped: u.skipped, checkedAt: u.checkedAt, rows: updatesView.rows.length } }
  var steps = [
    [500, function() {
      var bg = Qt.createQmlObject('import QtQuick; Rectangle { anchors.fill: parent; z: -1000 }', keyRoot)
      bg.color = theme.background
    }],
    [15000, function() { log("library", root.shown.manga.length); grab("g1-library") }],
    [500, function() {
      var i = root.shown.manga.findIndex(function(m) { return m.title === "Yotsuba&!" })
      times("j", Math.floor(i / 7)); times("l", i % 7)
    }],
    [500, function() { key("Enter") }],
    [7000, function() { state("detail"); grab("g2-manga") }],
    [500, function() { key(" ") }],
    [15000, function() { state("paged"); grab("g3-reader-paged") }],
    [500, function() { key("Esc") }],
    [1500, function() { key("Esc") }],
    [1500, function() { key("2") }],
    [6000, function() { log("before-u", upd()); grab("g5-updates-before"); key("u") }],
    [3000, function() { log("checking", upd()); grab("g5-updates-checking") }]
  ]
  for (var i = 0; i < 20; i++) steps.push([3000, function() { log("poll", upd()) }])
  steps.push([2000, function() { log("after-u", upd()); log("groups", updatesView.rows.map(function(r) { return r.day + " | " + (r.title || r.mangaTitle) })); grab("g5-updates") }])
  steps.push([1500, function() { root.run("window.quit") }])
  return steps
})()
