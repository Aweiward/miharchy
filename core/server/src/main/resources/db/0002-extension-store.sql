-- Extension repos, as Mihon's extension_store (data/src/main/sqldelight/tachiyomi/data/extension_store.sq)
-- and BackupExtensionStore. index_url is the repo's index.json. signing_key is pinned when the repo is added.
CREATE TABLE extension_store (
    index_url TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    badge_label TEXT NOT NULL,
    signing_key TEXT NOT NULL,
    contact_website TEXT NOT NULL,
    contact_discord TEXT,
    is_legacy INTEGER NOT NULL,
    extension_list_url TEXT
);
