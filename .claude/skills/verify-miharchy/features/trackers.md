# Trackers

The tracking panel (`t` on a manga's detail, scopes `manga-track` and `manga-track-pick`): one row per tracker that is logged in or holds a track of the manga.

## Sub-features
- Enter finds the manga on the tracker (search, then pick); `s` status, `c` chapters read, `S` score; `x` stops tracking (Miharchy's record only).
- `d` / `D`: the start and finish dates, typed as `YYYY-MM-DD`, empty clears; only on a tracker with `supportsReadingDates`. `p`: private on or off, only with `supportsPrivateTracking`. Each is a `track.update`.
- `o` opens the track's `remoteUrl` with `xdg-open`, `y` copies it with `wl-copy`; both work on a logged-out tracker's track too.
- After a mark read (`R`, `P`, Updates, Library), Settings' "Update trackers when marking chapters read" (meta `miharchy.trackOnMarkRead`): always sends `track.progress`, never sends nothing, ask reads each manga's tracks and highest read chapter and, when a logged-in tracker is behind, shows "Update trackers to chapter N?" (or "Update trackers for N manga?") over the status bar (scope `track-ask`: `y` pushes, `n`/Esc keeps). "Update trackers after reading" (`miharchy.trackAfterReading`) gates the reader's push.

- Logins live in Settings, one row per tracker after "Clear the cache" (cursor `Settings.ROWS.length + 1 + i`). An OAuth tracker (one with an `authUrl`) asks core for a fresh link and opens it with `xdg-open`, then waits for the pasted address (`settingsView.trackers.login.step` is `"paste"`); a paste without `code=` (AniList: `access_token=`) shows "That address has no code=. ..." and sends nothing. Kitsu and MangaUpdates ask for a username and a password. Enter on a logged-in tracker logs out.

## How to get to it (user POV)
Library, Enter on a manga, `t`. Logins: Settings (`5`), the tracker rows at the end.

## Driving it with drive.sh
A scratch core has no tracker login. Seed a track record straight into `$RUN/core/data/core.db` (SKILL.md, miharchy-core); the rows then show, the link keys work, and a change says to log in. Read it back with `core.sh api track.list '{"mangaIds":[<id>]}' | jq -c '.tracks[] | {id, trackerId, remoteId, remoteUrl, lastChapterRead, private, startDate}'`. Build a write's body with `Trackers.act` in node and send it with `core.sh api track.update`. Core checks the login before the fields, so on a scratch core this proves only that the route and `recordId` resolve; the field names are in `Trackers.kt` (`change`). Recipe that ran on 2026-11-22: an AniList record for the seeded manga read back as `{"id":1,"trackerId":2,"remoteId":101010,"remoteUrl":"https://anilist.co/manga/101010","lastChapterRead":3.0,"private":false,"startDate":0}`, and `core.sh api track.update '{"recordId":1,"private":true}'` answered `{"error":{"kind":"invalid","message":"Log in to AniList first."}}`.

Never let `o` or `y` reach the desktop: put stub `xdg-open` and `wl-copy` that log their arguments first on `PATH` for `drive.sh`.
```js
[
  [5000, function() { mangaDetail.openManga(<a manga with track records>, false) }],
  [6000, function() { key("t") }],
  [3000, function() { log("rows", trackPanel.panel.rows.map(function(r) { return [r.tracker.name, r.record && r.record.url] })) }],
  [500, function() { key("y") }],
  [500, function() { log("note", trackPanel.note); done() }]
]
```

A login without an account, with `xdg-open` stubbed: pick the first tracker with an `authUrl` from `settingsView.trackers.list`, set `root.settingsCursor = Settings.ROWS.length + 1 + i`, Enter, wait 3 s; the stub got the link. Set the focused field (`find(settingsView, function(i) { return i.activeFocus && i.cursorPosition !== undefined })`) to `nope`, Enter, log `settingsView.trackers.login.error`, Esc. Never paste a real callback or send credentials: those reach the provider.

The push itself: on a logged-out tracker `track.progress` skips every track, changes no record and logs nothing. `core.sh api track.progress '{"mangaIds":[<id>]}' | jq -c '{tracks: [.tracks[] | {id, lastChapterRead}], failed}'` answered the records unchanged and `failed: []` on 2026-11-22. To see the window send it, run the drive through the logging proxy (SKILL.md, Live updates): it logs one `POST /api/track.progress` per push under always and none under never. The ask prompt needs a logged-in tracker to come up by itself; set `root.trackAsk = { mangaIds: [id], chapter: n }` to show it, then click the `y update` hint part (`hintBar.children`).

## Gotchas
- Never log in to a real tracker account from a verify run.
- A logged-out tracker's row says "log in under Settings to change it"; Enter, `x`, `d`, `D`, `p`, `s`, `c`, `S` answer with "Log in to ... under Settings first." (`Trackers.act`), so the window never sends a write for it; only `core.sh api track.update` reaches core's "Log in to <tracker> first." With no tracker logged in and no track, the panel has no rows and `y` says "This tracker has no link for the manga".
