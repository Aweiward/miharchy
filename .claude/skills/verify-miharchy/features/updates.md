# Updates

The Updates view (key `2`): unread chapters fetched after the manga joined the library and uploaded in the last 3 months (Mihon's rule), and the library update check.

## Sub-features
- List grouped by fetch day; `Enter` opens the chapter in the reader.
- `u` starts a library update; progress polls `libraryUpdateStatus`; the header names skip reasons from the Settings filters. It skips manga in a category excluded from updates (see `library.md`).
- The bar mark counts the same list (`Updates.rows`).
- Actions (Mihon's `UpdatesScreen` bottom bar): `Space` selects or deselects the update under the cursor, `A` selects all, `I` inverts, `Esc` clears the selection (with none, it quits). `R` read, `U` unread (not `u`: it checks here), `b` bookmark toggle, `d` download, `x` delete downloads; `x` asks first and the second `x` deletes (Mihon's `UpdatesDeleteConfirmationDialog`), any other key keeps them. Each acts on the selection, or on the cursor's update when nothing is selected, then ends the selection, as Mihon does.
- The list holds only unread updates (showing read ones is #114), so `R` takes rows out of the list and the mark's count, and `U` changes only an update with a page read (back to page 1).
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
Read back: compare the row count with `node -e` over `window/Updates.js` `updates(data, Date.now())` applied to `UPDATES_QUERY`'s reply.

## Gotchas
- Chapters fetched when a manga joins the library are backlog, not updates; to create updates, add a manga to the library before fetching its chapters, or remove chapter rows (see past PRs). Recipe: take MangaDex `fetchSourceManga(type: LATEST)` (recent uploads pass the 3-month rule), `updateManga(patch: {inLibrary: true})` each, wait 2 s, then `fetchMangaAndChapters` each. Three manga gave 29 updates.
- To prove the mark's count after an action, run `UPDATES_QUERY` through `gql.sh` and pass the reply to `Updates.count` in node (`window/tests/load.js` loads it); it must equal `updatesView.rows.length` in the drive log.
- Server filters (`excludeUnreadChapters`, `excludeNotStarted`, `excludeCompleted`) default on and skip most manga on a fresh server.
