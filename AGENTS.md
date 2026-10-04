# Miharchy

A manga reader for Omarchy (Arch + Hyprland). It reads Mihon's extension ecosystem through Suwayomi-Server and syncs with stock Mihon on a phone through backup files.

## Read first

- `CONTEXT.md` is the glossary. Use its terms in code, UI text and docs: **manga**, **source**, **read state**, **sync**, **view** and the rest. When a new term settles, add it there.
- `docs/adr/` holds the architecture decisions. Read the ADRs before changing how the parts fit together. A change that contradicts one needs a new ADR that supersedes it.

## Architecture

```
 Omarchy shell                Window process               localhost only
 ┌──────────────────┐        ┌───────────────────┐  GraphQL ┌──────────────────┐
 │ plugin/ (QML)    │ opens  │ window/ (QML+JS)  │ ───────► │ Suwayomi-Server  │
 │ mark + popup     │ ─────► │ views + reader    │          │ systemd --user   │
 └──────────────────┘        └─────────┬─────────┘          └──────────────────┘
                                       │ runs                        ▲
                                       ▼                             │ GraphQL
                             ┌───────────────────┐                   │
                             │ sync/ (Kotlin CLI)│ ──────────────────┘
                             │ three-way merge   │ ◄── sync folder (.tachibk)
                             └───────────────────┘
```

- `plugin/` stays thin: the mark, the popup, a launcher. The reader never runs inside the shell process (ADR 0003).
- `window/` keeps decisions in pure JS modules, tested with node. QML files only wire those modules to the UI, the same split as the `aweiward.omaqbt` plugin in `~/.config/omarchy/plugins/`.
- `sync/` copies Mihon's backup model classes as the schema (ADR 0004). Keep them identical to upstream.
- Suwayomi-Server runs from `~/.local/share/miharchy/suwayomi`, bound to `127.0.0.1`, with `basic_auth` and a random password in `~/.config/miharchy/` (mode 600). Its WebUI and tray are off.

## Current work

v1 scope: browse and search, library and categories, reader (paged LTR/RTL, webtoon), downloads, extension repos, updates, and sync. Trackers and local manga come in v1.1.

The first task is the extension spike (Suwayomi issue #2298): install 10 popular Keiyoushi extensions, including one behind Cloudflare, and record which browse, list chapters and load pages. Its result decides whether ADR 0001 holds. Build UI only after it.

## Git

- Write commit messages and PR descriptions with no `Co-Authored-By:` line and no session trailer or link.
