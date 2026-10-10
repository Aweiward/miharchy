(function() {
  function state(l) { log(l, { view: root.view, open: readingCard.open, phase: readingCard.phase, card: readingCard.card, pending: readingCard.pending, note: readingCard.note }) }
  return [
    [500, function() {
      var bg = Qt.createQmlObject('import QtQuick; Rectangle { anchors.fill: parent; z: -1000 }', keyRoot)
      bg.color = theme.background
    }],
    [15000, function() { key("3") }],
    [5000, function() { grab("c1-history") }],
    [500, function() { key("c") }],
    [10000, function() { state("card"); grab("c2-card") }],
    [500, function() { key("S") }],
    [12000, function() { state("saved"); grab("c3-saved") }],
    [800, function() { root.run("window.quit") }]
  ]
})()
