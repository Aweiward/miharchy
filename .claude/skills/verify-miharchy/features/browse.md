# Browse and add

Browse (key `4`): installed sources, a source's popular/latest/search lists, the manga detail overlay, and adding to the library.

## Sub-features
- Sources screen (`Tab` toggles Extensions; `l` toggles languages; `/` global search).
- Source grid: `p` popular, `n` latest, `/` search, `hjkl` move, infinite scroll.
- Source filters (`F` on a source, scope `source-filters`): `j`/`k` move, `Enter`/`Space` toggles a checkbox, cycles a tri-state, opens a group, select or sort, picks an option, or opens the text field; `a` applies, `x` resets, `Esc`/`F` closes. Applying always runs a SEARCH (Suwayomi passes filters only there), keeping the query of a search already showing. Panels live in `browseView.filterPanels` per source id for the window's life.
- Source settings (`S` on the sources screen or a source, only when `isConfigurable`, scope `source-settings`): each change saves at once with `updateSourcePreference`; closing it over a source reloads the listing.
- Detail overlay: `a` add/remove library, `c` categories, `t` tracking, `M` migrate, `Enter` read.

## How to get to it (user POV)
Press `4`, pick a source with `j`/`k`, `Enter`.

## Driving it with drive.sh
```js
[
  [3000, function() { key("4") }],
  [3000, function() { browseView.sourceCursor = browseView.src.sources.findIndex(function(s) { return s.name === "MangaDex (EN)" }); key("Enter") }],
  [9000, function() { log("popular", browseView.listing.items.length); grab("source-grid"); key("Enter") }],
  [9000, function() { log("detail", [mangaDetail.detail.manga.title, mangaDetail.detail.chapters.length]); key("a") }],
  [3000, function() { log("inLibrary", mangaDetail.detail.manga.inLibrary); grab("detail-added"); done() }]
]
```
Read back: the manga's `inLibrary` is true; `Library` shows it.

Filters and settings. Move to a row by label, not by count; a group or list adds rows when open:
```js
[
  [3000, function() { key("4") }],
  [3000, function() { browseView.sourceCursor = browseView.src.sources.findIndex(function(s) { return s.name === "Weeb Central (EN)" }); key("Enter") }],
  [10000, function() { key("F") }],
  [4000, function() { key("Enter"); key("j"); key("j"); key("j"); key("j"); key("Enter") }],   // open Sort, pick option 3
  [500, function() { log("rows", browseView.panelRows.map(function(r) { return r.mark + " " + r.label + " " + r.detail })); key("a") }],
  [12000, function() { log("applied", [browseView.listing.filters, browseView.listing.items.map(function(m) { return m.title })]) }],
  [300, function() { grab("filtered"); done() }]
]
```
A text row: `key("Enter")` on it, then `keyRoot.Window.window.activeFocusItem.text = "..."` and `key("Enter")`. Settings: `key("S")` on the sources screen, same rows; read back with `source(id){ preferences { ... on MultiSelectListPreference { key multi: currentValue } } }` (alias `currentValue`: its type differs per preference type). Compare titles with `fetchSourceManga(type: SEARCH, query: "", filters: [...])` over `gql.sh`.

## Gotchas
- Setting `sourceCursor` directly is the one allowed setter (picking a row by name); navigation keys are tested elsewhere.
- Cloudflare sources need FlareSolverr; without it the grid shows "This source needs FlareSolverr".
- A manga opened from a source refreshes from the source once (network).
- `grab()` is asynchronous: a key sent in the same step can land before the capture. Grab in a step of its own.
- A filter change addresses the server's full list by position, headers and separators included; a wrong kind at a position fails with "Expected ... state change at position N".
- MangaDex's "Filter original languages" setting also filters popular and latest, so it is the observable one for settings. Weeb Central has filters but no settings.
- Parallel agents share the session scratchpad: keep helper scripts under your own run's folder, never at a shared name like `scratchpad/g.sh`.
