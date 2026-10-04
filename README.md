# Miharchy

A manga reader that feels native on [Omarchy](https://omarchy.org). It uses [Mihon](https://github.com/mihonapp/mihon)'s sources and extensions through [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server), and it syncs your library with Mihon on your phone.

Status: early. See `CONTEXT.md` and `docs/adr/`.

## Install

```sh
omarchy plugin add https://github.com/Aweiward/miharchy --enable
```

This clones the plugin into `~/.config/omarchy/plugins/miharchy` and puts the Miharchy mark in the bar. Middle click the mark to open the window. The first time, the window opens on Setup.

## Setup

Setup lists the steps below. Move with `j` and `k`, press Enter on a step. A step that changes your system asks first: press `y` to run it, `n` to cancel. Setup never runs `sudo` or installs packages; for those it shows the command to run in a terminal. Every step checks its own state, so you can run Setup again at any time (`:` then Setup).

1. Java: `sudo pacman -S jdk-openjdk`.
2. Suwayomi-Server: `yay -S suwayomi-server-bin`.
3. Server: runs `server/miharchy-server`. It creates `~/.config/miharchy/server.json` with a random password and enables the `miharchy-server` user service on `127.0.0.1:4590`.
4. FlareSolverr (optional, needs Docker): starts the `miharchy-flaresolverr` container on `127.0.0.1:8191` for Cloudflare sources.
5. Sync folder: the folder Mihon and Miharchy exchange backups through.
6. Sync helper: builds the sync helper into `~/.local/share/miharchy/helper`. The first build downloads Gradle and libraries and takes a few minutes. After `omarchy plugin update` the step shows "out of date" when the helper changed; build it again.
7. App launcher entry: writes `~/.local/share/applications/miharchy.desktop`, so Miharchy shows in the app launcher (Super + Space).

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
