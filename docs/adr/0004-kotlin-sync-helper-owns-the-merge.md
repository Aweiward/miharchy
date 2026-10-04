# A Kotlin CLI helper owns the sync merge

Suwayomi's restore replaces categories and never deletes, so it cannot apply the merge rules in ADR 0002 on its own. Miharchy therefore merges itself. A small Kotlin/JVM CLI parses the phone backup, diffs each side against its own baseline (the desktop side read over GraphQL), and computes a typed change set with a pure merge function. It is Kotlin so that it can copy Mihon's `@ProtoNumber` backup model classes as the schema, and Java 21 is already required by Suwayomi.

The helper applies the change set without contacting any source, as Mihon's own restore does, so a source that is down never blocks a sync. Changes that only raise a value (new chapters, read, bookmarked, a higher last page) go through one Suwayomi `restoreBackup` built from a filtered backup, because that restore inserts and merges chapters from the backup data with no network calls. Changes that lower a value (unread, bookmark removed, a lower last page), library removals and categories go through GraphQL mutations. Suwayomi's restore reports success even when a manga fails, so the helper re-reads the desktop and checks every change before the baseline moves.

## Considered Options

- Suwayomi's `restoreBackup` as the whole sync. Rejected: removals never propagate and categories are overwritten.
- GraphQL mutations for everything. Rejected: inserting a missing chapter and setting the last page on an unfetched chapter both need the source.
- Go or Python helper with a hand-written `.proto`. Rejected: the schema could drift from Mihon's classes.
- Merge in QML JavaScript. Rejected: it has no gzip or protobuf, and the merge needs real tests.

## Consequences

- Each restored manga gets some fields overwritten from the phone (status, update strategy, date added) and its cached cover cleared.
