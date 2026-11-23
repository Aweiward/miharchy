# miharchy-core

The service that replaced Suwayomi-Server (ADR 0009). ADR 0010 fixes its API, its database and its build. `docs/agents/server.md` says how it runs.

- `host/` is NanoYomi's extension host, as a library (see `host/README.md`).
- `server/` is the service: Ktor on `127.0.0.1:4591`, SQLite in `~/.local/share/miharchy/core/core.db`, and the host in the same JVM. Every request sends `Authorization: Bearer <secret>`, with the secret from `~/.config/miharchy/core.json`, which core creates with mode 600 on its first start. Its `url` is the one source of the port: `MIHARCHY_CORE_PORT` sets the port of a new file, and core stops if it differs from an existing one.

Build and test with JDK 21 or newer:

```sh
./gradlew installDist test
```

Run it without touching the real folders:

```sh
MIHARCHY_CORE_DATA=/tmp/core/data MIHARCHY_CORE_CONFIG=/tmp/core/core.json MIHARCHY_CORE_PORT=4599 \
  server/build/install/miharchy-core/bin/miharchy-core
```

miharchy-core is the only server since #373, and `stable` ships `core/` and `sync/`. `server/miharchy-core.service` is the user unit. Setup builds a copy of `core/` and `sync/` into `~/.local/share/miharchy/core-app` (its fingerprint covers both, build output pruned), installs the unit, waits for `core.json`, and offers the move (#385). After the move, or with nothing to move, it offers to stop and disable Suwayomi's `miharchy-server` unit; the package and the data stay. Setup on core installs no Suwayomi-Server. A rebuild restarts a running core.

## Extension repos (#364)

- A repo is its `index.json`, which lists each extension's `jarUrl`, `iconUrl` and the repo's `signingKey`. Keiyoushi's `index.min.json` is now a stub that lists only "Outdated App" entries, so core reduces any address the user pastes (the folder, `index.min.json`, `repo.json`, `index.pb`, `index.json`) to the folder and reads `index.json`.
- The signing key is pinned when the repo is added, and copied into each installed extension's `extensions/<pkg>.json`. A repo whose key changes is refused, and each jar loads only with the key it was installed with.
- An update writes `<pkg>-<versionCode>.jar`, a new name, loads it, unloads the source ids it dropped, and only then deletes the old jar.

## Browse (#365)

- A listing writes each manga into Mihon's `manga` table, so every manga has a core id before the user opens it. A listing never overwrites details a refresh loaded.
- `manga.refresh` matches chapters by URL, so read state survives. A source that returns no chapters is an error and changes nothing.
- A source that opens a WebView fails with the kind `webview`, because `Protocol.out` is never set in core. A Cloudflare challenge fails with `cloudflare` until #361.

## Library (#366)

- The library is the manga with `user_favorite_at` set. Listings also store manga outside it, and History keeps those too.
- A `lastPageRead` write stamps History (`history.read_at`). A plain mark-read does not, and neither does mark-unread's reset to page 0.
- Category 0 is Default: it is never renamed, moved or deleted, and a manga in no category is in it. Category ids are never reused.
- Id lists go to SQLite as one JSON parameter (`json_each`), so a whole library fits in one call.
- `meta.get` takes one query `{ scope, owners?, keys? }` or several as `{ queries: [...] }`, answered in order. The window loads a manga's own choices with the global ones this way (#378).

## Downloads (#367)

