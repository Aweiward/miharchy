# Restore a backup

The window restores one `.tachibk` file into core, as Mihon's Restore backup does. Core does the work: `backup.check '{"file":"<path>"}'` lists what the backup needs and core lacks, and `backup.import '{"file":"<path>"}'` restores it, one at a time with syncs and backups, and answers `{"manga": <count>}`.

## Sub-features
- The path field takes an absolute path or `~/...` and starts in the sync folder.
- Before the restore: "Missing sources" and "Trackers not logged in", from `backup.check`'s `missingSources` and `missingTrackers`.
- The restore: the result, or core's message ("A sync is already running." while a sync runs).
- No baseline moves. The next sync counts the restored state as desktop changes.

## How to get to it (user POV)
Palette (`:`) → "Restore a backup" → type the path → Enter checks → Enter restores. Esc closes at any step; a running restore goes on.

## Driving it with drive.sh
`drive.sh` runs the window with `HOME=$RUN/home`, so put the fixture there:
```sh
mkdir -p <RUN>/home
cp <fixture>.tachibk <RUN>/home/r.tachibk
.claude/skills/verify-miharchy/scripts/drive.sh steps.js 60
```
Steps: `root.run("restore.open")`, set `restoreView.pathField.text = "~/r.tachibk"`, `key("Enter")`, wait for `restoreView.restore.step === "confirm"`, `key("Enter")`, wait for `"done"`. Log `restoreView.restore`. A quick fixture is a backup core writes itself (`backup.export '{"folder":"<RUN>/stage"}'`, `sync.md`).

Read back with the same routes the window sends. Recipe that ran on 2026-11-22, on the core seed with a track record written into `core.db`: `core.sh api backup.check '{"file":"<RUN>/stage/miharchy-backup-<time>.tachibk"}'` gave `"missingSources":[],"missingTrackers":["AniList"]`, and `core.sh api backup.import '{"file":"<same>"}'` gave `{"manga":2}`.

For criterion "the next sync keeps it", send the routes directly:
1. `sync.run` with phone backup P1 in the folder (`sync.md`), then `backup.import` R: `sha256sum <RUN>/core/data/sync/*-baseline.tachibk` does not change.
2. Put phone backup P2 (newer mtime) in the folder, where the phone removed a manga R touched and one R did not, then `sync.run`: the touched one stays in the library, the other leaves; a second `sync.run` with `"dryRun":true` answers `"changes":[]`.

## Gotchas
- Build fixtures with the model classes in `sync/src/main/kotlin/eu/kanade/...` (see `sync/src/test`). A source id with no installed extension shows under "Missing sources"; a track on a tracker core has but is not logged in to (AniList is 2) under "Trackers not logged in".
- A small fixture restores in under a second, and core sends no progress lines, so the window shows the running step only briefly.
