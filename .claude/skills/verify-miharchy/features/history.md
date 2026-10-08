# History

The History view (key `3`): one entry per manga, its last opened chapter, newest first, grouped by day (`History.js`).

## Sub-features
- `Enter` resumes the entry's chapter in the reader; `r` reloads.
- `x x` hides one entry (manga meta `miharchy.historyHiddenAt`), `X X` hides all (global meta `miharchy.historyClearedAt`). Read state stays: Suwayomi cannot delete history. Peek reads the same History (`peek.md`): a hidden entry is never a peek target.
- `/` searches: the field filters by manga title as it types, ignoring case (Mihon's `HistoryScreen` search). `Enter` keeps the search and closes the field, `Esc` in the field clears it. Outside the field `Esc` clears a kept search, and with none it quits. The search does not persist. `X X` still clears the whole history, not only what the search shows.

## How to get to it (user POV)
Press `3`.

## Driving it with drive.sh
History needs opened chapters: `updateChapter(input: {id, patch: {lastPageRead: 2}})` stamps `lastReadAt` on one chapter of each of a few library manga.

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
