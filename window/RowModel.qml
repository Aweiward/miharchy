import QtQuick
import "Model.js" as Model

// A view's rows as a ListModel that follows `items` in place
// (Model.listChanges): a new array as the model rebuilds every cell, and
// Qt may decode each cover again, blank for a moment (#219). Each row holds
// its item in one role, so a delegate still reads it as modelData.
ListModel {
  id: rows

  property var items: []
  // The item's key, as Model.listChanges takes it; null for its id.
  property var key: null
  // The items the rows hold now.
  property var shown: []

  onItemsChanged: {
    var c = Model.listChanges(shown, items, key)
    if (c.reset) {
      rows.clear()
      rows.append(items.map(function(x) { return { item: x } }))
    } else c.ops.forEach(function(op) {
      if (op[0] === "remove") rows.remove(op[1], op[2])
      else if (op[0] === "insert") rows.insert(op[1], op[2].map(function(x) { return { item: x } }))
      else if (op[0] === "move") rows.move(op[1], op[2], 1)
      else rows.set(op[1], { item: op[2] })
    })
    shown = items
  }
}
