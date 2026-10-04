# A Kotlin CLI helper owns the sync merge

Suwayomi's restore replaces categories and never deletes, so it cannot apply the merge rules in ADR 0002. Miharchy therefore merges itself. A small Kotlin/JVM CLI parses the phone backup, diffs each side against its own baseline (the desktop side read over GraphQL), applies the merge as GraphQL mutations, then writes a fresh `createBackup` export and moves both baselines forward. It is Kotlin so that it can copy Mihon's `@ProtoNumber` backup model classes as the schema, and Java 21 is already required by Suwayomi.

## Considered Options

- Suwayomi's `restoreBackup`. Rejected: removals never propagate and categories are overwritten.
- Go or Python helper with a hand-written `.proto`. Rejected: the schema could drift from Mihon's classes.
- Merge in QML JavaScript. Rejected: it has no gzip or protobuf, and the merge needs real tests.
