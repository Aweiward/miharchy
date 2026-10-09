<a href="https://aweiward.github.io/miharchy/"><img src="site/banner.png" alt="Miharchy: a keyboard-first manga reader for Omarchy. Mihon-compatible extensions on the desktop, your library synced with Mihon on your phone." width="1280"></a>

# Miharchy

See it in action on [aweiward.github.io/miharchy](https://aweiward.github.io/miharchy/).

A manga reader that feels native on [Omarchy](https://omarchy.org). It runs [Mihon](https://github.com/mihonapp/mihon)-compatible extensions from the extension repos you add, through [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server), and it syncs your library with Mihon on your phone.

Miharchy is not affiliated with Mihon, Suwayomi or Omarchy. It provides no extensions or extension repos and hosts no content. Extension repos are third-party: add only ones you trust.

Status: [v1.0.0](https://github.com/Aweiward/miharchy/releases/tag/v1.0.0), at Mihon parity. See `GLOSSARY.md` and `docs/adr/`.

## Install

```sh
omarchy plugin add https://github.com/Aweiward/miharchy --enable
```

This clones the plugin into `~/.config/omarchy/plugins/miharchy` and puts the Miharchy mark in the bar. Middle click the mark to open the window. The first time, the window opens on Setup.

To update:

```sh
omarchy plugin update miharchy
omarchy-restart-shell
```

Run `omarchy-restart-shell` after every update. The shell reloads the plugin when its files change, but it reuses its cached copy of the plugin's code ([omacom/omarchy#6981](https://github.com/omacom/omarchy/issues/6981)), so the bar mark keeps running the old code until the shell restarts. A window that is open keeps running the old code: within half a minute its status bar shows "new version   Q restart". Press `Q` or click it. The window saves what the reader read, quits, and opens again on the new code.

## Setup

Setup lists the steps below. Move with `j` and `k`, press Enter on a step. A step that changes your system asks first: press `y` to run it, `n` to cancel. Setup never runs `sudo` or installs packages; for those it shows the command to run in a terminal. Every step checks its own state, so you can run Setup again at any time (`:` then Setup).

1. Java: `sudo pacman -S jdk-openjdk`.
2. Suwayomi-Server: `yay -S suwayomi-server-bin`.
3. Qt WebSockets: `sudo pacman -S qt6-websockets`. The download queue and Updates use it to show changes as they happen.
4. Server: runs `server/miharchy-server`. It creates `~/.config/miharchy/server.json` with a random password and enables the `miharchy-server` user service on `127.0.0.1:4590`.
5. FlareSolverr (optional, needs Docker): starts the `miharchy-flaresolverr` container on `127.0.0.1:8191` for Cloudflare sources.
6. Sync folder: the folder Mihon and Miharchy exchange backups through.
7. Sync helper: builds the sync helper into `~/.local/share/miharchy/helper`. The first build downloads Gradle and libraries and takes a few minutes. After `omarchy plugin update` the step shows "out of date" when the helper changed; build it again.
8. App launcher entry: writes `~/.local/share/applications/miharchy.desktop`, so Miharchy shows in the app launcher (Super + Space).
9. Peek key: adds `SUPER + M` to `~/.config/hypr/bindings.lua`, once. If `SUPER + M` is taken, or the file is missing, Setup shows the line to add yourself with another key. A bind you moved to another key stays as it is.

## Peek

Press `SUPER + M` from any workspace. Miharchy opens over it as a peek, on the next chapter to read: the first unread chapter of the manga you read last, by that manga's chapter filters. Press `SUPER + M` again to hide it. Switching workspaces hides it too, and the next press brings it back on the same page.

- The peek lives on its own Hyprland special workspace, `special:miharchy`, like Omarchy's scratchpad.
- If the window is already open on a normal workspace, the key focuses it there and resumes. It never moves a window you placed.
- With nothing left to read, the peek opens the Library with its search.
- From a terminal: `~/.config/omarchy/plugins/miharchy/window/miharchy peek`.

## Sync with Mihon

1. In Mihon, turn on automatic backups (More → Settings → Data and storage).
2. Share the folder that holds those backups with the desktop sync folder, for example with Syncthing.
3. Press `s` in the window (or in the mark's popup) to sync. Miharchy merges the newest phone backup and writes `miharchy-<time>.tachibk` into the sync folder.
4. In Mihon, restore the newest `miharchy-*.tachibk`: More → Settings → Data and storage → Restore backup.

A Mihon restore only adds: it cannot remove a manga from the library, take it out of every category, mark a chapter unread, remove a bookmark or lower the last page read. After a sync the window lists those changes. Repeat them on the phone.

## Uninstall

```sh
omarchy plugin remove miharchy
systemctl --user disable --now miharchy-server
rm ~/.config/systemd/user/miharchy-server.service ~/.local/share/applications/miharchy.desktop
rm -rf ~/.config/miharchy ~/.local/share/miharchy
docker rm -f miharchy-flaresolverr   # if you added FlareSolverr
```

`~/.local/share/miharchy` holds the server's library and downloads, the sync helper and the sync baselines. Your sync folder stays.

## Develop

Run the window from a checkout with `window/miharchy`. Set `MIHARCHY_SERVER_JSON` to use another credentials file. Tests: `cd window && npm test`, `cd sync && ./gradlew test`.
