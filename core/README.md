# miharchy-core

The service that replaces Suwayomi-Server (ADR 0009). ADR 0010 fixes its API, its database and its build. Map #359 lists the slices still to build.

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

Nothing in `window/` or `plugin/` calls core yet, and `stable` leaves out `core/` until the switch-over (#373). `server/miharchy-core.service` is the user unit; Setup installs it in #385.

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

- Chapters go to `<data>/downloads/<source>/<manga>/<chapter>.cbz` with Mihon's names (`DownloadProvider`, `DiskUtil.buildValidFilename`): FAT's forbidden characters become `_`, and a name fits 240 bytes. A second chapter with the same name gets Mihon's `_<md5(url) 6>` suffix. The folder setting waits for Settings (#385).
- `chapter.download_path` holds the file's path, set once the `.cbz` is complete, so `isDownloaded` and `downloadCount` are SQL. A file deleted outside core still counts as downloaded; the reader then reads from the source.
- One chapter downloads at a time, into a `.part` file that is moved into place. A restart drops `.part` files and finds the queue stopped.
- Every route answers with the status `{ state: "STARTED" | "STOPPED", queue }`, each item with Suwayomi's `state`, `progress`, `tries`, `chapter` and `manga` plus core's `error { kind, message }`, which keeps why a download failed. `download.reorder { chapterId, to }` moves one item. The `downloads` topic sends the whole status on each change.
- An enqueue starts the downloader, which stops when nothing is left to try. A failed chapter stays in the queue as `ERROR` and does not hold up the next one. Enqueue it again to retry; it keeps its place and its tries.
- `chapter.pages` and `GET /api/page/...` read a downloaded chapter from its `.cbz`, with no network.
- `chapter.list` also takes chapter `ids`, for the window's delete-after-read rules (`Downloads.autoDeleteQuery`).

## Known limits

- On JDK 26 and later, Keiyoushi's library sets a `final` field by reflection, and the JVM warns that a future release blocks it unless `--enable-final-field-mutation=ALL-UNNAMED` is set. JDK 21 refuses that flag, so the launcher cannot pass it to every JDK yet.

A new table or column is a new file in `server/src/main/resources/db/`, added to `Database.MIGRATIONS`. Never edit a migration that has shipped.
