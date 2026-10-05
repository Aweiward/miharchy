# Trackers

The tracking panel (`t` on a manga's detail, scopes `manga-track` and `manga-track-pick`): one row per tracker that is logged in or holds a track of the manga.

## Sub-features
- Enter finds the manga on the tracker (search, then pick); `s` status, `c` chapters read, `S` score; `x` stops tracking (Miharchy's record only).
- `d` / `D`: the start and finish dates, typed as `YYYY-MM-DD`, empty clears; only on a tracker with `supportsReadingDates`. `p`: private on or off, only with `supportsPrivateTracking`. Each is an `updateTrack`.
- `o` opens the track's `remoteUrl` with `xdg-open`, `y` copies it with `wl-copy`; both work on a logged-out tracker's track too.
- After a mark read (`R`, `P`, Updates, Library), Settings' "Update trackers when marking chapters read" (meta `miharchy.trackOnMarkRead`): always sends `trackProgress`, never sends nothing, ask reads each manga's tracks and highest read chapter and, when a logged-in tracker is behind, shows "Update trackers to chapter N?" (or "Update trackers for N manga?") over the status bar (scope `track-ask`: `y` pushes, `n`/Esc keeps). "Update trackers after reading" (`miharchy.trackAfterReading`) gates the reader's push.

- Logins live in Settings, one row per tracker after "Clear the cache" (cursor `Settings.ROWS.length + 1 + i`). An OAuth tracker (one with an `authUrl`) asks the server for a fresh link and opens it with `xdg-open`, then waits for the pasted address (`settingsView.trackers.login.step` is `"paste"`); a paste without `code=` (AniList: `access_token=`) shows "That address has no code=. ..." and sends nothing. Kitsu and MangaUpdates ask for a username and a password. Enter on a logged-in tracker logs out.

## How to get to it (user POV)
Library, Enter on a manga, `t`. Logins: Settings (`5`), the tracker rows at the end.

## Driving it with drive.sh
A scratch server has no tracker login, and every `updateTrack` calls the tracker, so a write fails there ("For input string" from the tracker's own code). Seed track records with a restored backup (see `migrate.md`); the rows then show, the link keys work, and a change says to log in. Prove a write's payload by building it with `Trackers.act` in node and sending it with `gql.sh`: the server must accept the input type and fail only inside the tracker.

Never let `o` or `y` reach the desktop: put stub `xdg-open` and `wl-copy` that log their arguments first on `PATH` for `drive.sh`.
```js
[
  [5000, function() { root.libraryCursor = root.shown.manga.findIndex(function(m) { return m.id === 21 }); key("Enter") }],
  [6000, function() { key("t") }],
  [3000, function() { log("rows", trackPanel.panel.rows.map(function(r) { return [r.tracker.name, r.record && r.record.url] })) }],
  [500, function() { key("y") }],
  [500, function() { log("note", trackPanel.note); done() }]
]
```

A login without an account, with `xdg-open` stubbed: pick the first tracker with an `authUrl` from `settingsView.trackers.list`, set `root.settingsCursor = Settings.ROWS.length + 1 + i`, Enter, wait 3 s; the stub got the link. Set the focused field to `nope`, Enter, log `settingsView.trackers.login.error`, Esc. Never paste a real callback or send credentials: those reach the provider.

The push itself: on a logged-out tracker `trackProgress` changes no record, but the server logs each one: `grep "trackChapter(mangaId" $RUN/server/logs/application.log` gains a line per push (none under never). The ask prompt needs a logged-in tracker to come up by itself; set `root.trackAsk = { mangaIds: [id], chapter: n }` to show it, then click the `y update` hint part (`hintBar.children`).

## Gotchas
- Never log in to a real tracker account from a verify run.
- A logged-out tracker's row says "log in under Settings to change it"; Enter, `x`, `d`, `D`, `p`, `s`, `c`, `S` answer with "Log in to ... under Settings first." (`Trackers.act`), so the window never sends a write for it; only `gql.sh` reaches the tracker's error. With no tracker logged in and no track, the panel has no rows and `y` says "This tracker has no link for the manga".
