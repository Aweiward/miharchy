# Backups

The window makes a backup by hand, as Mihon's Create backup does, and Suwayomi makes automatic ones. Both land in the backup folder: the Settings row "Backup folder" (server setting `backupPath`), or the server's own `<root>/backups` when it is blank. The include rows ("Backups include categories", "chapters", "tracking", "history") are Suwayomi's `autoBackupInclude*` settings and decide what both kinds hold. Server settings never go in a backup made by hand, and saving the backup folder turns them off for automatic ones (`autoBackupIncludeServerSettings: false`): they hold the server password.

Automatic backups are Suwayomi's own schedule, set from Settings: "Automatic backups" (`backupInterval`, in days, 0 off), "Automatic backup time" (`backupTime`, HH:MM, local time) and "Keep automatic backups" (`backupTTL`, in days, 0 forever). Suwayomi names them `org.suwayomi.tachidesk.auto*_<yyyy-MM-dd_HH-mm>.tachibk` and deletes only its own names by age, so backups made by hand in the same folder stay.

## Sub-features
- `miharchy-sync backup <folder>` writes `miharchy-backup-<UTC yyyy-MM-dd_HH-mm-ss>.tachibk` under `sync.lock` and prints `{"file": ...}`. It refuses the sync folder.
- The name starts with `miharchy-`, so a sync never takes it for a phone backup, and it does not match the export pattern, so a sync never prunes it.
- Settings refuses a backup folder equal to the sync folder, and a sync folder equal to the backup folder; the error shows under the row.

## How to get to it (user POV)
Palette (`:`) then "Create a backup", or Settings (`5`), the "Create a backup" row, Enter. Either way Settings shows the row with "writing", then "Wrote <file>" or the helper's message.

## Driving it with drive.sh
The window runs the helper Setup installs under `$HOME`; `drive.sh` gives it `$RUN/home`; install the checkout's build there, as `restore.md` shows. Then:
```js
[
  [3000, function() { root.run("view.settings") }],
  [800, function() {
    for (var i = 0; i < Settings.ROWS.length; i++) if (Settings.ROWS[i].key === "backupPath") root.settingsCursor = i
    key("Enter")
  }],
  [500, function() { settingsView.editValue = "<scratch>/backups"; key("Enter") }],
  [1500, function() { root.run("backup.create") }],
  [12000, function() { log("backup", settingsView.backup); grab("wrote"); done() }]
]
```
Read back: `settings { backupPath autoBackupIncludeServerSettings }`, and the file in the folder. `gunzip -c <file> | grep -a -o '/chapter/' | wc -l` counts MangaDex chapter URLs: 0 with "Backups include chapters" off.

Automatic backups: set "Automatic backup time" two minutes ahead (compute it in the step: `new Date(Date.now() + 120000)`), then poll the backup folder from the shell for `org.suwayomi.tachidesk.auto*`. Suwayomi reschedules on the settings change; no restart. Check the sync folder stays empty of them.

The lock: the JVM takes a POSIX (fcntl) lock, which `flock(1)` does not see. Hold `sync.lock` with `python3 -c 'import fcntl,sys,time; f=open(sys.argv[1],"w"); fcntl.lockf(f, fcntl.LOCK_EX); time.sleep(20)' <home>/.local/share/miharchy/sync/sync.lock &`, then run the helper: "A sync is already running."
