# A Kotlin CLI helper owns the sync merge

Suwayomi's restore replaces categories and never deletes, so it cannot apply the merge rules in ADR 0002 on its own. Miharchy therefore merges itself. A small Kotlin/JVM CLI parses the phone backup, diffs each side against its own baseline (the desktop side read over GraphQL), and computes a typed change set with a pure merge function. It is Kotlin so that it can copy Mihon's `@ProtoNumber` backup model classes as the schema, and Java 21 is already required by Suwayomi.

The helper applies the change set without contacting any source, as Mihon's own restore does, so a source that is down never blocks a sync. Changes that only raise a value (new chapters, read, bookmarked, a higher last page) go through one Suwayomi `restoreBackup` built from a filtered backup, because that restore inserts and merges chapters from the backup data with no network calls. Changes that lower a value (unread, bookmark removed, a lower last page), library removals and categories go through GraphQL mutations. Suwayomi's restore reports success even when a manga fails, so the helper re-reads the desktop and checks every change before the baseline moves.

Tracks follow the same split, and nothing reaches a tracker. The restore (`includeTracking: true`) inserts a new track whole and, on an existing one, sets only the remote and library ids and the higher chapters read (`BackupMangaHandler.restoreMangaTrackerData`); it calls no tracker and needs no login. `updateTrack` and `bindTrack` push to the tracker, so the helper never uses them. A track the restore cannot reach (an unbind, or a changed status, score, date or entry) is first unbound with `unbindTrack` and `deleteRemoteTrack: false`, which only deletes the desktop row; the restore then inserts the merged track whole.

## Considered Options

- Suwayomi's `restoreBackup` as the whole sync. Rejected: removals never propagate and categories are overwritten.
- GraphQL mutations for everything. Rejected: inserting a missing chapter and setting the last page on an unfetched chapter both need the source.
- Go or Python helper with a hand-written `.proto`. Rejected: the schema could drift from Mihon's classes.
- Merge in QML JavaScript. Rejected: it has no gzip or protobuf, and the merge needs real tests.

## Consequences

- Each restored manga gets some fields overwritten from the phone (status, update strategy, date added) and its cached cover cleared.
- A track replaced by unbind and insert gets a new record id. If the restore fails between the two, the track is gone until the next sync binds it again from the phone, with the phone's values.
