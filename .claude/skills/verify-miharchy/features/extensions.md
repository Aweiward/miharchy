# Extensions

Browse (key `4`), then `Tab`: the extension repos and the extensions, grouped Updates, Installed, Available.

## Sub-features
- List (scope `extensions`): `Enter` installs an available extension and opens an installed one's details; `u` updates the row's extension; `U` updates every installed extension with an update in one `extension.updateAll` (Mihon's Update all; the hint shows it only while there is one); `x x` uninstalls or removes a repo; `a` adds a repo by URL; `/` filters; `l` toggles languages; `r` refreshes.
- Details (scope `extension`, Mihon's extension details): name, version, language, content warning, package name, then the extension's sources (`sources` of its row in `extension.list`). `j`/`k` move, `Enter` or `S` opens a source's settings when it has some (`isConfigurable`), `u` updates, `x x` uninstalls and closes the details, `Esc` goes back to the list.
- A source's settings from the details are Browse's settings panel (`browseView.panel`, scope `source-settings`): BrowseView stays visible over the Extensions screen while its panel is open. `Esc` returns to the details.

## How to get to it (user POV)
Press `4`, `Tab`, pick an installed extension with `j`/`k`, `Enter`.

## Driving it with drive.sh
```js
[
  [3000, function() { key("4") }],
  [1500, function() { key("Tab") }],
  [9000, function() { extensionsView.cursorKey = "eu.kanade.tachiyomi.extension.all.mangadex"; key("Enter") }],
  [3000, function() { log("details", [extensionsView.details.state, extensionsView.details.sources.length]); root.v.en = extensionsView.details.sources.findIndex(function(s) { return s.name === "MangaDex (EN)" }) }],
  [500, function() { click(find(extensionsView, function(i) { return i.modelData && i.index === root.v.en && i.current !== undefined && i.modelData.configurable !== undefined })) }],
  [500, function() { key("Enter") }],
  [4000, function() { log("panel", [browseView.panel.kind, browseView.panel.source.name]); key("j"); key("j"); key("Enter") }],
  [3000, function() { log("saved", browseView.panel.saved); grab("settings"); done() }]
]
```
Read back: `core.sh api source.settings '{"source":"2499283573021220255"}' | jq -c '.settings[] | select(.key == "dataSaverV5_en") | {key, title, value}'`: "Data saver" flips (`false` on a fresh core). Uninstall: `core.sh api extension.list '{}' | jq -c '.extensions[] | select(.pkgName == "<pkg>") | {pkgName, isInstalled}'` reads `isInstalled` false and the row moves to Available.

## Gotchas
- Setting `extensionsView.cursorKey` is the allowed setter (picking a row by package name).
- A double click on a list row targets the row's `Rectangle` (`children[1]` of the delegate), where its `MouseArea` is.
- MangaDex has 61 sources, all configurable; Weeb Central has one with no settings, so `Enter` there opens nothing.
- A fresh core has no extension with an update. To make some, serve a repo index of your own on a free local port (`python3 -m http.server`, stopped by its PID). Core reads `{ name, badgeLabel, signingKey, contact: { website }, extensionList: { extensions: [{ packageName, name, versionName, versionCode, resources: { jarUrl, iconUrl } }] } }` (`parseIndex` in `core/.../Extensions.kt`), and takes only entries with a `jarUrl`. Copy Keiyoushi's `signingKey` and the installed extensions' entries, with `versionCode` one higher and the same `jarUrl`. Remove Keiyoushi (`extensionRepo.remove '{"url":"https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json"}'`), add yours (`extensionRepo.add '{"url":"http://127.0.0.1:<port>/index.min.json"}'`), then `extension.list` shows `hasUpdate` true. Add Keiyoushi back afterwards (`core.sh seed`). Not run on core yet.
