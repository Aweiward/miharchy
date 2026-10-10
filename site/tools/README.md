# Showcase capture tools

These scripts make the pictures on the showcase page: `site/img/*.webp`, `site/banner.png` and the page previews.
The Pages workflow leaves this folder out of the published site.

Run them from a dev checkout only.
They write into `site/` and `site/tools/render/node_modules/`.
Never run them inside an installed clone (`~/.config/omarchy/plugins/miharchy`): the shell reloads the plugin on any write there.

## Rules for the captures

- Every window capture is the real window, driven offscreen by the verify skill's `drive.sh`. Do not paint, edit or fake a capture.
- The bar picture is the real `plugin/Mark.qml` and its popup. The bar around it (workspaces, clock, tray) is a stand-in, and the page caption says so.
- The Updates dates come from real server fetches on a shifted clock (`start-at`). Never edit dates in the database.
- Use a scratch server with its own run dir and port (`MIHARCHY_VERIFY_DIR`, `MIHARCHY_VERIFY_PORT`). Never use port 4590, `~/.config/miharchy` or the user's library.
- Pick manga that are popular and safe: content rating safe, no doujinshi. `pick.py` lists candidates by that rule. Never use a personal library.
- The covers and pages belong to their authors and publishers. The page footer says so. Keep that line.

## The scripts

| File | What it does |
| --- | --- |
| `start-at <offset>` | Starts the run's scratch Suwayomi-Server with its JVM clock shifted by libfaketime (`-5d`, `-3d`, `-1d`), or on the real clock (`0`). It reuses the run's database. |
| `halt` | Stops the scratch server and keeps its database. (`server.sh stop` deletes it.) |
| `seed.py <A\|B\|C\|D\|finish>` | Builds the showcase library from MangaDex. Stages A to D add manga, each on its own day. `finish` sets the read state, two bookmarks and one download. |
| `pick.py` | Lists candidate manga from the public MangaDex API: ongoing, safe, no doujinshi, by follows, with an English chapter in the last 90 days. It needs no server. |
| `steps/gallery.js` | Drive steps: Library, a manga page, the paged reader, then Updates with a real library update (`u`). |
| `steps/webtoon.js` | Drive steps: the long-strip reader on Eleceed, scrolled down the chapter. |
| `steps/browse.js` | Drive steps: MangaDex in Browse, with filters set through the filter panel. |
| `steps/card.js` | Drive steps: History, the reading card (`c`), then the card's own save (`S`) into the run home. |
| `mark.sh` | Renders the real bar mark and its popup offscreen in a stand-in bar (`mark/harness.qml`, `mark/KeyboardPanel.qml`). |
| `images.sh` | Converts the captures to `site/img/*.webp` with ImageMagick and copies `icons/miharchy.svg` to `site/`. |
| `render/render.js` | Renders full-page previews of `site/index.html` (desktop, phone) and writes `site/banner.png` from the hero. It also prints any element past the right edge. |

| Capture in `$MIHARCHY_VERIFY_DIR/evidence/` | Made by | Becomes |
| --- | --- | --- |
| `g1-library.png` | `steps/gallery.js` | `site/img/library.webp` |
| `g2-manga.png` | `steps/gallery.js` | `site/img/manga.webp` |
| `g3-reader-paged.png` | `steps/gallery.js` | `site/img/reader-paged.webp` |
| `g5-updates.png` | `steps/gallery.js` | `site/img/updates.webp` |
| `w-40000.png` | `steps/webtoon.js` | `site/img/reader-webtoon.webp` |
| `g6-browse.png` | `steps/browse.js` | `site/img/browse.webp` |
| `mark-popup.png` | `mark.sh` | `site/img/bar-popup.webp` |
| `reading-card.png` (`images.sh` copies the newest `home/Pictures/Miharchy/reading-card-*.png`) | `steps/card.js` | `site/img/reading-card.webp` |
| `site-desktop.png`, `site-phone.png` | `render/render.js` | previews (not published) |

## What you need

- `suwayomi-server-bin` (AUR). `start-at` runs its jar from `/usr/share/java/suwayomi-server` with `/usr/bin/java`.
- `jq`, `curl`, `openssl`, `python3`, `quickshell`, `imagemagick`, `chromium`, `nodejs` and `npm`.
- An Omarchy install. `mark.sh` copies the shell's `Commons` and `Ui` from `$OMARCHY_PATH/shell` (default `~/.local/share/omarchy/shell`). The theme home copies `themes/tokyo-night` from the same place.
- libfaketime. See the next section.

