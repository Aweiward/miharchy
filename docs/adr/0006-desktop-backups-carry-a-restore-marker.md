# Desktop backups carry a restore marker

Mihon records no trace of which backup it restored, and it never restores on its own. So each desktop backup carries one app preference, `miharchy_backup`, whose value is the desktop backup's own file name. Mihon's restore writes app preferences without a filter, and its backups (automatic ones too) carry them back by default. The newest phone backup therefore names the last desktop backup the phone restored. Sync health reads it to say whether the phone restored and whether it is **behind**.

## Considered Options

- Infer a restore from content: a desktop-only change that shows up in a later phone backup. Rejected: when the desktop changed nothing there is nothing to see, and the answer is a guess.

## Consequences

- Phones that restored a desktop backup keep the key in Mihon's preferences. Renaming or dropping it leaves stray keys behind, so the name stays.
- A user who turns off "App settings" in Mihon's backup options never sends the marker back. Sync health says so rather than claim the phone never restored.
- The key must not start with `__APP_STATE_` or `__PRIVATE_`: Mihon's backup leaves those out.
