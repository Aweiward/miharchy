# Miharchy feature map

One file per user-facing feature: how a user reaches it, how to drive it with `scripts/drive.sh`, and what end state proves it. Keep this map honest as features change (`/maintain-verification-skill`).

| Feature | File | Proof is |
|---|---|---|
| Library | `library.md` | the grid shows the server's library, categories, search and filters narrow it, the sort orders it, choices survive a restart, `x x` removes |
| Browse and add | `browse.md` | a source lists manga, the detail opens, `a` toggles `inLibrary`; `p` pins land in `miharchy.pinnedSources` and the pinned and last used sources list first |
| Manga chapter actions | `manga.md` | `R`/`u`/`P` change `isRead`/`lastPageRead`, the Library badge follows; `b` sets `isBookmarked`; `F` filter and sort land in manga meta `miharchy.chapter*`; Space resumes |
| Reader | `reader.md` | pages render, `lastPageRead`/`isRead` saved, quit flushes the save |
| History | `history.md` | `/` narrows the entries to titles holding the search, `Enter` keeps it, `Esc` clears it |
| Updates | `updates.md` | the list matches the 3-month update rule and the `F` filters (read back `miharchy.updates*` meta), `u` runs a library update, the selection actions change the server and the mark's count |
| Settings storage | `settings.md` | downloads and cache sizes match `du` on the scratch server, Enter on "Clear the cache" empties its cache and reports the bytes freed, downloads keep their size |
| Sync | `sync.md` | the helper merges a phone backup and writes `miharchy-*.tachibk` |
| Restore a backup | `restore.md` | the window lists the missing sources and trackers, restores the file, and the next sync keeps what it restored |
| Backups | `backup.md` | "Create a backup" writes `miharchy-backup-*.tachibk` to the backup folder with what the include rows choose; the sync folder is refused |
| Download queue | `downloads.md` | moves and sorts land in `downloadStatus.queue` order; `X X` empties the queue; CBZ, auto-download and delete-after-read settings and category flags change what the server keeps on disk |
| Mouse | `mouse.md` | a click moves the cursor and a double click runs what Enter runs, on every list; hint parts and tabs press their key; reader tap zones turn in the reading direction; the wheel scrolls lists and the webtoon strip and turns paged pages |
| Extensions | `extensions.md` | Enter on an installed extension shows its version, language and sources; Enter on a source opens its settings and a change lands in `source { preferences }`; `x x` in the details uninstalls; `U` updates every extension with an update |
| Migrate | `migrate.md` | the target joins the library with the old categories, read state and tracks (`trackRecords` read back); `t` on the confirm leaves the tracks out; the old manga leaves only after the target write |
| Trackers | `trackers.md` | the panel lists the manga's tracks; `o`/`y` hand the track's link to `xdg-open`/`wl-copy` (stubbed); date and private writes send `updateTrack` inputs the server accepts; a mark read pushes `trackProgress` (a `trackChapter` line in the server log) under always and not under never |

Not yet mapped: the rest of Settings, Setup, Global search, tracker logins, the bar plugin (`plugin/Mark.qml`, rendered offscreen with the shell's `Commons`/`Ui` copied into a scratch Quickshell config).

The mark's new-chapter notification is proven without the shell: `plugin/tests/mark.test.js` pins the decision and runs the real notify script with a stub `notify-send` on `PATH`; feed `Mark.js` the scratch server's answer to `Mark.listPayload()` from node to check the query. For the click, start a drive with `MIHARCHY_OPEN_VIEW=updates` (the window opens on Updates), and while it runs send `quickshell ipc -p $RUN/app/window call miharchy openUpdates` to that offscreen copy. Never run the real `notify-send`.
