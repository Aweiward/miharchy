# Extensions

Browse (key `4`), then `Tab`: the extension repos and the extensions, grouped Updates, Installed, Available.

## Sub-features
- List (scope `extensions`): `Enter` installs an available extension and opens an installed one's details; `u` updates the row's extension; `U` updates every installed extension with an update in one `updateExtensions` (Mihon's Update all; the hint shows it only while there is one); `x x` uninstalls or removes a repo; `a` adds a repo by URL; `/` filters; `l` toggles languages; `r` refreshes.
- Details (scope `extension`, Mihon's extension details): name, version, language, content warning, package name, then the extension's sources (`extension(pkgName) { source }`). `j`/`k` move, `Enter` or `S` opens a source's settings when it has some (`isConfigurable`), `u` updates, `x x` uninstalls and closes the details, `Esc` goes back to the list.
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
Read back: `source(id: "2499283573021220255") { preferences { ... on SwitchPreference { key title sw: currentValue } } }`: "Data saver" (`dataSaverV5_en`) flips. Uninstall: `extension(pkgName:) { isInstalled }` is false and the row moves to Available.

## Gotchas
- Setting `extensionsView.cursorKey` is the allowed setter (picking a row by package name).
- A double click on a list row targets the row's `Rectangle` (`children[1]` of the delegate), where its `MouseArea` is.
- MangaDex has 61 sources, all configurable; Weeb Central has one with no settings, so `Enter` there opens nothing.
- A fresh server has no extension with an update. To make some, serve a store of your own on a free local port (`python3 -m http.server`, stopped by its PID): a JSON `NetworkExtensionStore` (`{ name, badgeLabel, signingKey, contact: { website }, extensionList: { extensions: [...] } }`) that lists installed extensions with `versionCode` one higher and the server's own `apkUrl` and `jarUrl` for them. Remove the Keiyoushi store (`removeExtensionStore` by `https://github.com/keiyoushi/extensions/raw/repo/index.pb`), add yours, `fetchExtensions`: they show `hasUpdate`. Add Keiyoushi back afterwards. A legacy `index.min.json` store gives only apk URLs; Suwayomi's apk conversion of current extensions fails ("Expecting a stackmap frame") and its failed update leaves the extension uninstalled.
