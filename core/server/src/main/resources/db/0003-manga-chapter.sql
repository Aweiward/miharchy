-- Mihon's manga and chapter tables, as of mihonapp/mihon@1ed58f5e27f81e5bbabfd7de153e84c8ce08a3d4
-- (data/src/main/sqldelight/tachiyomi/data/manga.sq, chapter.sq). Defaults are added, so a row from a
-- listing needs only its source, url and title. Times are epoch milliseconds; remote_memo is JSON text.
CREATE TABLE manga (
    id INTEGER NOT NULL PRIMARY KEY,
    source_id INTEGER NOT NULL,
    remote_url TEXT NOT NULL,
    remote_title TEXT NOT NULL,
    remote_author TEXT,
    remote_artist TEXT,
    remote_description TEXT,
    remote_genre TEXT,
    remote_status INTEGER NOT NULL DEFAULT 0,
    remote_cover TEXT,
    remote_update_strategy INTEGER NOT NULL DEFAULT 0,
    remote_memo TEXT NOT NULL DEFAULT '{}',
    user_favorite_at INTEGER,
    user_notes TEXT NOT NULL DEFAULT '',
    user_reader_flags INTEGER NOT NULL DEFAULT 0,
    user_chapter_flags INTEGER NOT NULL DEFAULT 0,
    state_chapter_last_update INTEGER,
    state_chapter_next_update INTEGER,
    state_chapter_fetch_interval INTEGER NOT NULL DEFAULT 0,
    state_cover_last_modified INTEGER,
    state_initialized INTEGER NOT NULL DEFAULT 0,
    UNIQUE (source_id, remote_url)
);
CREATE TABLE chapter (
    id INTEGER NOT NULL PRIMARY KEY,
    manga_id INTEGER NOT NULL,
    remote_url TEXT NOT NULL,
    remote_name TEXT NOT NULL,
    remote_scanlator TEXT,
    remote_chapter_number REAL NOT NULL,
    remote_date_upload INTEGER,
    remote_order INTEGER NOT NULL,
    remote_memo TEXT NOT NULL DEFAULT '{}',
    user_read INTEGER NOT NULL DEFAULT 0,
    user_bookmark INTEGER NOT NULL DEFAULT 0,
    user_last_page_read INTEGER NOT NULL DEFAULT 0,
    state_date_fetch INTEGER NOT NULL,
    UNIQUE (manga_id, remote_url),
    FOREIGN KEY (manga_id) REFERENCES manga (id) ON DELETE CASCADE
);
CREATE INDEX chapter_manga_id_index ON chapter (manga_id);
