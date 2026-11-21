# miharchy-core's API, database and build

Status: accepted (2026-11-21). Decided in the #362 grill, for ADR 0009.

miharchy-core replaces about 50 Suwayomi GraphQL operations that `window/`, `plugin/Mark.js` and `sync/` use. This ADR fixes the shape of its API, its database, its build and the move from Suwayomi, so each slice of map #359 adds routes to one design.

## Process and build

- `core/` is one Gradle build with two modules. `core/host` is NanoYomi's extension host as a library. It keeps its own compiler settings (`JvmDefaultMode.ENABLE`, the extension-lib dependency versions), because extensions link only against that layout. Its stdio `Main.kt` stays as a test harness for `docs/spikes/nano-host-spike.py`. `core/server` is the application: Ktor (CIO engine) for HTTP and the WebSocket, and `sqlite-jdbc` with plain SQL and numbered migrations.
- Until the switch-over (#373), core runs beside Suwayomi: systemd user unit `miharchy-core`, `127.0.0.1:4591`, data folder `~/.local/share/miharchy/core` (mode 700). Whether the unit takes the name `miharchy-server` is decided in #373.
- Setup builds `core/` into `~/.local/share/miharchy/core-app` and shows "out of date" when `core/` changes, as it does for the sync helper. So the window always runs against the API it was written for.
- `core/server` uses `sync/`'s Mihon backup classes and `Merge.kt` through a Gradle composite build. `sync/` does not move or change, so the sync helper's fingerprint stays the same. The sync merge runs inside core and writes to its database. At #373, `sync/` moves into `core/` and the CLI goes away.

## API

- Every call is `POST /api/<name>` with a JSON body and a JSON reply, one route per operation. Images are `GET` routes. The calls are actions (fetch, enqueue, bind, sync), so RPC maps one to one onto today's operations, and each view's move is a swap of the call.
- Route names use `GLOSSARY.md` terms (`chapter.pages`, `download.enqueue`), not Suwayomi's names. Replies keep the field names and units the views already read, so the view modules change little, with one rule for lists: a GraphQL connection becomes a plain array (`categories: [1, 3]`, `chapters: [...]`), and its `totalCount` becomes a `<name>Count` field (`chapterCount`, `trackCount`). Units stay Suwayomi's: `uploadDate` in milliseconds, `lastReadAt`, `fetchedAt` and `inLibraryAt` in seconds; the database keeps Mihon's milliseconds.
- An error has a real HTTP status (4xx for a bad request, 5xx for a failed source) and the body `{ error: { kind, message } }`. `kind` is one of `unauthorized`, `notFound`, `invalid`, `cloudflare`, `webview`, `source`, `network`, `internal`. `internal` is a failure inside core itself, so a core bug never shows as a source failure. `Model.problem` switches on `kind`, not on message text.
- Every request sends `Authorization: Bearer <secret>`. Core creates `~/.config/miharchy/core.json` (mode 600, `{ url, secret }`) with a random secret on its first start and keeps it across restarts. There is no login, refresh or expiry. The secret keeps other users on the machine away from tracker tokens and source logins, because any local user can open a `127.0.0.1` port.
- Live updates use one WebSocket on `/api/live`. QML's WebSocket cannot send a header, so the first message is `{ secret }`. Then the client sends `{ subscribe: "downloads" }` or `{ subscribe: "updates" }`. Each subscription sends the full state first, then each change, as `{ topic, data }`, so a reconnect misses nothing. One socket carries every topic, so there are no subscription ids to clash. A socket whose first message is not the secret within 10 s closes with code 4401. `{ type: "ping" }` gets `{ type: "pong" }`, as `window/Live.js` sends today.

## Database

- The tables follow Mihon's current database (`data/src/main/sqldelight/tachiyomi/data/` on Mihon's `main`), with its table names, column names and meanings: `manga`, `chapter`, `category`, `manga_category`, `history`, `manga_track` (tracks), `extension_store` (repos, as `BackupExtensionStore`). Mihon renamed its older plural tables (`mangas`, `manga_sync`, `extension_repos`) to these. A `.tachibk` then maps almost field for field.
- Core adds `metas` (scope `global`, `manga` or `category`, an id, a key, a string value) with the keys Miharchy uses on Suwayomi today, such as `miharchy.syncFolder`, and `download_queue`.
- Source filters and settings keep the host's JSON (`type` plus `state`, sent back whole and applied by position), not Suwayomi's GraphQL kinds (`__typename`, per-change inputs). `window/Widgets.js` changes to read it when Browse moves (#378); translating in core would rebuild Suwayomi's schema for one view.
- Covers and pages are `GET /api/cover/<manga>` and `GET /api/page/<chapter>/<index>`, with the same Bearer secret. Core fetches them through the source's client and sets the content type from the bytes. Covers are cached in `covers/`; page lists are kept in memory and fetched again on a miss.
- State Mihon keeps outside its tables gets a column on the Mihon table it belongs to: `category.include_in_update` and `include_in_download` (Suwayomi's UNSET, INCLUDE, EXCLUDE) and `chapter.page_count`. Mihon's `flags` keep Mihon's meaning. Categories use `AUTOINCREMENT`, because metas and settings hold category ids.
- Source settings and cookies stay in the host's files (`prefs/*.properties`, `cookies.txt`) in core's data folder, because extensions write them through Android's `SharedPreferences`.
- Downloaded chapters use Mihon's layout, `downloads/<source>/<manga>/<chapter>.cbz`, under a "Downloads folder" setting. Covers are cached in the data folder.

## Moving the views

- The developer switch `MIHARCHY_BACKEND=core` makes a view talk to core. Users stay fully on Suwayomi until #373 makes core the default for everyone at once. A single view cannot move for users alone: the library has one source of truth, so a manga added through core would be missing from a view still on Suwayomi.
- The views move in this order, each after the data it shows exists in core: Extensions; Browse and the reader; Library and categories; History; Downloads; Updates; Trackers; Sync and Backup; Settings and Setup; the bar mark (`plugin/Mark.js`) last, because new plugin code runs only after `omarchy-restart-shell`.

## Routes

The first routes of each slice. A slice may add routes; it keeps these names.

| Slice | Routes |
|---|---|
| #363 service | `health`; the `/api/live` socket |
| #364 extensions | `extensionRepo.list`, `extensionRepo.add`, `extensionRepo.remove`, `extension.list`, `extension.install`, `extension.update`, `extension.updateAll`, `extension.remove` |
| #365 browse | `source.list`, `source.popular`, `source.latest`, `source.search`, `source.filters`, `source.settings`, `source.setSetting`, `manga.get`, `manga.refresh`, `chapter.list`, `chapter.pages`; `GET /api/cover/<manga>`, `GET /api/page/<chapter>/<index>` |
| #366 library | `library.list`, `manga.update`, `chapter.update`, `category.list`, `category.create`, `category.update`, `category.delete`, `category.reorder`, `meta.get`, `meta.set`, `meta.delete`, `history.list` |
| #367 downloads | `download.queue`, `download.enqueue`, `download.dequeue`, `download.start`, `download.stop`, `download.clear`, `download.delete`; topic `downloads` |
| #368 update runs | `update.start`, `update.stop`, `update.status`; topic `updates` |
| #369 sync | `sync.run`, `backup.export`, `backup.import` |
| #371 trackers | `tracker.list`, `tracker.login`, `tracker.logout`, `track.search`, `track.bind`, `track.update`, `track.unbind` |
| #374 local manga | none: the local source is source `0` in the source routes |
| #375 settings | `settings.get`, `settings.set`, `cache.clear` |

## Considered Options

- A subset of Suwayomi's GraphQL schema. Rejected: a much bigger server, and it keeps Suwayomi's quirks.
- REST resources. Rejected: the calls are actions, and one route per operation keeps each view's move mechanical.
- No credential on `127.0.0.1`. Rejected: any local user could read tracker tokens and source logins.
- The JDK `HttpServer` with polling. Rejected: it has no WebSocket, and polling undoes the live updates of ADR 0005.
- An ORM or a query DSL. Rejected: few tables, and plain SQL stays readable.
- Moving all views in one change, or syncing Suwayomi and core during the move. Rejected: one huge change, or throwaway sync code.
- A prebuilt jar from GitHub Releases. Rejected: it needs a release pipeline, and the window and core could drift apart.

## Consequences

- ADR 0009's "needs no login" becomes a shared secret. ADR 0005 still goes away at #373.
- Policy for background work stays in the slices: the update schedule (#368) and how many downloads run at once (#367).
