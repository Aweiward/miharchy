# Tracker recommendations in pinned sources (2026-10-10)

Question: can Browse offer "manga like this one" from AniList or MyAnimeList, and then find each title in the pinned sources? Miharchy keeps no catalog of its own and adds no extension repo.

Answer: yes, through AniList's public API, with no tracker login. The pitch assumed a logged-in tracker. That assumption fails twice: Suwayomi exposes no recommendations and no token, and the user's own library has no tracks. A title match on AniList is enough to start from, and the existing global search finds most recommended titles.

## Method

1. Read the pinned Suwayomi-Server (r2244) jar for a recommendation call and for token fields.
2. Call AniList, MyAnimeList and Jikan for the recommendations of one manga (One Piece).
3. Read the real library read-only over GraphQL: trackers, tracks, pinned sources, titles.
4. Match 12 random library titles on AniList by title (`Media(search:)`), and take up to 5 recommendations each.
5. Search 10 of those recommended titles in AllManga and Mangago, the two sources with the most library manga, through `fetchSourceManga` SEARCH. This ran on the real server, and Suwayomi stored each manga a search returned as a non-library row.

## Results

| Check | Result |
|---|---|
| Suwayomi recommendation call | none |
| Suwayomi tracker token in GraphQL | none (`TrackerType`: id, name, icon, authUrl, isLoggedIn, isTokenExpired, supports…) |
| `TrackRecordType.remoteId` | yes: a track gives the tracker's id directly |
| AniList `Media.recommendations`, no login | works; rate limit 30 requests a minute |
| MyAnimeList API v2, no client id | HTTP 403 |
| Jikan (unofficial MAL proxy) | timed out twice (133 s, 20 s) |
| Real library | 217 manga, 0 tracks, no tracker logged in, no pinned sources |
| AniList title match | 8 of 12 found, all 8 correct |
| Recommendations per match | 5, 5, 5, 5, 5, 2, 1 and 5 |
| Recommended title found in AllManga or Mangago | 8 of 10 (one more is likely, under another name) |
| Recommended title already in the library | 1 of 10 |

The 4 titles with no AniList match are long light-novel titles and one adult title.

## Findings

- **The seed is a title, not a login.** A track's `remoteId` is the best seed when it exists. Without one, an AniList title search matched every title it found correctly in this sample. MyAnimeList adds nothing without a client id, and Jikan timed out twice here; it was not retested from another network.
- **The window would talk to the internet directly.** Today the window talks only to localhost. An AniList call from the window is a new trust boundary and needs an ADR. It sends only titles or AniList ids, never a credential.
- **Search must try more than one name.** The source's top result was the right manga in only 5 of 10 AllManga searches. "Return of the Blossoming Blade" is "Return of the Mount Hua Sect" on Mangago. AniList gives the English title, the romaji title and synonyms, so a search can try each. `Migrate.similarity` (threshold 0.4) can pick the match, as the library check already does.
- **Recommendations need filters.** Clayman's Revenge returned 5 spin-offs of its own franchise. One recommendation was already in the library under the same title; Mangago lists it under another name. Drop titles already in the library and titles from the same franchise (AniList `relations`).
- **Pinned only does not fit this user yet.** The user has no pinned sources. Global search already has a pinned-only filter (`p`). The feature should start where global search starts, not force pinned only.
- **Searching every recommendation at once is costly.** 5 recommendations × 2 sources took 10 searches for one manga. Searching on Enter, one title at a time, keeps the cost to what the user asks for.

## Open decisions

These wait for a grilling session:

1. The seed: one manga ("more like this") or the whole library ranked.
2. Where it lives: a key on the manga detail, or a section in Browse.
3. The term: **Recommendation**, to add to `GLOSSARY.md` when the plan settles.
4. The ADR for the window's first outside call.
5. Does every tracker go through AniList, or does MangaUpdates keep its own recommendations? See the next section.

## The other trackers (2026-10-10)

Question: can a track on MyAnimeList, Kitsu, MangaUpdates, Shikimori or Bangumi start a recommendation too?

Answer: yes for four of the five, with no login. A track gives the tracker's id (`remoteId`), and each tracker except Bangumi leads to AniList or has its own list. A login does not open anything new: the server keeps the token, and none of these trackers offers a personal manga feed.

| Tracker | Own recommendations, no login | Path to AniList | Verdict |
|---|---|---|---|
| AniList | `Media.recommendations` | itself | ✓ |
| MyAnimeList | API v2 needs a client id (403); Jikan timed out 3 times | `Media(idMal:)` answered for id 13 | ✓ through AniList |
| Kitsu | none: no recommendation relation on a manga | `/manga/{id}/mappings` gives the MAL and AniList ids | ✓ through AniList |
| MangaUpdates | `/v1/series/{id}`: `recommendations` (5) and `category_recommendations` (5) | none in the reply | ✓ its own list |
| Shikimori | `/api/mangas/{id}/similar` (86 for One Piece); the host moved to `shikimori.io` | its ids are MAL ids (`myanimelist_id` 13 for One Piece), so `Media(idMal:)` | ✓ either way; the API needs a `User-Agent` |
| Bangumi | none: `/v0/subjects/{id}/subjects` lists only relations (games, anime) | none | ✗ falls back to a title search on AniList |

### Findings

- **The login matters only for tracks.** Suwayomi's `searchTracker` refuses a tracker that is not logged in (`Tracker needs to be logged-in to search`). So the window cannot ask the server for a tracker's id without a login. With a login, the server finds the tracker's id for a manga that has no track yet, on localhost, and only the recommendations call leaves the machine. Without one, the window searches AniList by title itself. A track already carries the id, and binding a track needs the login anyway.
- **AniList can be the one engine.** MAL, Kitsu and Shikimori ids all lead to an AniList id. Asking AniList alone keeps the new trust boundary to one host and one rate limit. Kitsu's mapping costs one extra request.
- **MangaUpdates is the only real second opinion.** Its user recommendations overlap AniList's for One Piece (Naruto, Bleach). Its category recommendations are noisier: 2 of 5 were novels.
- **Order of seeds.** For one manga: an AniList track, then a MAL or Shikimori track, then a Kitsu track, then a MangaUpdates track, then a title search on AniList. Bangumi and untracked manga take the title search.
- **Not measured.** Rate limits for Kitsu, MangaUpdates and Shikimori. Whether Suwayomi's MangaUpdates `remoteId` is the numeric `series_id` that `/v1/series/{id}` takes, which needs a scratch server with a MangaUpdates login.
