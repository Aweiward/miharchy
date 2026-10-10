# Page bookmarks (2026-10-10)

Question: where can a bookmark on one page of a chapter live, and can any path carry it to stock Mihon? Chapter bookmarks are part of the **read state** and already sync.

Answer: chapter meta in Suwayomi is the natural home, and it works today with no server change. No Mihon backup field carries a page bookmark: Mihon has no such feature and refused it twice, and Mihon's parser drops a field it does not know. One path does survive a phone round trip: an app preference, the same path as the restore marker (ADR 0006). It can only carry the bookmarks as a copy; the phone can never show or change them. Chapter meta also stays out of every backup Miharchy writes: those backups leave out client data and re-encode through Mihon's classes. So a desktop-only page bookmark is lost on a server rebuild from a backup, unless Miharchy decides to carry it.

## Method

1. Read the pinned Suwayomi-Server jar (r2244) read-only with `unzip -l`, `unzip -p` and `strings`: GraphQL meta mutations, `ChapterType`, the backup models, `ChapterMetaTable`, `Chapter`.
2. Read Suwayomi-Server upstream (master) for the backup handler and the chapter refresh. Master is multi-user and differs from r2244 in places; the table marks which version each row comes from.
3. Read Mihon upstream (master and tag `v0.20.4`) for the backup model, the restore, the chapter refresh, and the preference backup and restore.
4. Read kotlinx.serialization's protobuf decoder for unknown fields.
5. Searched the issues of Mihon, TachiyomiSY and Komikku for page bookmarks.
6. Read Miharchy's `window/` and `sync/` for meta use, the reader's page model and the backup flags.

Nothing ran against a server. No GraphQL call was made.

## Results

| Check | Pinned r2244 | Upstream |
|---|---|---|
| `setChapterMeta`, `setChapterMetas`, `deleteChapterMeta(s)` | yes (`ChapterMutation.class`) | yes |
| `ChapterType.meta` | yes (`ChapterMetaDataLoader`) | yes |
| Chapter meta deleted with its chapter | yes (`ChapterMetaTable`: `chapter_ref`, `CASCADE`) | yes (`ChapterMetaTable.kt:31`) |
| A chapter the source drops keeps its read and bookmark under its chapter number | yes (`deletedReadChapterNumbers`, `deletedBookmarkedChapterNumbers` in `Chapter.class`) | yes, plus `lastPageRead` (`Chapter.kt:229-260`) |
| …and keeps its chapter meta | no such carry found | no |
| Suwayomi backup carries chapter and manga meta | `meta` field present in `BackupChapter.class` and `BackupManga.class` | field 9000, only with `includeClientData` (`BackupMangaHandler.kt:117,153,520`) |
| Miharchy's backups include client data | no: `SYNC_FLAGS` and `backupFlags` set `includeClientData: false` (`sync/.../Desktop.kt:44-61`) | — |
| Miharchy's backups keep Suwayomi's field 9000 | no: the sync export and "Create a backup" both re-encode through Mihon's classes (`forMihon`, `Export.kt:73-75`; `Main.kt:190`) | — |
| Mihon `BackupChapter` fields | 1 url, 2 name, 3 scanlator, 4 read, 5 bookmark, 6 lastPageRead, 7 dateFetch, 8 dateUpload, 9 chapterNumber, 10 sourceOrder, 13 memo (`sync/.../models/BackupChapter.kt:12-30`) | master: same. `v0.20.4` (released): also 11 lastModifiedAt and 12 version, which master and the copy comment out; `memo` is in `v0.20.4` |
| Mihon keeps an unknown proto field | no: kotlinx `ProtobufDecoding.kt:339` skips it; restore maps to the database, export reads the database | — |
| Mihon chapter `memo` survives a phone round trip | lands on restore (`RestoreRepositoryImpl.kt:181`, local wins), then a library update replaces it with the source's (`SyncChaptersWithSource.kt:136`; `ShouldUpdateDbChapter.kt:15` fires on any memo difference) | — |
| Mihon app preference survives a phone round trip | yes: any `String` key restores (`PreferenceRestorer.kt`, `StringPreferenceValue` case) and backs up unless an app-state key (`PreferenceBackupCreator.kt:46`) | — |
| Page bookmarks in Mihon | none; #270 "No intention to implement" (2024-01-29); #2520 closed not planned (2025-09-22) | — |
| Page bookmarks in forks | TachiyomiSY #1479 open, no PR; Komikku #99 open, no PR; the Tachiyomi PR it names (9798 on git.mihon.tech) never merged, per the issue (not checked) | — |

