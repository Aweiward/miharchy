# Sync

The sync helper (`sync/`, Kotlin CLI) merges the newest phone backup in the sync folder into the desktop library, then writes `miharchy-<UTC time>.tachibk` for Mihon. The window's `s` and the popup run the same helper.

## Sub-features
- `miharchy-sync sync [--folder DIR] [--dry-run] [--json]`; without `--folder` it reads meta `miharchy.syncFolder`.
- Per-side baselines in `<home>/.local/share/miharchy/sync/`; a lock file stops concurrent syncs.
- The "cannot reach the phone" list (`unreachable` in `--json`): what a stock Mihon restore cannot apply, from the newest phone backup against the export just written. Kinds: removed from the library, categories cleared, marked unread, bookmark removed, last page lowered, notes changed, and track changes (`Export.kt` `Unreachable`). Example: mark a chapter unread on the server that the phone backup has read, sync, and `unreachable` lists `markedUnread` for it.
- The export keeps the newest three `miharchy-*.tachibk`; the baselines are `phone-baseline.tachibk` and `desktop-baseline.tachibk`. Each sync merges the backup's `backupSources` into global meta `miharchy.sourceNames`.
- Notes: Mihon's `BackupManga.notes` (110) and manga meta `miharchy.notes` go both ways. A phone change comes in as `setNotes`; when both sides changed, both texts stay, the desktop's first. Suwayomi's backup has no notes, so `forMihon` writes them into the export from meta. Mihon's restore keeps the notes of a manga the phone already has, so a desktop edit shows in the list as "notes changed" until a phone backup carries it. To make a phone backup with notes, read an export with `LibraryKt.decodeBackup` in `jshell --class-path <helper lib jars>`, call `setNotes` on a manga, and write it back with `encodeBackup`.

## How to get to it (user POV)
Library or Updates → `s`, or the palette's "Sync now"; or `s` in the bar popup.

## Driving it with drive.sh
The helper is the real path; drive it directly:
```sh
sync/gradlew -p sync installDist
mkdir -p $RUN/folder $RUN/home
cp <phone-backup>.tachibk $RUN/folder/
.claude/skills/verify-miharchy/scripts/qs.sh env \
  sync/build/install/miharchy-sync/bin/miharchy-sync sync --folder $RUN/folder --json | tee $RUN/evidence/sync.json
```
`qs.sh env` gives the helper the run's `HOME`, `user.home` and `MIHARCHY_SERVER_JSON`. Run every helper command in this skill through it: the helper refuses to start when `HOME` and `user.home` disagree.
Proof: the backup's favorites are in the library (a first sync takes the union of phone and desktop, so on a seeded server the count is higher), a `miharchy-*.tachibk` exists in the folder, both baselines exist (mode 600, dir 700), a rerun answers `"changes":[]` (without `--json` it prints "no changes"). A quick phone backup: copy a `miharchy-backup-*.tachibk` from "Create a backup" (`backup.md`) into the folder under another name; the sync skips `miharchy-*` names. For the window path, install the helper into `$RUN/home` (see `restore.md`; `drive.sh` runs the window with `HOME=$RUN/home`), set global meta `miharchy.syncFolder` to the folder (`setGlobalMeta`; the window runs `sync --json` with no `--folder`, and without the meta the helper answers "No sync folder is set"), drive `key("s")` on Library and log `syncView.sync` and `syncView.report`.

## Hold and undo
A sync holds when it would remove at least 5 manga that are also at least 10% of the library, or mark at least 50 chapters unread (`holds` in `Merge.kt`). Fixture, with the helper as above (every `miharchy-sync` below runs through `qs.sh env`) and the sync folder in meta `miharchy.syncFolder`:
1. `seed.sh --library 6`. Write a good phone backup: `miharchy-sync backup $RUN/stage`, then move the file into the sync folder as `phone1.tachibk`, and sync once, so both baselines exist.
2. `updateMangas(input:{ids:[<5 of the 6>], patch:{inLibrary:false}})`, `miharchy-sync backup $RUN/stage` (rename it `phone2.tachibk`), then put the 5 back with `inLibrary:true`. Copy `phone2.tachibk` into the sync folder last, so it is the newest.
3. `--dry-run` reports "removed 5 manga from the library"; a plain run prints "Held", and the library, the folder and both baselines stay as they were.
```js
[
  [4000, function() { log("library", root.connection.manga.length); key("s") }],
  [20000, function() { log("held", syncView.sync); grab("sync-held") }],
  [500, function() { key("Esc"); log("after-esc", [syncView.open, root.connection.manga.length]) }],
  [500, function() { key("s") }],
  [20000, function() { key("y") }],
  [25000, function() { log("applied", syncView.sync) }],
  [3000, function() { key("Esc"); log("library-after", root.connection.manga.length); root.run("sync.undo") }],
  [800, function() { log("undo-path", restoreView.restore.path); key("Enter") }],
  [10000, function() { key("Enter") }],
  [20000, function() { log("undo-done", restoreView.restore.step); key("Esc") }],
  [4000, function() { log("library-final", root.connection.manga.length); done() }]
]
```
Proof: `held` shows state `held` with the count lines, `after-esc` keeps 6, `library-after` is 1, `undo-path` ends in `sync/pre-sync.tachibk`, `library-final` is 6, and `mangas(condition:{inLibrary:true}){ totalCount }` reads 6. A further sync with `phone2.tachibk` still newest reports "no changes" and keeps 6. The `MarkUnread` branch needs a phone backup without chapters; `HoldTest` pins it.

## Sync on a new phone backup
With meta `miharchy.autoSync` "true", the bar mark starts the sync when a new phone backup lands (`docs/agents/plugin.md`). The trigger lives in the mark, which `drive.sh` does not run, so `plugin/tests/mark.test.js` proves it: the real `find` against temp folders and a temp `HOME` (newest old-enough phone backup, `miharchy-*` and files under 30 s skipped, nothing newer than the baseline) and the notification for each result. The sync it starts is the helper drive above.

## Gotchas
- Build fixture backups with the model classes in `sync/src/main/kotlin/eu/kanade/...` (see `sync/src/test`); a user's real backup holds personal data — counts only in any report, delete copies.
- Never build `sync/` inside an installed plugin clone (`~/.config/omarchy/plugins/miharchy`): the shell reloads the plugin on every write there.
