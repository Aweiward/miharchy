# Sync

The sync helper (`sync/`, Kotlin CLI) merges the newest phone backup in the sync folder into the desktop library, then writes `miharchy-<UTC time>.tachibk` for Mihon. The window's `s` and the popup run the same helper.

## Sub-features
- `miharchy-sync sync [--folder DIR] [--dry-run] [--json]`; without `--folder` it reads meta `miharchy.syncFolder`.
- Per-side baselines in `<home>/.local/share/miharchy/sync/`; a lock file stops concurrent syncs.
- The "cannot reach the phone" list (removals, unread marks, track changes stock Mihon cannot apply).

## How to get to it (user POV)
Library or Updates → `s`, or the palette's "Sync now"; or `s` in the bar popup.

## Driving it with drive.sh
The helper is the real path; drive it directly:
```sh
(cd sync && ./gradlew installDist)
mkdir -p $RUN/folder $RUN/home && cp <phone-backup>.tachibk $RUN/folder/
JAVA_OPTS=-Duser.home=$RUN/home MIHARCHY_SERVER_JSON=$RUN/server.json \
  sync/build/install/miharchy-sync/bin/miharchy-sync sync --folder $RUN/folder --json | tee $RUN/evidence/sync.json
```
Proof: the library count matches the backup's favorites, a `miharchy-*.tachibk` exists in the folder, both baselines exist (mode 600, dir 700), a rerun prints "no changes". For the window path, drive `key("s")` on Library and log `syncView.sync`.

## Gotchas
- Build fixture backups with the model classes in `sync/src/main/kotlin/eu/kanade/...` (see `sync/src/test`); a user's real backup holds personal data — counts only in any report, delete copies.
- Never build `sync/` inside an installed plugin clone (`~/.config/omarchy/plugins/miharchy`): the shell reloads the plugin on every write there.
