# Miharchy mark — cross and sunburst

The mark is the cross and sunburst of the c.1991 Manga Video logo, without its lettering: that lettering is theirs. The nod is the shape.

Tokyo Night red (`#f7768e`) is the burst. It sits next to omaqbt's magenta and the 見 set's blue without matching either.

## Which file

| File | Mark | Use |
| --- | --- | --- |
| `miharchy.svg` | full | Launcher, notifications and search. Night tile, red burst, foreground cross. This is the one. |
| `miharchy-knockout.svg` | full | Red tile, night mark. Use if search wants a single flat color. |
| `miharchy-burst.svg` | full | Night tile, red burst, lifted-night cross. Quieter. |
| `miharchy-mono.svg` | full | Night tile, foreground mark. |
| `miharchy-symbolic.svg` | bar | `currentColor`. Paths: `burst`, `cross`. |
| `miharchy-active.svg` | bar | Sync: cross in foreground, burst in `#9ece6a`. |
| `png/` | | 16–512 of `miharchy`, `-burst`, `-knockout` (also 1024) and `-symbolic`. |

`plugin/MiharchyIcon.qml` draws the bar mark in the bar: `color` for the cross, `rayColor` for the burst. Leave `rayColor` on `color` and the whole mark tints.

## Geometry

Measured on the logo with the cross's half-length L = 1:

```
            ┌───┐          arms: equal length, half-thickness 0.31
       \ \ \│   │/ / /     disk: solid, radius 0.63, behind the cross
      ──────┘   └──────    rays: 3 per quadrant, at 45° and ±15°
      ──────┐   ┌──────          wedges about 7° wide, ends on a circle at 0.97
       / / /│   │\ \ \     the burst touches the cross; the cross is in front
            └───┘
```

There are two marks on the 48 × 48 grid, both from `mark.py`:

| | Cross L, half-thickness | Disk | Rays | Gap around the cross |
| --- | --- | --- | --- | --- |
| full | 21, 6.6 | 13.2 | 0 to 20.4, ±3.6°, at 45° ± 15° | 1 |
| bar | 16, 4 | none | 11 to 23.5, ±7°, at 45° ± 23° | 2.5 |

The full mark keeps the measured proportions. Its gap lets it work in one color. The bar mark is for 16–24 px in one color. At 20 px the thin 1991 rays merge into one blur around the cross, so the bar mark has fewer, wider wedges and a wider gap.

## Change the mark

1. Edit `FULL` or `BAR` in `mark.py`, from a dev checkout. Never run it inside an installed clone.
2. Run `python3 icons/mark.py`. It checks that each quadrant is symmetric about its diagonal, writes the six SVGs, and prints the burst and cross paths of both marks.
3. Paste the printed paths into the files that embed them: `plugin/MiharchyIcon.qml` (bar), `window/ReadingCard.qml` and the hero in `site/index.html` (full).
4. Make the PNGs: for each file in `png/`, `rsvg-convert -w <size> -h <size> <name>.svg -o png/<name>-<size>.png`.
5. Copy `miharchy.svg` to `site/miharchy.svg` (`site/tools/images.sh` does it too), and render `site/banner.png` again with `site/tools/render/render.js`.
