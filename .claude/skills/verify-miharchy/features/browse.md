# Browse and add

Browse (key `4`): installed sources, a source's popular/latest/search lists, the manga detail overlay, and adding to the library.

## Sub-features
- Sources screen (`Tab` toggles Extensions; `l` toggles languages; `/` global search).
- Source grid: `p` popular, `n` latest, `/` search, `hjkl` move, infinite scroll.
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

## Gotchas
- Setting `sourceCursor` directly is the one allowed setter (picking a row by name); navigation keys are tested elsewhere.
- Cloudflare sources need FlareSolverr; without it the grid shows "This source needs FlareSolverr".
- A manga opened from a source refreshes from the source once (network).
