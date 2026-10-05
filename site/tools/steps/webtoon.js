(function() {
  function strip() { return reader.children.filter(function(c) { return c.cacheBuffer !== undefined && c.contentY !== undefined })[0] }
  return [
    [500, function() {
      var bg = Qt.createQmlObject('import QtQuick; Rectangle { anchors.fill: parent; z: -1000 }', keyRoot)
      bg.color = theme.background
    }],
    [15000, function() {
      var m = root.shown.manga.find(function(m) { return m.title === "Eleceed" })
      log("eleceed", m ? m.id : null)
      mangaDetail.openManga(m.id, false)
    }],
    [6000, function() { key(" ") }],
    [12000, function() { strip().contentY = 9000 }],
    [500, function() { wheel(strip(), -120) }],
    [9000, function() { log("p1", [strip().contentY, reader.reader.page]); strip().contentY = 16000 }],
    [500, function() { wheel(strip(), -120) }],
    [9000, function() { log("p2", [strip().contentY, reader.reader.page]); strip().contentY = 26000 }],
    [500, function() { wheel(strip(), -120) }],
    [9000, function() { log("p3", [strip().contentY, reader.reader.page]); strip().contentY = 40000 }],
    [500, function() { wheel(strip(), -120) }],
    [9000, function() { log("p4", [strip().contentY, reader.reader.page]); grab("w-40000") }],
    [800, function() { root.run("window.quit") }]
  ]
})()
