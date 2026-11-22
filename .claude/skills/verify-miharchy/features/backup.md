# Backups

The window makes a backup by hand, as Mihon's Create backup does, and core makes automatic ones. Both land in the backup folder: the Settings row "Backup folder" (setting `backupPath`), or core's own `$RUN/core/data/backups` when it is blank. The include rows ("Backups include categories", "chapters", "tracking", "history") are the settings `autoBackupIncludeCategories`, `…Chapters`, `…Tracking` and `…History`, and decide what both kinds hold. A core backup never holds core's settings or secret.

Automatic backups are core's own schedule (`core/.../Backups.kt`), set from Settings: "Automatic backups" (`backupInterval`, in days, 0 off), "Automatic backup time" (`backupTime`, HH:MM, local time) and "Keep automatic backups" (`backupTTL`, in days, 0 forever). Core names them `miharchy-auto-<yyyy-MM-dd_HH-mm-ss>.tachibk` and deletes only those names by age, so backups made by hand in the same folder stay. They run while the window is closed.

## Sub-features
- `backup.export '{"folder"?, "categories"?, "chapters"?, "tracking"?, "history"?}'` writes `miharchy-backup-<UTC yyyy-MM-dd_HH-mm-ss>.tachibk` and answers `{"file": ...}`; without them it takes the Settings rows. It refuses the sync folder and a folder that does not exist.
- The name starts with `miharchy-`, so a sync never takes it for a phone backup, and it does not match the export pattern, so a sync never prunes it.
- Settings refuses a backup folder equal to the sync folder, and a sync folder equal to the backup folder; the error shows under the row.

## How to get to it (user POV)
Palette (`:`) then "Create a backup", or Settings (`5`), the "Create a backup" row, Enter. Either way Settings shows the row with "writing", then "Wrote <file>" or core's message.

## Driving it with drive.sh
Create the backup folder first (`mkdir -p <scratch>/backups`): the row refuses a missing one with "<folder> is not a folder." Then:
```js
[
  [3000, function() { root.run("view.settings") }],
  [800, function() {
    for (var i = 0; i < Settings.ROWS.length; i++) if (Settings.ROWS[i].key === "backupPath") root.settingsCursor = i
    key("Enter")
  }],
  [500, function() { settingsView.editValue = "<scratch>/backups"; key("Enter") }],
  [1500, function() { root.run("backup.create") }],
  [12000, function() { log("backup", settingsView.backup); grab("wrote") }],
  [300, function() { done() }]
]
```
Read back: `core.sh api settings.get '{}' | jq -c '.settings | {backupPath, autoBackupIncludeChapters}'`, and the file in the folder. `gunzip -c <file> | grep -a -o '/chapter/' | wc -l` counts MangaDex chapter URLs: 0 with "Backups include chapters" off. Recipe that ran on 2026-11-22: `core.sh api backup.export '{"folder":"<RUN>/stage"}'` answered `{"file":"<RUN>/stage/miharchy-backup-2026-11-22_23-47-22.tachibk"}`.

Automatic backups: set "Automatic backup time" two minutes ahead (compute it in the step: `new Date(Date.now() + 120000)`), then poll the backup folder from the shell for `miharchy-auto-*`. Core reads the settings on each tick; no restart. Check the sync folder stays empty of them.

The lock: core runs one sync, import or backup at a time. A `backup.export` sent while a `sync.run` runs answers "A sync is already running."; an automatic backup then waits for the next tick.