## libfaketime

`start-at` preloads libfaketime into the server's JVM. It reads the library path from `FAKETIME_LIB`. The default is `/usr/lib/faketime/libfaketime.so.1`.

Option 1 is a local build with no sudo. The current images used this build (libfaketime 0.9.13, the 64-bit `time_t` variant):

```sh
git clone https://github.com/wolfcw/libfaketime "$MIHARCHY_VERIFY_DIR/libfaketime"
make -C "$MIHARCHY_VERIFY_DIR/libfaketime/src" libfaketime-time64.so.1
export FAKETIME_LIB=$MIHARCHY_VERIFY_DIR/libfaketime/src/libfaketime-time64.so.1
```

Option 2 is the Arch package: `sudo pacman -S libfaketime`. It installs `/usr/lib/faketime/libfaketime.so.1`, the default. Nobody has tried that build with the server's JVM yet. Check the fetch dates after stage A.

`start-at` sets `FAKETIME_DONT_FAKE_MONOTONIC=1` and `FAKETIME_DONT_RESET=1`. The JVM needs a real monotonic clock and one fixed start point.

## The recipe

Run every command from the repo root of a dev checkout.

```
 1 env + theme home ──► 2 stages A..D on shifted clocks ──► 3 finish (real clock)
                                                              │
 6 render previews + banner ◄── 5 webp (magick) ◄── 4 drive window + bar mark
```

1. Choose a run dir and a port. Make the theme home (Tokyo Night) that the window and the mark read through `HOME`.

   ```sh
   export MIHARCHY_VERIFY_DIR=$TMPDIR/miharchy-verify/showcase MIHARCHY_VERIFY_PORT=4648
   export FAKETIME_LIB=...   # see libfaketime
   T=site/tools S=.claude/skills/verify-miharchy/scripts
   mkdir -p "$MIHARCHY_VERIFY_DIR/home/.local/state/omarchy/current"
   cp -r "${OMARCHY_PATH:-$HOME/.local/share/omarchy}/themes/tokyo-night" "$MIHARCHY_VERIFY_DIR/home/.local/state/omarchy/current/theme"
   ```

2. Build the library in four stages, each on its own day. Updates groups chapters by the day the server fetched them, so this gives four day groups.

   ```sh
   $T/start-at -5d && $S/seed.sh && $T/seed.py A && $T/halt   # seed.sh adds the Keiyoushi repo and MangaDex
   $T/start-at -3d && $T/seed.py B && $T/halt
   $T/start-at -1d && $T/seed.py C && $T/halt
   $T/start-at 0 && $T/seed.py D
   ```

   The first `start-at` on a fresh run dir downloads JCEF (about 250 MB). That is normal.

3. Set the read state, the bookmarks and the download, on the real clock.

   ```sh
   $T/seed.py finish
   ```

4. Drive the window and render the bar mark. `HOME` points at the theme home. `gallery.js` presses `u` in Updates, which runs a real library update.

   ```sh
   HOME=$MIHARCHY_VERIFY_DIR/home $S/drive.sh $T/steps/gallery.js 180
   HOME=$MIHARCHY_VERIFY_DIR/home $S/drive.sh $T/steps/webtoon.js 120
   HOME=$MIHARCHY_VERIFY_DIR/home $S/drive.sh $T/steps/browse.js 90
   HOME=$MIHARCHY_VERIFY_DIR/home $S/drive.sh $T/steps/card.js 90
   $T/mark.sh
   ```

   Read each capture in `$MIHARCHY_VERIFY_DIR/evidence/` before you go on. `drive.log` holds what each step saw.

5. Convert the captures to webp.

   ```sh
   $T/images.sh
   ```

6. Render the previews and the banner.

   ```sh
   (cd $T/render && npm ci --no-bin-links)   # a .bin symlink would fail omarchy plugin validate
   node $T/render/render.js
   ```

   Check the output: no element past the right edge, and both fonts loaded.

7. Stop the server.

   ```sh
   $S/server.sh stop
   ```

The library depends on what MangaDex serves on the day. A series with no English chapters shows by its cover only. When a series stops releasing, run `pick.py` and change `LIBRARY` and `STAGES` in `seed.py`.
