# Sync

Core's `sync.run` (`core/.../Sync.kt`, the merge in `sync/`) merges the newest phone backup in the sync folder into core's library, then writes `miharchy-<UTC time>.tachibk` for Mihon. The window's `s` and the popup send the same route.

## Sub-features
- `sync.run '{"folder"?, "dryRun"?, "apply"?}'` (`apply` runs a held sync; the window sends it on `y`); without `folder` it reads meta `miharchy.syncFolder`. The reply is `sync/`'s `Summary`: `backup`, `export`, `changes`, `unreachable`, and `held` only when true.
- Baselines in `$RUN/core/data/sync/` (`phone-baseline.tachibk`, `desktop-baseline.tachibk`, `pre-sync.tachibk`, `pending-since`); core runs one sync, import or backup at a time, and a second answers "A sync is already running."
- The "cannot reach the phone" list (`unreachable`): what a stock Mihon restore cannot apply, from the newest phone backup against the export just written. Kinds: removed from the library, categories cleared (`categoriesCleared`, text "taken out of every category"), marked unread, bookmark removed, last page lowered, notes changed, and track changes (`byHand` of `gap` in `Export.kt`). Example: mark a chapter unread on core that the phone backup has read, sync, and `unreachable` lists `markedUnread` for it.
- The export keeps the newest three `miharchy-*.tachibk`. Each sync merges the backup's `backupSources` into global meta `miharchy.sourceNames`.
- Notes: Mihon's `BackupManga.notes` (110) and manga meta `miharchy.notes` go both ways. A phone change comes in as `setNotes`; when both sides changed, both texts stay, the desktop's first. The export writes them from meta. Mihon's restore keeps the notes of a manga the phone already has, so a desktop edit shows in the list as "notes changed" until a phone backup carries it. To make a phone backup with notes, read an export with `LibraryKt.decodeBackup` in `jshell --class-path <sync/ build jars>`, call `setNotes` on a manga, and write it back with `encodeBackup`.

## How to get to it (user POV)
Library or Updates → `s`, or the palette's "Sync now"; or `s` in the bar popup.

## Driving it with drive.sh
`sync.run` is the real path; send it directly. A quick phone backup is a backup core writes itself, copied into the sync folder under another name (the sync skips `miharchy-*` names):
```sh
mkdir -p <RUN>/folder <RUN>/stage <RUN>/evidence
.claude/skills/verify-miharchy/scripts/core.sh api backup.export '{"folder":"<RUN>/stage"}'     # {"file": ".../miharchy-backup-<time>.tachibk"}
cp <RUN>/stage/miharchy-backup-<time>.tachibk <RUN>/folder/phone1.tachibk
.claude/skills/verify-miharchy/scripts/core.sh api sync.run '{"folder":"<RUN>/folder"}' | tee <RUN>/evidence/sync.json | jq -c '{backup, export, held, changes: (.changes | length)}'
```
Proof: the backup's favorites are in `library.list` (a first sync takes the union of phone and desktop), a `miharchy-*.tachibk` exists in the folder, both baselines exist in `$RUN/core/data/sync` (mode 600, dir 700), and a rerun with `"dryRun":true` answers `"changes":[]`. On 2026-11-22 the first sync answered `backup` = `phone1.tachibk` and an `export` in the folder, the baselines were mode 600 in a 700 dir, and the dry rerun gave `{"dryRun":true,"changes":[]}`. For the window path, set global meta `miharchy.syncFolder` to the folder (`meta.set`; the window sends `sync.run` with no `folder`, and without the meta core answers "No sync folder is set. Choose one in Setup or Settings."), drive `key("s")` on Library and log `syncView.sync` and `syncView.report`.

