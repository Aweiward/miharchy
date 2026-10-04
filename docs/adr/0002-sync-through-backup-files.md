# Sync with stock Mihon through backup files in a shared folder

Stock Mihon has no sync API. Its maintainers closed the SyncYomi pull request in September 2026 and plan their own sync. Until then, the only two-way channel with stock Mihon is its `.tachibk` backup. Mihon can write backups on a schedule to a folder. Miharchy syncs by merging the newest backup from that folder and writing a merged backup back. The user picks the transport, for example Syncthing.

## Considered Options

- Require a fork (Komikku or TachiyomiSY) with SyncYomi. Rejected: the target is stock Mihon.
- Trackers only. Rejected: they carry chapter progress, not the library or categories.

## Consequences

- Sync is on demand, not live.
- Sync is asymmetric. Phone to desktop is full fidelity. Desktop to phone needs a manual restore in Mihon, and Mihon's restore ORs "in library" and "read". So desktop removals and unread marks never reach the phone. After each sync, Miharchy lists those changes so the user can repeat them on the phone.
- When Mihon ships its own sync, this ADR gets revisited.

## Merge rules

Mihon restores only by hand, so a backup Miharchy writes may never reach the phone. One shared base would then misread "the phone never got it" as "the phone removed it". So each side has its own **baseline**: the phone baseline is the last phone backup Miharchy ingested, and the desktop baseline is the last backup Miharchy exported. A side's changes are its current state minus its own baseline.

- Changed on one side only: that change wins.
- Changed on both sides: read beats unread, the last page read takes the higher value, and categories take the union.
- A library removal propagates only if the other side did not change that manga.

Backups carry no per-chapter modified time (Mihon commented out `lastModifiedAt`), so these rules never compare timestamps.
