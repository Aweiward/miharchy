-- Miharchy's metas, with the scopes and keys it keeps on Suwayomi today (ADR 0010).
-- A global meta has owner 0; a manga or category meta has that row's id.
CREATE TABLE metas (
    scope TEXT NOT NULL CHECK (scope IN ('global', 'manga', 'category')),
    owner INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (scope, owner, key)
);
