-- Mihon's category, manga_category and history tables, as of mihonapp/mihon@1ed58f5e27f81e5bbabfd7de153e84c8ce08a3d4
-- (data/src/main/sqldelight/tachiyomi/data/category.sq, manga_category.sq, history.sq), plus the state Mihon keeps
-- elsewhere (ADR 0010):
-- - category.include_in_update and include_in_download: Suwayomi's UNSET, INCLUDE or EXCLUDE. Mihon keeps them as
--   sets of category ids in its preferences; flags stays Mihon's sort flags.
-- - chapter.page_count: Suwayomi's pageCount, set when core fetches a chapter's pages.
-- AUTOINCREMENT, so a deleted category's id never comes back: metas and settings hold category ids.
-- Category 0 is Mihon's Default, which core never deletes or renames.
CREATE TABLE category (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    `order` INTEGER NOT NULL UNIQUE,
    flags INTEGER NOT NULL DEFAULT 0,
    include_in_update TEXT NOT NULL DEFAULT 'UNSET' CHECK (include_in_update IN ('UNSET', 'INCLUDE', 'EXCLUDE')),
    include_in_download TEXT NOT NULL DEFAULT 'UNSET' CHECK (include_in_download IN ('UNSET', 'INCLUDE', 'EXCLUDE'))
);
INSERT INTO category (id, name, `order`, flags) VALUES (0, '', -1, 0);
CREATE TABLE manga_category (
    manga_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    UNIQUE (manga_id, category_id),
    FOREIGN KEY (category_id) REFERENCES category (id) ON DELETE CASCADE,
    FOREIGN KEY (manga_id) REFERENCES manga (id) ON DELETE CASCADE
);
CREATE TABLE history (
    id INTEGER NOT NULL PRIMARY KEY,
    manga_id INTEGER NOT NULL,
    chapter_id INTEGER NOT NULL UNIQUE,
    read_at INTEGER,
    read_duration INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (manga_id) REFERENCES manga (id) ON DELETE CASCADE,
    FOREIGN KEY (chapter_id) REFERENCES chapter (id) ON DELETE CASCADE
);
CREATE INDEX history_read_at_index ON history (read_at);
ALTER TABLE chapter ADD COLUMN page_count INTEGER NOT NULL DEFAULT 0;