## Findings

- **Chapter meta is the home.** It keys on the chapter id, which the reader holds. It needs no new server code. Miharchy uses manga meta and global meta today (`Prefs.js:19-20`, `History.js:24`), never chapter meta. A JSON list of page indexes under `miharchy.pageBookmarks` fits Prefs' existing `miharchy.<key>` pattern. Manga meta also works, keyed by chapter url, and loads for a whole manga in one query.
- **The reader knows a page by its index only.** `fetchChapterPages` returns server URLs of the shape `/api/v1/manga/{m}/chapter/{c}/page/{i}` (`Reader.js:10`, `tests/reader.test.js:16`). `lastPageRead` is that index. There is no page hash and no source page URL in the window.
- **A page bookmark breaks where Mihon's maintainers said it would.** In #2520 a triager asked: "what would happen if the chapter was replaced/you migrated to a different entry (with the same chapter name, with different page count…)". The cases:
  1. Re-fetched pages with a new count: the index can point at another page or past the end. Not measured how often sources do this.
  2. A chapter the source drops or re-uploads under a new URL: Suwayomi deletes the row, and the cascade deletes its chapter meta. Read and bookmark carry over by chapter number; meta does not.
  3. Migrate copies read and chapter bookmarks by chapter number (`Migrate.js:36-54`). It copies no chapter meta. Page indexes on another source rarely match.
  4. Deleting a download keeps the chapter row, so its meta stays.
- **No Mihon field can carry it.** An extra proto field dies on the phone's restore. `memo` is for sources ("Apps may define their own namespaced keys… for sources to populate", `SChapter.kt`), and the phone's next library update wipes a desktop key. Mihon has no page-bookmark plan.
- **An app preference can carry a copy.** The restore marker already rides this path (`Export.kt:79`). A second `BackupPreference` with a JSON blob, keyed by source id, manga url, chapter url and page index, would come back in each phone backup after a restore. It is one more list entry in the export. Limits: the phone never shows it; it comes back only after a restore; "App settings" off loses it; a missing key must never read as "all removed". Size limit of a Mihon string preference: not measured.
- **Desktop-only is safe from the sync today.** The sync's restore sends `includeClientData: false` (`Desktop.kt:313-314`), so it never touches chapter meta. A library removal only sets `inLibrary: false` (`Desktop.kt:265`), so chapters and their meta stay. The three-way merge never reads meta, so a page bookmark makes no change and no "repeat on the phone" line. The restore marker is not affected. A phone restore in Mihon never touches the desktop.
- **Desktop-only is not safe from a rebuild.** "Create a backup", "Restore a backup" and the `pre-sync.tachibk` undo all leave out client data. They also re-encode through Mihon's classes, which have no field 9000, so turning client data on would change nothing. They lose page bookmarks, and every other chapter, manga and global `miharchy.*` meta too. Notes survive only because `forMihon` maps them into Mihon's own field. Suwayomi's automatic backups (`org.suwayomi.tachidesk.auto*`) follow `autoBackupIncludeClientData` and skip the re-encode, so they may carry meta: not measured.
- **The UX has places to land.** `B` is free in the reader (`b` bookmarks the chapter, `Commands.js:248-251`). `S` and `Y` already act on the page shown. History lists chapters with `lastPageRead` and `pageCount` (`History.js:22`), so a bookmark list can reuse that row shape and open the reader at a page, as Up next does.

## Open decisions

These wait for a grilling session:

1. The key: chapter meta (dies with the chapter, no url) or manga meta keyed by chapter url (one query per manga, dangles when a chapter leaves).
2. What a bookmark stores beyond the index: page count at the time, a thumbnail, a note (Komikku #99 asks for notes). A stored count lets the reader say "pages changed".
3. Carry a copy through Mihon's app preferences, or stay desktop-only.
4. How a backup keeps them. Turning on client data does not work (the re-encode drops it). The options: map them into Mihon's backup as notes are mapped (an app preference, decision 3), or write a side file beside the backup.
5. What Migrate does: drop page bookmarks, or move them by chapter number and index with a warning.
6. Where the list lives: a section on the manga detail, a filter on History, or a palette view.
7. The term: **Page bookmark**, to add to `GLOSSARY.md` beside **read state** when the plan settles. It is not part of the read state.
