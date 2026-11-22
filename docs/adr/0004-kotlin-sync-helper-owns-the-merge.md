# A Kotlin CLI helper owns the sync merge

Suwayomi's restore replaces categories and never deletes, so it cannot apply the merge rules in ADR 0002 on its own. Miharchy therefore merges itself. A small Kotlin/JVM CLI parses the phone backup, diffs each side against its own baseline (the desktop side read over GraphQL), and computes a typed change set with a pure merge function. It is Kotlin so that it can copy Mihon's `@ProtoNumber` backup model classes as the schema, and Java 21 is already required by Suwayomi.

The helper applies the change set without contacting any source, as Mihon's own restore does, so a source that is down never blocks a sync. Changes that only raise a value (new chapters, read, bookmarked, a higher last page) go through one Suwayomi `restoreBackup` built from a filtered backup, because that restore inserts and merges chapters from the backup data with no network calls. Changes that lower a value (unread, bookmark removed, a lower last page), library removals and categories go through GraphQL mutations. Suwayomi's restore reports success even when a manga fails, so the helper re-reads the desktop and checks every change before the baseline moves.

Tracks follow the same split, and nothing reaches a tracker. The restore (`includeTracking: true`) inserts a new track whole and, on an existing one, sets only the remote and library ids and the higher chapters read (`BackupMangaHandler.restoreMangaTrackerData`); it calls no tracker and needs no login. `updateTrack` and `bindTrack` push to the tracker, so the helper never uses them. A track the restore cannot reach (an unbind, or a changed status, score, date or entry) is first unbound with `unbindTrack` and `deleteRemoteTrack: false`, which only deletes the desktop row; the restore then inserts the merged track whole.

## On miharchy-core (#369)

Core owns its database, so the split between `restoreBackup` and GraphQL mutations goes away there. Core runs the same `merge()` (`sync/`'s `Merge.kt`, through a composite build), then applies each change exactly with SQL, in one transaction with the export for the phone:

- A chapter the desktop lacks comes from the phone backup's own record, and a manga the desktop never saw comes in whole from it, chapters and history included. No source is asked for either.
- A track is written whole, and an unbind deletes only core's record. No tracker is called, and no track gets a new record id.
- Lowered values (unread, bookmark removed, a lower last page) are set directly, with no reset to 0 first.
- After the changes, core reads its library again and checks every change, as the helper does. A miss rolls the whole transaction back, so the baselines stay and the next sync retries.

The helper and its Suwayomi path stay until #373 moves `sync/` into `core/`.

## Considered Options

- Suwayomi's `restoreBackup` as the whole sync. Rejected: removals never propagate and categories are overwritten.
- GraphQL mutations for everything. Rejected: inserting a missing chapter and setting the last page on an unfetched chapter both need the source.
- Go or Python helper with a hand-written `.proto`. Rejected: the schema could drift from Mihon's classes.
- Merge in QML JavaScript. Rejected: it has no gzip or protobuf, and the merge needs real tests.

## Consequences

On core, neither consequence below applies: core overwrites no manga fields and gives no track a new id.

- Each restored manga gets some fields overwritten from the phone (status, update strategy, date added) and its cached cover cleared.
- A track replaced by unbind and insert gets a new record id. If the restore fails between the two, the track is gone until the next sync binds it again from the phone, with the phone's values.
