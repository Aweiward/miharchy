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
JAVA_OPTS=-Duser.home=$RUN/home MIHARCHY_SERVER_JSON=$RUN/server.json \
  sync/build/install/miharchy-sync/bin/miharchy-sync sync --folder $RUN/folder --json | tee $RUN/evidence/sync.json
```
Proof: the backup's favorites are in the library (a first sync takes the union of phone and desktop, so on a seeded server the count is higher), a `miharchy-*.tachibk` exists in the folder, both baselines exist (mode 600, dir 700), a rerun answers `"changes":[]` (without `--json` it prints "no changes"). A quick phone backup: copy a `miharchy-backup-*.tachibk` from "Create a backup" (`backup.md`) into the folder under another name; the sync skips `miharchy-*` names. For the window path, install the helper into `$RUN/home` (see `restore.md`; `drive.sh` runs the window with `HOME=$RUN/home`), set global meta `miharchy.syncFolder` to the folder (`setGlobalMeta`; the window runs `sync --json` with no `--folder`, and without the meta the helper answers "No sync folder is set"), drive `key("s")` on Library and log `syncView.sync` and `syncView.report`.

## Gotchas
- Build fixture backups with the model classes in `sync/src/main/kotlin/eu/kanade/...` (see `sync/src/test`); a user's real backup holds personal data — counts only in any report, delete copies.
- Never build `sync/` inside an installed plugin clone (`~/.config/omarchy/plugins/miharchy`): the shell reloads the plugin on every write there.
