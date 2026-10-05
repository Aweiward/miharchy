# Miharchy feature map

One file per user-facing feature: how a user reaches it, how to drive it with `scripts/drive.sh`, and what end state proves it. Keep this map honest as features change (`/maintain-verification-skill`).

| Feature | File | Proof is |
|---|---|---|
| Library | `library.md` | the grid shows the server's library, categories filter it, `x x` removes |
| Browse and add | `browse.md` | a source lists manga, the detail opens, `a` toggles `inLibrary` |
| Manga chapter actions | `manga.md` | `R`/`u`/`P` change `isRead`/`lastPageRead`, the Library badge follows |
| Reader | `reader.md` | pages render, `lastPageRead`/`isRead` saved, quit flushes the save |
| Updates | `updates.md` | the list matches the 3-month update rule, `u` runs a library update |
| Sync | `sync.md` | the helper merges a phone backup and writes `miharchy-*.tachibk` |

Not yet mapped: Settings, Setup, Extensions, Global search, Migrate, Trackers, Downloads, History, the bar plugin (`plugin/Mark.qml`, rendered offscreen with the shell's `Commons`/`Ui` copied into a scratch Quickshell config).
