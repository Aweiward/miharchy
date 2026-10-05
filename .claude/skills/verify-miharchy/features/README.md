# Miharchy feature map

One file per user-facing feature: how a user reaches it, how to drive it with `scripts/drive.sh`, and what end state proves it. Keep this map honest as features change (`/maintain-verification-skill`).

| Feature | File | Proof is |
|---|---|---|
| Library | `library.md` | the grid shows the server's library, categories, search and filters narrow it, the sort orders it, choices survive a restart, `x x` removes |
| Browse and add | `browse.md` | a source lists manga, the detail opens, `a` toggles `inLibrary` |
| Manga chapter actions | `manga.md` | `R`/`u`/`P` change `isRead`/`lastPageRead`, the Library badge follows; `b` sets `isBookmarked`; `F` filter and sort land in manga meta `miharchy.chapter*`; Space resumes |
| Reader | `reader.md` | pages render, `lastPageRead`/`isRead` saved, quit flushes the save |
| Updates | `updates.md` | the list matches the 3-month update rule, `u` runs a library update, the selection actions change the server and the mark's count |
| Settings storage | `settings.md` | downloads and cache sizes match `du` on the scratch server, Enter on "Clear the cache" empties its cache and reports the bytes freed, downloads keep their size |
| Sync | `sync.md` | the helper merges a phone backup and writes `miharchy-*.tachibk` |
| Restore a backup | `restore.md` | the window lists the missing sources and trackers, restores the file, and the next sync keeps what it restored |
| Download queue | `downloads.md` | moves and sorts land in `downloadStatus.queue` order and leave the downloader's state alone; `X X` empties the queue |
| Mouse | `mouse.md` | a click moves the cursor and a double click runs what Enter runs, on every list; hint parts and tabs press their key; reader tap zones turn in the reading direction; the wheel scrolls lists and the webtoon strip and turns paged pages |

Not yet mapped: the rest of Settings, Setup, Extensions, Global search, Migrate, Trackers, History, the bar plugin (`plugin/Mark.qml`, rendered offscreen with the shell's `Commons`/`Ui` copied into a scratch Quickshell config).
