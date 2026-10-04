# Miharchy mark

見, the first character of 見本 (Mihon, "sample"). The 目 is drawn as a window with two bars — an eye, and a tile. The 儿 kick leaves the floor at 45 degrees.

One color, no radius, no gradient. It tints with the theme, and it still reads at 16px.

Tokyo Night blue (`#7aa2f7`) is the launcher color, so it doesn't sit next to omaqbt as a second purple tile. A purple knockout is in the pack if you want the pair to match.

## Which file

| File | Use |
| --- | --- |
| `miharchy-knockout.svg` | Launcher and search. Blue tile, night window. This is the one. |
| `miharchy-symbolic.svg` | Bar. `fill="currentColor"`. Paths: `eye`, `leg`, `kick`. |
| `miharchy.svg` | Opaque night tile, blue mark. Use if a surface cannot take the knockout. |
| `miharchy-purple.svg` | Same knockout in Tokyo Night magenta, to match omaqbt. |
| `miharchy-mono.svg` | Night tile, foreground mark. |
| `miharchy-active.svg` | Reference for a sync in progress: eye in foreground, legs in `#9ece6a`. |
| `MiharchyIcon.qml` | Bar component. `color`, `legColor`, warning badge. Badge is a square. |
| `png/` | 16–512 for hicolor and the bar. |

## Syncing

The legs are their own paths. Leave `eye` on the theme foreground and set `leg` and `kick` to `#9ece6a` while a sync is running. Idle, all three are the same color.

## Geometry

48 grid. Stroke 6. The two lids have a 2-unit gap so they don't fuse into the frame. The kick overlaps the floor by 2 units, so there is no seam.

```
eye  M 7 3 H 41 V 33 H 7 Z M 13 11 H 35 V 17 H 13 Z M 13 19 H 35 V 25 H 13 Z
leg  M 13 31 H 19 V 44 H 13 Z
kick M 27 31 H 33 V 33 L 42 42 H 36 L 27 33 Z
```
