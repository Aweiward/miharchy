-- #367: the download queue and downloaded chapters (ADR 0010).
-- - chapter.download_path: the chapter's .cbz, relative to the downloads folder, set once the file is complete.
--   Mihon finds downloads by scanning the disk; core keeps the path, so a manga renamed by a refresh keeps its file.
-- - download_queue: the queue in order. A running download is in memory only, so a restart finds it QUEUED.
ALTER TABLE chapter ADD COLUMN download_path TEXT;
CREATE TABLE download_queue (
    chapter_id INTEGER NOT NULL PRIMARY KEY,
    position INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'QUEUED' CHECK (state IN ('QUEUED', 'ERROR')),
    tries INTEGER NOT NULL DEFAULT 0,
    error_kind TEXT,
    error_message TEXT,
    FOREIGN KEY (chapter_id) REFERENCES chapter (id) ON DELETE CASCADE
)
