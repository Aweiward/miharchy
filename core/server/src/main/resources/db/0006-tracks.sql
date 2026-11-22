-- #371: trackers (ADR 0010).
-- - manga_track: Mihon's table as of mihonapp/mihon@f8e30a86086020aaee1e89a9d015373b1a4ff026
--   (data/src/main/sqldelight/tachiyomi/data/manga_track.sq). start_date and finish_date are epoch ms, 0 for none.
-- - tracker_pref: each tracker's login state, Mihon's TrackPreferences per tracker (username, password, token, ...).
--   It holds tokens, so it lives only in core.db, in core's owner-only data folder, and no route returns it.
CREATE TABLE manga_track(
    id INTEGER NOT NULL PRIMARY KEY,
    manga_id INTEGER NOT NULL,
    tracker_id INTEGER NOT NULL,
    remote_id INTEGER NOT NULL,
    remote_url TEXT NOT NULL,
    library_id INTEGER,
    title TEXT NOT NULL,
    last_chapter_read REAL NOT NULL,
    total_chapters INTEGER NOT NULL,
    status INTEGER NOT NULL,
    score REAL NOT NULL,
    start_date INTEGER,
    finish_date INTEGER,
    private INTEGER NOT NULL DEFAULT 0,
    UNIQUE (manga_id, tracker_id),
    FOREIGN KEY(manga_id) REFERENCES manga (id)
    ON DELETE CASCADE
);
CREATE INDEX manga_track_tracker_id_remote_id_index ON manga_track(tracker_id, remote_id);
CREATE TABLE tracker_pref(
    tracker_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (tracker_id, key)
);
