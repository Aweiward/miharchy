# Miharchy

Miharchy is a manga reader for Omarchy. It reads from Mihon's extension ecosystem and shares a library with Mihon on a phone.

## Language

### Content

**Source**:
One website that serves manga, as exposed by an extension.
_Avoid_: site, provider

**Extension**:
A package from a Mihon extension repo that provides one or more sources.
_Avoid_: plugin, addon

**Extension repo**:
A published index of extensions that the user adds by URL.
_Avoid_: store, registry

**Manga**:
One title from a source, with its metadata and chapters.
_Avoid_: entry, series, comic, title

**Chapter**:
One readable unit of a manga, made of pages.
_Avoid_: episode, issue

### Library

**Library**:
The set of manga the user follows.
_Avoid_: favorites, collection, shelf

**Category**:
A user-made group in the library. A manga can belong to several categories.
_Avoid_: folder, tag, shelf

**Read state**:
Whether a chapter is read, whether it is bookmarked, and the last page read in it.
_Avoid_: progress (alone), history

**History**:
The time-ordered log of chapters the user opened.
_Avoid_: recent, read state

**Update**:
A new chapter found for a manga in the library.
_Avoid_: notification, release

**Download**:
A chapter stored on disk for offline reading.
_Avoid_: cache, offline copy

### Sync

**Backup**:
A Mihon-format `.tachibk` file that holds a library snapshot.
_Avoid_: export, dump

**Sync folder**:
A folder that both Mihon and Miharchy can reach, used to exchange backups.
_Avoid_: shared drive, cloud

**Baseline**:
The last backup seen from one side: for the phone, the last phone backup ingested; for the desktop, the last backup exported. Each side has its own.
_Avoid_: sync base, snapshot, last backup

**Sync**:
A user-started exchange of backups through the sync folder, which merges in both directions.
_Avoid_: restore, import (these mean one-way overwrite)

### Surfaces

**Mark**:
Miharchy's item in the Omarchy bar, showing the unread update count and server status.
_Avoid_: icon, widget

**Popup**:
The small view under the mark, with recent updates and the sync button.
_Avoid_: panel, dropdown

**Window**:
The full Miharchy window, with the views and the reader.
_Avoid_: panel, client, app

**View**:
One screen of the window: Library, Updates, History, Browse or Settings. Exactly one view shows at a time.
_Avoid_: tab, page, mode

**Setup**:
The window screen that checks and prepares what Miharchy needs, one confirmed step at a time. It is not one of the views.
_Avoid_: onboarding, wizard, installer

**Reader**:
The surface that shows a chapter's pages over the window.
_Avoid_: viewer

**Reading mode**:
How the reader lays out pages: paged left-to-right, paged right-to-left, or webtoon (one vertical strip).
_Avoid_: layout, direction

## Relationships

- An **extension** provides one or more **sources**. A **source** serves many **manga**.
- A **manga** in the **library** belongs to zero or more **categories**.
- Each **chapter** has one **read state**. Opening a chapter adds a **history** entry.
- **Sync** finds each side's changes against that side's **baseline**, merges them into the desktop library, then writes a new **backup** to the **sync folder**. Both **baselines** then move forward.

- The **mark** opens the **popup**. The **popup** and the **mark** can open the **window**.
- Each **manga** has one **reading mode**, which defaults from its source.

## Flagged ambiguities

- Mihon calls a manga an "entry" in places. Resolved: Miharchy says **manga**.
- "Sync" can mean live sync, as in SyncYomi. Resolved: in v1 **sync** means the user-started backup exchange only.
- "Page" means one image of a chapter. Resolved: a screen of the window is a **view**, never a page.
- "Default" is a category in Suwayomi (id 0) and in Mihon's UI. Resolved: Default means a manga is in no **category**; it is never a user category, and the Library shows it only once user categories exist.
- "Base" first meant one backup shared by both sides. Resolved: each side has its own **baseline**, because the phone may never restore what the desktop wrote.