- Chapters go to `<data>/downloads/<source>/<manga>/<chapter>.cbz` with Mihon's names (`DownloadProvider`, `DiskUtil.buildValidFilename`): FAT's forbidden characters become `_`, and a name fits 240 bytes. A second chapter with the same name gets Mihon's `_<md5(url) 6>` suffix. The `downloadsPath` setting is stored only.
- `chapter.download_path` holds the file's path, set once the `.cbz` is complete, so `isDownloaded` and `downloadCount` are SQL. A file deleted outside core still counts as downloaded; the reader then reads from the source.
- One chapter downloads at a time, into a `.part` file that is moved into place. A restart drops `.part` files and finds the queue stopped.
- Every route answers with the status `{ state: "STARTED" | "STOPPED", queue }`, each item with Suwayomi's `state`, `progress`, `tries`, `chapter` and `manga` plus core's `error { kind, message }`, which keeps why a download failed. `download.reorder` moves one item (`{ chapterId, to }`) or sets the whole order (`{ order }`): ids that left the queue are skipped, and queued ids the order leaves out follow it in their order. `download.delete` adds `chapters: [{ id, isDownloaded }]` to the status. The `downloads` topic sends the whole status on each change.
- An enqueue starts the downloader, which stops when nothing is left to try. A failed chapter stays in the queue as `ERROR` and does not hold up the next one. Enqueue it again to retry; it keeps its place and its tries.
- `chapter.pages` and `GET /api/page/...` read a downloaded chapter from its `.cbz`, with no network.
- `extension.list { cached: true }` answers from the repo indexes core already holds and fetches only one it has none of, so the library check, which loads each time Settings shows, does not reach the network each time (#394).
- `chapter.list` also takes chapter `ids`, for the window's delete-after-read rules (`Downloads.autoDeleteQuery`). `unread: true` keeps unread chapters only, and `since` (upload time in ms) the ones uploaded after it: the bar mark's poll reads only those each minute (#386).

## Update runs (#368)

- `update.start { categories? }` fetches new chapters for the library, through the same refresh as `manga.refresh`. With category ids it takes every manga in them (Default is `0`, the manga with no category); with none or `[]` it takes Mihon's rule: the INCLUDE categories, or the UNSET ones when none is, and never a manga in an EXCLUDE one. Both forms then skip what Suwayomi's skip filters skip: `ONLY_FETCH_ONCE`, unread chapters, not started (initialized, no read time and no read chapter), completed.
- The skip filters and the schedule are the window's global metas, `miharchy.excludeUnreadChapters`, `miharchy.excludeNotStarted`, `miharchy.excludeCompleted` (`"true"` or `"false"`, default on) and `miharchy.globalUpdateInterval` (hours, default 12, `0` off), which the Settings rows write (#385). Core runs the whole library when the interval has passed since the last run, or since its start when there was none, so runs happen while the window is closed.
- Every route answers with the status `{ isRunning, stopped, finishedJobs, totalJobs, skippedMangasCount, lastUpdateTimestamp, failed: [{ mangaId, kind, message }] }`, with `lastUpdateTimestamp` in ms, kept in the global meta `miharchy.lastUpdateTimestamp`. `update.start` adds `started`, false when a run was already going. A stop keeps the run's counts and reasons until the next start, with `stopped` true. A failed manga counts as finished and does not stop the run. The `updates` topic sends the whole status on each change.
- Up to 5 sources update at once, one manga at a time per source. A run always fetches details (Suwayomi's `updateMangas`).
- Auto-download (#424, `AutoDownload.kt`): when a refresh (an update run or `manga.refresh`) adds chapters to a library manga and `autoDownloadNewChapters` is on, core queues them, oldest first, and starts the downloader. The rules are Suwayomi v2.4.2366's `Chapter.downloadNewChapters`:
  - A manga's first fetch queues nothing. A phone sync, a restore or the move never queues anything.
  - The category rule is the update rule over `includeInDownload`: INCLUDE categories, or UNSET ones when none is INCLUDE; EXCLUDE wins; no category is Default (0).
  - `excludeEntryWithUnreadChapters` (on by default) skips a manga with an unread chapter that is not new.
  - `autoDownloadIgnoreReUploads` drops a new chapter numbered below the newest chapter before the refresh, and an unnumbered one.
  - Of new chapters with the same number, one is queued: the first new chapter's scanlator, else the first. Unnumbered chapters stay apart.
  - There is no limit setting (Suwayomi's `autoDownloadNewChaptersLimit`). A failed queue write is logged and never fails the refresh.

## Trackers (#371)

- The clients are Mihon's, ported under `server/src/main/kotlin/eu/kanade/tachiyomi/data/track/` (Apache-2.0, each file names its Mihon source): MyAnimeList 1, AniList 2, Kitsu 3, Shikimori 4, Bangumi 5, MangaUpdates 7, MangaBaka 11. They use Suwayomi's registered apps, so an OAuth login ends on `https://suwayomi.org/tracker-oauth`. That page forwards nowhere without Suwayomi's `state`, and the address in the browser's address bar is the callback the user pastes back.
- `tracker.list` gives `{ trackers: [{ id, name, isLoggedIn, authUrl, scores, statuses: [{ value, name }], supportsReadingDates, supportsPrivateTracking }] }`. `authUrl` is null once logged in, and for the username and password trackers (Kitsu, MangaUpdates). A PKCE tracker keeps one `authUrl` until its login ends.
- `tracker.login { trackerId, callbackUrl }` or `{ trackerId, username, password }` gives `{ tracker }`. A refused login is `invalid`; `unauthorized` stays core's own secret. `tracker.logout { trackerId }`.
- `track.search { trackerId, query }` gives `{ results: [{ remoteId, title, totalChapters, trackingUrl, coverUrl, summary, publishingStatus, publishingType, startDate, score }] }`. Core keeps the last 500 results in memory, and `track.bind { mangaId, trackerId, remoteId, private? }` takes the title and chapter count from them.
- `track.bind { mangaId, recordId }` copies an existing track onto another manga, as Suwayomi's `bindTrackRecord` does for Migrate: every field but its id and manga, replacing that manga's own track on the same tracker. It calls no tracker, so it needs no login.
- A track is `{ id, mangaId, trackerId, remoteId, libraryId, title, status, score, displayScore, lastChapterRead, totalChapters, remoteUrl, startDate, finishDate, private }`, dates in ms, 0 for none. `track.bind`, `track.update { recordId, status?, lastChapterRead?, scoreString?, startDate?, finishDate?, private? }` give `{ track }`; `track.unbind { recordId }` drops core's record and keeps the entry on the tracker. `track.list { mangaIds }` gives `{ tracks }`.
- Bind, update and progress follow Suwayomi's `Track.kt`: a bind takes the tracker's own entry, then moves it to the highest read chapter and to the first read time. `track.progress { mangaIds }` reads each track fresh and pushes the highest read chapter when it is above the tracker's, giving `{ tracks, failed: [{ recordId, kind, message }] }`.
- Logins and tokens live in `tracker_pref` in core.db, in core's owner-only data folder. No reply, topic or error carries a token, a code or a password; a tracker's unreadable reply is reported as "an unexpected reply", because a decode error quotes it. Each tracker runs one call at a time, so a token refresh never races another.
- ponytail: no rate limiters; a big `track.progress` can meet a tracker's limit, and each refused track shows in `failed`.

## Sync and backups (#369)

- `server/` uses `sync/`'s merge and Mihon backup classes through a Gradle composite build (`includeBuild("../sync")` in `settings.gradle.kts`, ADR 0010). `sync/` is a library only; its Suwayomi helper is gone (#373). `sync/`'s newer `kotlin-stdlib` stays out of core, so core runs on the host's. A build of `core/` needs `sync/` beside it.
- `Sync` holds no extension host and no tracker client, so a sync or an import never contacts a source or a tracker. Merge rules: ADR 0002. Applying them: ADR 0004's "On miharchy-core".
- `sync.run { folder?, dryRun?, apply? }` runs the sync, and the reply is `sync/`'s `Summary`. Without `folder`, it reads global meta `miharchy.syncFolder`. The merge, its apply and the export for the phone run in one transaction. The baselines, `pre-sync.tachibk` and `pending-since` move only after it commits. They live in `sync/` in core's data folder. A hold or a dry run writes nothing.
- `backup.export { folder, categories?, chapters?, tracking?, history? }` writes `miharchy-backup-<UTC>.tachibk` and gives `{ file }`. Each part is on unless it is `false`. The sync folder is refused with the message Settings shows (`backupRefusal`).
- `backup.import { file }` restores a Mihon or Suwayomi backup as Mihon's restore does and gives `{ manga }`, the number of manga in the file. An unknown manga comes in whole. A known manga keeps its own data and gains read and bookmarked chapters (OR), higher last pages, newer history and the backup's tracks (chapters read never lower). A non-empty category list replaces the manga's categories, by name. Notes come in only on a manga core did not have. Source names merge into meta `miharchy.sourceNames`. Tracks on trackers core lacks stay out.
- Notes are manga meta `miharchy.notes`, as the window writes them. `manga.user_notes` stays unused.
- One run of the three routes at a time; another answers `invalid` "A sync is already running."
- `sync.health { folder? }` gives `sync/`'s `Health` (every field, nulls too). `backup.check { file }` or `{ preSync: true }` gives `{ file, missingSources, missingTrackers }`, as Mihon's `BackupFileValidator`: the backup's sources core has not installed, and the trackers core has but is not logged in to. `preSync` names `pre-sync.tachibk` in core's state folder, the library before the last sync, so the window's Undo restores it with `backup.import` (#384). Both read only and take no lock.

## Settings and automatic backups (#375)

- The server settings are `window/Settings.js`'s server rows. Core keeps each one as global meta `miharchy.<key>`, a string such as `"true"` or `"12"`, beside the window's own Settings rows. `Settings.kt`'s `SETTINGS` table lists each key with its default, its rule and whether core acts on it. A missing value, or one the rule refuses (`meta.set` writes anything), reads as the default.
- `settings.get` gives `{ settings: { key: value }, unapplied: [key] }`, values typed as `Settings.js` holds them. `settings.set { settings: { key: value } }` checks every key and value first, stores none on a refusal (`invalid`), and gives the same reply. A backup folder must exist and must not be the sync folder.
- `unapplied` names the keys core stores but does not act on yet: FlareSolverr (#361), KCEF (the host has no WebView), `updateMangas`, `downloadsPath` (downloads stay in `<core data>/downloads`), `downloadAsCbz` (core always writes `.cbz`) and `localSourcePath` (#374).
- `cache.clear` deletes the cached covers of manga outside the library, core's only cache, and gives `{ freed }` in bytes. Library covers stay, as Suwayomi keeps its downloaded thumbnails, and so does a cover being written.
- `storage.get` gives `{ downloads, cache }` in bytes for Settings' storage rows: the files under `<data>/downloads`, and the covers `cache.clear` would delete. The window cannot know core's data folder, so core measures it.
- Automatic backups (`Backups.kt`) run in core, so they run while the window is closed. They follow `backupInterval` (days, 0 off) at `backupTime`, local time, as Suwayomi's schedule. A slot missed while core was off runs on the next minute's tick and counts as that slot. The time the timer first saw backups on is kept in meta `miharchy.autoBackupSince`, so a machine that is off at every slot still gets its first backup. The last run is meta `miharchy.lastAutoBackup`, written only once the file exists.
- They go to `backupPath`, or `<core data>/backups` when it is blank, as `miharchy-auto-<UTC>.tachibk`, with the parts the `autoBackupInclude*` rows choose. After each, core deletes `miharchy-auto-*` files older than `backupTTL` days (0 keeps all), by file time. It never touches another file. A run that a sync holds up waits for the next tick. A refusal (the sync folder, a missing folder) logs once until it changes.
- `backup.export` without `folder` uses the same folder, and without parts the same include rows.

## Move from Suwayomi (#372)

- `move.start { serverConfig, serverRoot, helperSync? }` moves a v1.1.1 install into core as a job, and `move.status` follows it: `{ state: "idle" | "running" | "done" | "failed", step, report, error }`. `serverConfig` is the path of Suwayomi's `server.json`, `serverRoot` Suwayomi's root folder (`~/.local/share/miharchy/suwayomi`), and `helperSync` the sync helper's state (`~/.local/share/miharchy/sync`). The paths have no defaults, so a test or a scratch core never reads the real install. Setup's move step sends it with the real paths and follows `move.status` (#385). A finished move's report is kept in meta `miharchy.moveReport`, so `move.status` still answers `done` after a restart; Setup then offers no second move, which would write Suwayomi's values over core's.
- The move only reads Suwayomi. In order: the extension repos and installed extensions; the library from a Suwayomi backup with every part on and no server settings (`backup.import`); the categories' update and download choices and each manga's last chapter fetch (`chaptersLastFetchedAt`, for the library check), which a backup does not carry; every global, manga and category meta; the server settings; the downloads; the helper's baselines.
- Ids become core's: a manga by source and URL, a category by name (Default is 0 on both). The global meta `miharchy.defaultCategory` holds a category id, so it is mapped too. Core's own metas (`miharchy.lastAutoBackup`, `miharchy.autoBackupSince`, `miharchy.lastUpdateTimestamp`) are never overwritten.
- Each setting goes through `settings.set` on its own, so a value core refuses skips that row only. Suwayomi's `globalUpdateInterval` is a float of hours; core takes it as whole hours.
- A downloaded chapter is found at Suwayomi's path (`DirName.kt` at v2.4.2366): `<downloadsPath or root/downloads>/mangas/<source>/<manga>/<scanlator>_<chapter>`, a `.cbz` or a folder of pages, with Mihon's filename rules. A `.cbz` is hard-linked into core's downloads folder (copied across disks); a folder is zipped. Pages are image entries only, so Suwayomi's `ComicInfo.xml` is no page.
- The helper's `phone-baseline.tachibk`, `desktop-baseline.tachibk` and `pending-since` are copied only where core has none, so the first core sync is not a first sync.
- What cannot move (a repo that fails, a refused setting, an unreadable download, metas of manga outside the library, a category id core cannot map, which makes `miharchy.defaultCategory` "ask") goes into `report.skipped`, and the rest goes on.
- A run again is safe. The library merges as `backup.import` does and never loses read state. Metas, settings and category choices take Suwayomi's values again, and chapters core already has downloaded stay. With Suwayomi unchanged, a second run gives the same database.
- A sync running at the same time makes `backup.import` refuse, and the move fails with that message; start it again after the sync.
- A Suwayomi backup holds the library only: History of manga outside the library does not move.

## Known limits

- On JDK 26 and later, Keiyoushi's library sets a `final` field by reflection, and the JVM warns that a future release blocks it unless `--enable-final-field-mutation=ALL-UNNAMED` is set. JDK 21 refuses that flag, so the launcher cannot pass it to every JDK yet.

A new table or column is a new file in `server/src/main/resources/db/`, added to `Database.MIGRATIONS`. Never edit a migration that has shipped.
