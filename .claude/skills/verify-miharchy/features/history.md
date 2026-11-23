# History

The History view (key `3`): one entry per manga, its last opened chapter, newest first, grouped by day (`History.js`).

## Sub-features
- `Enter` resumes the entry's chapter in the reader; `r` reloads.
- `x x` hides one entry (manga meta `miharchy.historyHiddenAt`), `X X` hides all (global meta `miharchy.historyClearedAt`). Read state stays: the hide writes only those metas, and core's `history.list` still lists the chapters. Up next reads the same cutoffs (`peek.md`): a hidden manga counts as not started.
- `c` opens the reading card (`reading-card.md`).
- `/` searches: the field filters by manga title as it types, ignoring case (Mihon's `HistoryScreen` search). `Enter` keeps the search and closes the field, `Esc` in the field clears it. Outside the field `Esc` clears a kept search, and with none it quits. The search does not persist. `X X` still clears the whole history, not only what the search shows.

## How to get to it (user POV)
Press `3`.

## Driving it with drive.sh
History needs opened chapters: `core.sh api chapter.update '{"ids":[<id>],"lastPageRead":2}'` stamps `lastReadAt` on one chapter of each of a few library manga. Read them back with `core.sh api history.list '{}' | jq -c '[.chapters[] | [.manga.title, .id, .lastReadAt]]'`. After `x x`, `core.sh api meta.get '{"scope":"manga","keys":["miharchy.historyHiddenAt"]}'` holds the hidden manga; after `X X`, `meta.get '{"scope":"global","keys":["miharchy.historyClearedAt"]}'` holds the cutoff.

The driver cannot type; set `historyView.searchField.text` after `/`, then send `Enter` or `Esc`:
```js
[
  [3000, function() { key("3") }],
  [4000, function() { log("all", historyView.entries.length); key("/") }],
  [500, function() { historyView.searchField.text = "cat" }],
  [500, function() { log("cat", historyView.entries.map(function(e) { return e.title })); key("Enter") }],
  [500, function() { log("kept", [historyView.query, historyView.editing]); key("Esc") }],
  [500, function() { log("cleared", historyView.query); done() }]
]
```
