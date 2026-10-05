# Updates

The Updates view (key `2`): unread chapters fetched after the manga joined the library and uploaded in the last 3 months (Mihon's rule), and the library update check.

## Sub-features
- List grouped by fetch day; `Enter` opens the chapter in the reader.
- `u` starts a library update; progress polls `libraryUpdateStatus`; the header names skip reasons from the Settings filters. It skips manga in a category excluded from updates (see `library.md`).
- The bar mark counts the same list (`Updates.rows`).

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
- Chapters fetched when a manga joins the library are backlog, not updates; to create updates, add a manga to the library before fetching its chapters, or remove chapter rows (see past PRs).
- Server filters (`excludeUnreadChapters`, `excludeNotStarted`, `excludeCompleted`) default on and skip most manga on a fresh server.
