(function() {
  function rows() { return browseView.panelRows.map(function(r, i) { return r.mark + " " + r.label + " " + r.detail }) }
  function go(label) { for (var i = 0; i < 300 && browseView.panelRows[browseView.panel.cursor].label !== label; i++) key("j") }
  return [
    [500, function() {
      var bg = Qt.createQmlObject('import QtQuick; Rectangle { anchors.fill: parent; z: -1000 }', keyRoot)
      bg.color = theme.background
      key("4")
    }],
    [3000, function() { browseView.sourceCursor = browseView.sourceRows.findIndex(function(s) { return s.name.indexOf("MangaDex") === 0 }); key("Enter") }],
    [12000, function() { key("F") }],
    [6000, function() {
      go("Content rating"); key("Enter"); go("Suggestive"); key("Enter")
      go("Sort"); key("Enter"); go("Number of follows"); key("Enter")
      go("Format"); key("Enter")
      go("Award Winning"); key("Enter")
      go("Doujinshi"); key("Enter"); key("Enter")
      go("Fan Colored"); key("Enter"); key("Enter")
      go("Oneshot"); key("Enter"); key("Enter")
    }],
    [800, function() { log("panel", rows()); grab("b-panel"); key("a") }],
    [15000, function() { log("listing", [browseView.screen, browseView.listing.filters, browseView.listing.items.map(function(m) { return m.title })]); grab("g6-browse") }],
    [1000, function() { done() }]
  ]
})()