## Sync health
`sync.health '{"folder"?}'` answers `sync/`'s `Health` and writes nothing. Recipe that ran on 2026-11-22, on the core seed: the steps above (no `pending-since` after the first sync); `chapter.update '{"ids":[<id>],"isRead":true}'`; sync again. Read back `core.sh api sync.health '{"folder":"<RUN>/folder"}' | jq -c '{markerMissing, restorable, pendingSince}'`: it gave `markerMissing: true` (a backup core made has no app preferences), `restorable` with one `markedRead` for that chapter, and `pendingSince` set. Then copy the newest `miharchy-*.tachibk` into the folder as `app.mihon_<local time a few minutes ahead>.tachibk` (the phone restored it and backed up): `health` says `restored` = that export's name and `restorable: []`, and the next sync deletes `pending-since` and reports no changes. These last two steps have not run on core yet.

Window path: the same fixture plus `manga.update '{"ids":[<id>],"inLibrary":false}'` before the second sync, and meta `miharchy.syncFolder` set to the folder. Steps: `key("5")`, then `key("j")` up to `Settings.ROWS.map(function(r) { return r.key }).indexOf("syncHealth")`, wait ~6 s, log `settingsView.notes.syncHealth` and grab; `key("Enter")`, wait ~6 s, log `[syncView.open, syncView.mode, syncView.health.state, syncView.report]` and `Sync.healthLines(syncView.health.health)` and grab; `key("Esc")`; `root.run("sync.health")` opens it again. Proof: the row reads "Phone backup … · app settings off · 1 to restore, 1 by hand" in full (the value column cuts long text from the left, so keep it short), the panel lists "marked read" under "In Mihon, restore …" and "removed from the library" in red under "Repeat them in Mihon", and the app-settings hint comes first. `server.sh clean` keeps `$RUN/folder` and `$RUN/stage`: remove them before a new fixture, or old backups mix in.

## Hold and undo
A sync holds when it would remove at least 5 manga that are also at least 10% of the library, or mark at least 50 chapters unread (`holds` in `Merge.kt`). Fixture, with the sync folder in meta `miharchy.syncFolder`:
1. Six manga in the library (`source.popular`, `manga.update` with `inLibrary`). Write a good phone backup: `backup.export` into `$RUN/stage`, move the file into the sync folder as `phone1.tachibk`, and sync once, so both baselines exist.
2. `manga.update '{"ids":[<5 of the 6>],"inLibrary":false}'`, `backup.export` into `$RUN/stage` (rename it `phone2.tachibk`), then put the 5 back with `"inLibrary":true`. Copy `phone2.tachibk` into the sync folder last, so it is the newest.
3. `sync.run` with `"dryRun":true` lists the 5 removals in `changes`; a plain run answers `"held":true`, and the library, the folder and both baselines stay as they were.
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
Proof: `held` shows state `held` with the count lines, `after-esc` keeps 6, `library-after` is 1, `undo-path` ends in `sync/pre-sync.tachibk`, `library-final` is 6, and `core.sh api library.list '{}' | jq '.mangas | length'` reads 6. A further sync with `phone2.tachibk` still newest reports no changes and keeps 6. The `MarkUnread` branch needs a phone backup without chapters; `HoldTest` pins it.

## Sync on a new phone backup
With meta `miharchy.autoSync` "true", the bar mark starts the sync when a new phone backup lands (`docs/agents/plugin.md`). The trigger lives in the mark, which `drive.sh` does not run, so `plugin/tests/mark.test.js` proves it: the real `find` against temp folders and a temp `HOME` (newest old-enough phone backup, `miharchy-*` and files under 30 s skipped, nothing newer than the baseline) and the notification for each result. The mark checks against core's baseline (`<core data>/sync/phone-baseline.tachibk`, `Mark.phoneBaseline`) and syncs with `sync.run`; `plugin/tests/mark-core.test.js` runs that `find`.

## Gotchas
- Build fixture backups with the model classes in `sync/src/main/kotlin/eu/kanade/...` (see `sync/src/test`); a user's real backup holds personal data — counts only in any report, delete copies.
- Never build `sync/` inside an installed plugin clone (`~/.config/omarchy/plugins/miharchy`): the shell reloads the plugin on every write there.
