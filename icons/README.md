# Miharchy mark — burst

The 90s manga-tape logo, reduced. A cross, and a burst of bars on each side. No wordmark: that lettering is theirs. The nod is the shape.

Sharp corners, grid, no radius. The rays are gapped off the cross so they stay separate at 16px.

Tokyo Night red (`#f7768e`) is the burst. It sits next to omaqbt's magenta and the 見 set's blue without matching either.

## Which file

| File | Use |
| --- | --- |
| `miharchy.svg` | Launcher and search. Night tile, red burst, foreground cross. This is the one. |
| `miharchy-symbolic.svg` | Bar. `currentColor`. Paths: `rays`, `stem`, `bar`. |
| `miharchy-knockout.svg` | Red tile, night mark. Use if search wants a single flat color. |
| `miharchy-burst.svg` | Night tile, red burst, lifted-night cross. Closer to the poster, quieter. |
| `miharchy-mono.svg` | Night tile, foreground mark. |
| `miharchy-active.svg` | Sync: cross in foreground, rays in `#9ece6a`. |
| `MiharchyIcon.qml` | Bar component. `color` for the cross, `rayColor` for the burst. |
| `png/` | 16–512. |

## Bar

Leave `rayColor` on `color` and the whole mark tints. To keep the nod on the bar, set `rayColor` to `#f7768e` and leave the cross on the theme foreground.

## Geometry

```
stem M 15 3 H 33 V 45 H 15 Z
bar  M 2 18 H 46 V 30 H 2 Z
rays M 1 5 H 13 V 9 H 1 Z  M 1 11 H 13 V 15 H 1 Z
     M 1 33 H 13 V 37 H 1 Z M 1 39 H 13 V 43 H 1 Z
     and the same four, mirrored from x=35
```
