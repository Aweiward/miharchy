-- Until #429 core stored downloadsPath but always used <data>/downloads (the move from Suwayomi also copied
-- Suwayomi's own value). Blank is what core used, so a stored value must not move core's folder now.
DELETE FROM metas WHERE scope = 'global' AND owner = 0 AND key = 'miharchy.downloadsPath';
