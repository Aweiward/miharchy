# Miharchy logs in to Suwayomi with tokens

Status: superseded by ADR 0010 (2026-11-22). The window, the bar mark and the sync no longer talk to Suwayomi; miharchy-core takes a fixed secret from `core.json` on every request. Only core's one-time move from Suwayomi still logs in with the username and password from `server.json` (`core/server/.../Suwayomi.kt`).

Suwayomi-Server runs in `ui_login` mode, not `basic_auth`. Each process (the window, the plugin, the sync helper) logs in once with the username and password from `server.json` and then sends a short-lived access token, refreshed with a longer-lived refresh token. QML's WebSocket cannot send an `Authorization` header, so under Basic auth the views polled; a token can travel in the socket's `connection_init` payload, so views can subscribe instead. The password also travels only at login, not on every request.

## Considered Options

- Keep `basic_auth`. Rejected: QML cannot send Basic credentials on a WebSocket, so Downloads and Updates must poll, and every request carries the password.
- Support both modes. Rejected: two login paths to test for no user gain.

## Consequences

- `server.json` keeps `{url, username, password}`. Tokens live in each process's memory only and are never written to disk.
- Setup moves existing installs from `basic_auth` to `ui_login`.
- Suwayomi's next release reworks its auth ("User Accounts", upstream #623). Miharchy pins the newest Suwayomi version it has checked token login against, and warns when the server is newer. The package depends on `suwayomi-server-bin` up to that version.
- Suwayomi stays the backend (ADR 0001).
