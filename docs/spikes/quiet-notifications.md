# Quiet notifications (2026-10-10)

Question: can the new-chapter notification name only manga with unread progress, or manga the user asked about ("tell me"), while the mark count stays global?

Answer: yes, and the change is small. One function decides the notification (`Mark.notification`), and it is separate from the count. But the server is already mostly quiet: Suwayomi's skip filters are on by default, so a library update fetches chapters only for manga that are started, caught up and not completed. Under those defaults, every update from a library update already lands on a manga with progress. The noise must come from the skip filters being off on the real server (not measured), or from chapters that enter by other paths: a sync or restore, `fetchChapters` from the download menu, or a manga detail refresh. A notify-time filter in the mark covers all of these. "Started" (the manga has a read chapter) is the best definition. A "tell me" flag fits manga meta, which never syncs; that is fine, because Mihon has no such flag to sync with.

## Method

1. Read the mark (`plugin/Mark.js`, `plugin/Mark.qml`), `window/Updates.js`, `window/UpNext.js`, `window/Settings.js`, `window/NextChapters.js`, and the docs `plugin.md`, `library.md`, `sync.md`.
2. Read the backup model in `sync/` and how the sync maps categories and notes.
3. Read Suwayomi's `Updater.kt` on upstream master (`d4f88a3`). Checked that the pinned jar (r2244) has the skip filters in the same function (`Updater$addCategoriesToUpdateQueue$1.class` names `excludeNotStarted`). The jar was read as a file; the real server was not called.
4. Read Mihon's `LibraryUpdateWorker.kt`, `LibraryUpdateNotifier.kt` and `LibraryPreferences.kt` on main (`157679b`).
5. No live data. The test fixtures hold no library of real shape, so every count below is not measured.

## Results

### The flow today

```
 server schedule / u          other paths (sync, restore,
 updateLibrary                fetchChapters, detail refresh)
        │ skip filters               │ no filter
        ▼                            ▼
 new chapter rows (id grows, fetchedAt > inLibraryAt)
        │
        ▼  every 60 s, each bar
 Mark.qml poll ── Mark.listPayload (UPDATES_QUERY + meta notifyNewChapters)
        │
        ▼
 Mark.reduce: count = all unread updates; fresh = updates with id > top
        │                                  │
        ▼                                  ▼
 Mark.label (count beside the mark)  Mark.notification → notify-send (one per poll,
                                     marker file so one bar sends it)
```

