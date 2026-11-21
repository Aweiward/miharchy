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

A new table or column is a new file in `server/src/main/resources/db/`, added to `Database.MIGRATIONS`. Never edit a migration that has shipped.
