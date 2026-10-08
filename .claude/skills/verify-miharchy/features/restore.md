# Restore a backup

The window restores one `.tachibk` file into the server, as Mihon's Restore backup does. The sync helper does the work: `miharchy-sync check <file>` lists what the backup needs and the server lacks, and `miharchy-sync restore <file>` restores it under `sync.lock` and streams progress as JSON lines.

## Sub-features
- The path field takes an absolute path or `~/...` and starts in the sync folder.
- Before the restore: "Missing sources" and "Trackers not logged in", from `validateBackup`.
- The restore: progress lines while it runs, then the result or the helper's message ("A sync is already running." while a sync holds the lock).
- No baseline moves. The next sync counts the restored state as desktop changes.

## How to get to it (user POV)
Palette (`:`) → "Restore a backup" → type the path → Enter checks → Enter restores. Esc closes at any step; a running restore goes on.

## Driving it with drive.sh
The window runs the helper Setup installs under `$HOME`; `drive.sh` sets `HOME=$RUN/home`, so install the checkout's build there:
```sh
mkdir -p $RUN/home/.local/share/miharchy/helper
cp -r sync/build/install/miharchy-sync/. $RUN/home/.local/share/miharchy/helper/
cp <fixture>.tachibk $RUN/home/r.tachibk
.claude/skills/verify-miharchy/scripts/drive.sh steps.js 60
```
Steps: `root.run("restore.open")`, set `restoreView.pathField.text = "~/r.tachibk"`, `key("Enter")`, wait for `restoreView.restore.step === "confirm"`, `key("Enter")`, wait for `"done"`. Log `restoreView.restore`.

For criterion "the next sync keeps it", drive the helper directly through `.claude/skills/verify-miharchy/scripts/qs.sh env $RUN/home/.local/share/miharchy/helper/bin/miharchy-sync <args>`:
1. `sync --folder $RUN/folder` with phone backup P1, then `restore R`: the baselines' sha256 do not change.
2. Put phone backup P2 (newer mtime) in the folder, where the phone removed a manga R touched and one R did not, then `sync`: the touched one stays in the library, the other leaves; a second `sync` prints "no changes".

## Gotchas
- Build fixtures with the model classes in `sync/src/main/kotlin/eu/kanade/...` (see `sync/src/test`). A source id with no installed extension shows under "Missing sources"; a track on MyAnimeList (1) under "Trackers not logged in" on a fresh server.
- Suwayomi's final `restoreStatus` resets `mangaProgress` and `totalManga` to 0, and its running count includes non-manga steps, so the result line names no count.
- A small fixture restores in under a second, so the running step rarely shows a progress line in a capture; `restore` on the command line prints them.