| Part | Evidence |
|---|---|
| Sender | The mark only. `Mark.qml:104-105` calls `Mark.notification` after each poll and runs `Mark.notifyCommand` detached. |
| Poll | `Mark.qml:159-163`, once a minute, and when the popup opens. `Mark.listPayload` (`Mark.js:33-36`) is `Updates.UPDATES_QUERY` plus three global metas and `aboutServer`. |
| Data per update | `Updates.js:23-24`: every unread library chapter, with `manga { id title thumbnailUrl inLibraryAt }`. No read state of the manga, no meta, no categories. |
| What counts as an update | `Updates.recent` (`Updates.js:90-97`): fetched after the manga joined the library, uploaded in the last 3 months. The mark keeps the unread ones (`Updates.updates`, `:100-102`). The mark ignores the Updates view filters (`rows` without `prefs`, `:219`). |
| Count | `Mark.reduce` sets `count: rows.length` (`Mark.js:60`). `Mark.label` shows it (`:136-138`). Global, unchanged by notifications. |
| New | `fresh` = rows with `id > top` (`Mark.js:56-57`). The first answer only sets `top`, so a start never floods. |
| Grouping | One notification per poll (`Mark.js:71-82`): "N new chapters", up to 5 titles, then "and N more". The key is the newest chapter id; a marker file in `$XDG_RUNTIME_DIR/miharchy` stops the other bars (`:86-90`). Click opens Updates. |
| Setting | One: `notifyNewChapters`, "Notify about new chapters", global meta, on by default (`Settings.js:135`). |
| Other notifications | Auto-sync result (`Mark.syncNotification`, `Mark.js:121-133`). End of a download run (`NextChapters.notifyCommand`, `NextChapters.js:187-189`, sent from `DownloadsView.qml:104`). Neither has a notification setting, and neither is about new chapters. |
| Server skip filters | `excludeUnreadChapters`, `excludeNotStarted`, `excludeCompleted`, all on by default (`Settings.js:138-140`; the verify skill's `features/updates.md:57` saw them on in a fresh server). Suwayomi applies them to every library update, a category update too (`Updater.kt` master, lines 416-432). Only excluded categories are bypassed by `forceAll`. |

### Candidates for "unread progress"

| Candidate | How the mark computes it | Breaks on |
|---|---|---|
| A. Started: the manga has a read chapter | Add `lastReadChapter { id }` to the manga in `UPDATES_QUERY` (the library check already reads it, `LibraryCheck.js:18`, `:89`). Keep a `fresh` row when it is non-null. | A manga just added: silent until the user reads one chapter. A phone-only read: silent until the next sync brings it in. A re-read keeps it started (fine). A manga hidden on History: Up next counts it as never read (`UpNext.js:51-53`); the mark would not, unless it reads the same metas. |
| B. Caught up: every unread chapter of the manga is in `fresh` | Add `unreadCount` to the manga. Keep it when `unreadCount` equals its fresh rows. This is `excludeUnreadChapters` at notify time. | A one-chapter backlog silences the manga. A re-read (chapters marked unread) silences it. Two polls in one update run: the second poll sees the first batch as old unread, so it goes silent. |
| C. In Up next (tiers 1-2) or read in the last N days | Needs `UpNext.payload()` in the poll. | Cost: `plugin.md:7` keeps that reply (several MiB on a large library) out of the poll. Tier 3 is "a fresh update", so any new chapter would qualify its manga: only tiers 1-2 work. A manga read a year ago and caught up is silenced (maybe wanted). |

### Where a "tell me" flag could live

| Place | Precedent | Syncs to the phone? |
|---|---|---|
| Manga meta `miharchy.notify` | `miharchy.notes`, `miharchy.checkDismissed`, `miharchy.historyHiddenAt` | No. `BackupManga` has no meta field (`BackupManga.kt:16-50`). Notes sync only through a mapping of their own (`Desktop.kt:64`, `Export.kt:70`). |
| A category the user makes ("Tell me") | The Library's categories | Membership yes: the sync maps categories by name (`Library.kt:74-88`, `SetCategories` in `Merge.kt:29-30`). |
| Category meta `miharchy.notify` | `miharchy.keepDownloads`, `p` on Categories (`Categories.js:20`, `library.md:20`) | The flag no; membership yes. `BackupCategory` has only name, order, id and display flags (`BackupCategory.kt`). |

Mihon keeps its update include and exclude lists as app preferences (`library_update_categories`, `LibraryPreferences.kt:140-148`). Miharchy's desktop backup carries no app preference except its marker, so Suwayomi's `includeInUpdate` does not sync either.

### Mihon as a reference

- Mihon filters at fetch time, not at notify time. `LibraryUpdateWorker.addMangaToQueue` applies the included and excluded categories, then the restrictions (`library_update_manga_restriction`): completed, has unread (`manga_fully_read`), not started (`manga_started`), outside release period. All four are on by default (`LibraryPreferences.kt:52-59`).
- `LibraryUpdateNotifier.showUpdateNotifications` notifies every manga that got new chapters: one summary plus one notification per manga. It filters nothing. Its only preference is "hide notification content".
- Mihon has no per-manga or per-category notification flag. A "tell me" flag would be Miharchy's own.

## Findings

- **The filter has one home.** `Mark.notification` reads `mark.fresh`; the count reads `mark.count`. A filter on `fresh` leaves the count global, as the user wants. The decision belongs in pure JS (`Mark.js` or `Updates.js`) with a node test, as ADR 0003 and `AGENTS.md` ask. New mark code runs only after `omarchy-restart-shell`.
- **The default server settings already do most of it.** A library update skips manga not started and manga with unread chapters. So notifications from a library update already name started, caught-up manga. If the user sees noise, either the skip filters are off on the real server (not measured), or the noise comes from other paths.
- **Other paths notify with no filter.** A sync or restore that imports manga notifies (`plugin.md:8`). By code reading, `fetchChapters` from the download menu (`library.md:19`) and a manga detail refresh store new chapters with `fetchedAt` after `inLibraryAt`, so the next poll names them too. Not measured on a scratch server.
- **"Started" fits best.** It is the rule the server and Mihon already use (`excludeNotStarted`, `manga_started`), so notify and fetch agree. It costs one field per chapter row in a poll that already returns every unread chapter. "Caught up" is too fragile, and Up next is too costly for a poll.
- **The flag fits manga meta.** It is desktop-only, as the notification is. A category would sync, but it adds a Library tab. It is also the only shape that reaches the phone, where Mihon's own update categories could use it, if the user wants one list on both devices.
- **Counts were not measured.** No fixture has real shape. The one known number is 217 library manga (`tracker-recommendations.md`). To measure: over a week of updates, the share of unread updates on manga with `lastReadChapter` non-null, and how many updates came outside a library update.

## Not measured

- The real server's skip filter values.
- Whether marking a chapter read without opening it sets Suwayomi's `lastReadAt` (`excludeNotStarted` tests `lastReadAt`; a manga not yet `initialized` passes it).
- Whether a restore of phone history sets `lastReadChapter` for a phone-only read.
- How many notifications come from paths other than a library update.

## Open decisions

These wait for a grilling session:

1. The rule: "started" alone, or "started" plus the user's flag, or the flag alone.
2. The flag: an always-tell-me only, or also a never (mute a manga that is started).
3. The setting: replace `notifyNewChapters` (bool) with a choice (all, quiet, off), or add a second row.
4. Hidden on History: does a hidden manga count as started, as it does not in Up next?
5. Paths other than a library update: filter them the same way, or never notify them (a sync already sends its own notification).
6. The terms: what to call the flag and the mode in `GLOSSARY.md` ("notification" is an avoided word for **update**; the notification itself has no glossary term yet).
