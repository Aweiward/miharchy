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

## Known limits

- On JDK 26 and later, Keiyoushi's library sets a `final` field by reflection, and the JVM warns that a future release blocks it unless `--enable-final-field-mutation=ALL-UNNAMED` is set. JDK 21 refuses that flag, so the launcher cannot pass it to every JDK yet.

A new table or column is a new file in `server/src/main/resources/db/`, added to `Database.MIGRATIONS`. Never edit a migration that has shipped.
