# Updates

The Updates view (key `2`): chapters fetched after the manga joined the library and uploaded in the last 3 months (Mihon's rule), through the user's filters, and the library update check.

## Sub-features
- List grouped by fetch day; `Enter` opens the chapter in the reader. A read update shows dimmed.
- Downloaded only (see `library.md`) forces the Downloaded filter on (`Prefs.force`), over the stored choice, as in Mihon.
- `F` opens the filters (Mihon's `UpdatesFilterDialog`, `Updates.PREFS` in global meta `miharchy.updates*`): Unread, Downloaded, Started, Bookmarked (each off, `[+]` include, `[-]` exclude), Hide excluded scanlators (each manga's `miharchy.excludedScanlators`), and with categories, Default (no category) and each category, off, include or exclude. Unread starts on include, so the list starts as the mark's; Mihon starts with every filter off. `j`/`k` move, `Enter`/`Space` change, `Esc`/`F` close; a click moves the cursor, a double click changes the row.
- `u` starts a library update; progress comes live through core's `updates` topic while the view shows (see the SKILL's live updates section); the header names skip reasons from the Settings filters. It skips manga in a category excluded from updates (see `library.md`).
- `C` stops a running update (`update.stop`, Mihon's cancel on the update notification); the hint shows `C stop` in place of `u check` while one runs. The progress line says `Stopped checking for new chapters at 6 / 23` until the next run starts; `update.status` then reads `stopped` true. To have time to stop one, turn the Settings skip filters off and have 20+ manga in the library (`source.popular` page 1, `manga.update` with `inLibrary` on 20 ids). Not yet timed on core.
- The bar mark counts unread updates only (`Mark.load`, `Updates.count`), whatever the view's filters.
- Actions (Mihon's `UpdatesScreen` bottom bar): `Space` selects or deselects the update under the cursor, `A` selects all, `I` inverts, `Esc` clears the selection (with none, it quits). `R` read, `U` unread (not `u`: it checks here), `b` bookmark toggle, `d` download, `x` delete downloads; `x` asks first and the second `x` deletes (Mihon's `UpdatesDeleteConfirmationDialog`), any other key keeps them. Each acts on the selection, or on the cursor's update when nothing is selected, then ends the selection, as Mihon does.
- With the default Unread filter, `R` takes rows out of the list and the mark's count, and `U` changes only an update with a page read (back to page 1).
- A row shows `★` for a bookmark and the download marker (`queued`, `42%`, `downloaded`) from the queue, as the manga detail does.

## How to get to it (user POV)
Press `2`.

## Driving it with drive.sh
```js
[
  [3000, function() { key("2") }],
  [4000, function() { log("rows", updatesView.updates ? updatesView.updates.rows.length : null); grab("updates"); key("u") }],
  [30000, function() { log("after-check", updatesView.updates.rows.length); grab("updates-after"); done() }]
]
```
Read back: count the unread updates with the window's own load, run from node against the scratch core (one command, from the worktree root):
```sh
node -e 'const U=require("./window/tests/load.js")("Updates.js"),x=require("child_process").execFileSync;U.load((p,cb)=>cb({state:"ok",data:JSON.parse(x(".claude/skills/verify-miharchy/scripts/core.sh",["api",p.route,JSON.stringify(p.body||{})]))}),Date.now(),r=>console.log("updates",U.count(r.data,Date.now())))'
```
It prints `updates <n>`, the mark's count; with the default Unread filter it equals `updatesView.rows.length` in the drive log. For the mark's own load, load `plugin/Mark.js` the same way (`require("./window/tests/load.js")("../plugin/Mark.js")`) and print `U.count` of its reply's data.

The actions, after the seed recipe in Gotchas. Give the 20th row's chapter a page read first (`core.sh api chapter.update '{"ids":[<id>],"lastPageRead":3}'`, as in `manga.md`) so `U` has a reset to do. Rows 0-4 are one manga, 5-18 another, 19 on a third:
```js
(function() {
  function rows() { return updatesView.rows.map(function(r) { return [r.id, r.mangaId, r.lastPage, r.bookmarked, r.downloaded] }) }
  function times(k, n) { for (var i = 0; i < n; i++) key(k) }
  return [
    [3000, function() { key("2") }],
    [5000, function() { log("list", rows()); key(" "); key("j"); key("j"); key(" ") }],
    [800, function() { log("selected", updatesView.selected); key("I") }],
    [500, function() { log("inverted", updatesView.selected.length); key("A") }],
    [500, function() { log("all", updatesView.selected.length); key("Esc") }],
    [500, function() { log("after-esc", [updatesView.selected.length, root.view]); key(" "); times("j", 3); key(" "); key("b") }],
    [4000, function() { log("after-b", rows().filter(function(r) { return r[3] })); key("d") }],
    [25000, function() { log("after-d", rows()[updatesView.cursor]); key("x") }],
    [500, function() { log("armed", updatesView.armed); key("j") }],
    [500, function() { log("disarmed", updatesView.armed); key("k"); key("x"); key("x") }],
    [4000, function() { log("after-xx", rows()[updatesView.cursor]); times("j", 14); key("U") }],
    [4000, function() { log("after-U", rows()[updatesView.cursor]); key(" "); key("k"); key(" "); key("R") }],
    [5000, function() { log("after-R", updatesView.rows.length); grab("after-read") }],
    [1500, function() { done() }]
  ]
})()
```
Read back: `.claude/skills/verify-miharchy/scripts/core.sh api chapter.list '{"ids":[...]}' | jq -c '[.chapters[] | [.id, .isRead, .isBookmarked, .isDownloaded, .lastPageRead]]'`, and the mark's count as above.

## Gotchas
- Chapters fetched when a manga joins the library are backlog, not updates. To create updates, add a manga to the library before fetching its chapters: the core seed in SKILL.md does it (`manga.update` with `inLibrary`, wait 2 s, `manga.refresh`). A fetch in the same second as the add makes no rows. Only chapters uploaded in the last 3 months count, so pick manga with recent uploads (`source.latest` lists them). The row count depends on the manga: Berserk of Gluttony gave 4 on 2026-11-22.
- The skip filters (`excludeUnreadChapters`, `excludeNotStarted`, `excludeCompleted`) default on and skip most manga on a fresh core; turn them off with `settings.set` (SKILL.md, Live updates).
- `updateMangas` (Settings "Refresh metadata during library updates", default off): off, a library update fetches chapters only (`needsDetails` false), except for a manga that is not initialized or has no cover; a manual `manga.refresh` always fetches the details.
