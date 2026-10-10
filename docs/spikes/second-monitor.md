# Second-monitor layout: chapter list on one screen, reader on the other (2026-10-10)

Question: can the window keep a manga's chapter list on one monitor and show the reader on another, placed by a Hyprland window rule that Setup writes? A peek already covers the single-screen case.

Answer: yes, but the rule is the weakest part. One Quickshell process can hold two top-level windows that share all state, so the reader can move into a second window. The Hyprland `monitor` rule works, but it applies only once, when a window opens. It fails silently with one screen, and it needs a second config write. The window can instead move its reader window itself, by address, with the dispatch that `window/miharchy` already sends for the peek. That path writes no file and needs only a setting. The real costs are in the window, not in Hyprland: the launcher's window lookup, key focus, and the peek.

## Method

1. Read `window/shell.qml`, `window/ReaderView.qml`, `window/miharchy`, `window/Setup.js`, `docs/agents/window.md`, `docs/agents/setup.md` and ADR 0003.
2. Ran `hyprctl version`, `hyprctl monitors -j` and `hyprctl clients -j`, read only.
3. Read `~/.config/hypr/hyprland.lua`, Omarchy's `/usr/share/omarchy/default/hypr/` and the Lua stubs in `/usr/share/hypr/stubs/hl.meta.lua`, read only.
4. Read the Hyprland wiki sources (`hyprwm/hyprland-wiki`: `window-rules.md`, `dispatchers.md`, `selectors.md`) and the Hyprland v0.56.2 source (`src/desktop/view/Window.cpp`).
5. Ran a scratch Quickshell config with two `FloatingWindow`s offscreen (`QT_QPA_PLATFORM=offscreen`), to check shared state and moving an item between windows. Nothing showed on the desktop.
6. Read Mihon's `TabletUiMode.kt` and `presentation/manga/MangaScreen.kt` on GitHub.

## Results

| Check | Result |
|---|---|
| Hyprland | 0.56.2, Lua config (`~/.config/hypr/hyprland.lua`) |
| Quickshell | 0.3.1 |
| Monitors on this machine | 1: DP-1, 3440x1440 at scale 1.25 |
| Miharchy window | class `org.quickshell`, title `Miharchy`, tiled, workspace 1 |
| Top-level windows in the window process | 1 `FloatingWindow` (`shell.qml:878`) |
| Two `FloatingWindow`s in one process, offscreen | load; both read one root property; an item reparented to the second window's `contentItem` reports that window |
| `monitor` rule effect | static: "evaluated once when the window is opened and never again" (wiki) |
| `monitor` rule naming an absent monitor | logs `No monitor in monitor {} rule`, opens on the focused monitor (`Window.cpp:2170`) |
| Runtime move | `hl.dsp.window.move({ window?, monitor, follow? })` (wiki `dispatchers.md`) |
| Setup steps that write into `~/.config/hypr` | 1: Peek key, into `bindings.lua` (`Setup.js:18`) |
| Mihon tablet layout | manga info left, chapter list right (`MangaScreenLargeImpl`, `TwoPanelBox`); the reader is its own `ReaderActivity` |

Not measured: a second monitor (this machine has one), Quickshell's `screen` property on a Wayland toplevel, and whether Quickshell sets the title before the window maps.

## Findings

- **The reader and the chapter list share one window today.** `shell.qml` has one `FloatingWindow` (`:878`). The views, `MangaDetail` (`:1116`) and `ReaderView` (`:1225`) are all `anchors.fill` overlays inside it. The reader opens over the manga detail, and the manga detail stays open under it (`onRead` → `reader.start`; `onClosed` → `mangaDetail.reread`). The reader's "chapter list" in `docs/agents/window.md` is its reading order (`ReaderView.qml:37`), not a list on screen.
- **A second window in the same process is cheap for state.** The offscreen run showed two `FloatingWindow`s in one `ShellRoot`, both bound to one root property, and an item moved into the second window. So `ReaderView` can live in a second `FloatingWindow` and keep its signals to `root` (`caughtUpOn`, `nextManga`, `closed`). No IPC and no second process are needed. ADR 0003 still holds: the window process stays apart from the shell.
- **Three things are bound to the one window.** `keyRoot` (`shell.qml:889`) is the only `FocusScope` with `Keys.onPressed`. A reader window needs its own scope that calls `root.handleKey`, and the compositor gives keys to one window at a time. Omarchy sets `follow_mouse = 1` (`default/hypr/input.lua:57`), so the mouse moves the focus between the screens. `onVisibleChanged: if (!visible) reader.quit()` (`:886`) and `IdleInhibitor { window: window }` (`:874`) also name the one window.
- **The launcher cannot tell two windows apart.** `window/miharchy:17-19` finds the window as the first client with the process's pid. Two windows share that pid and the class `org.quickshell`. Only the title can separate them, so the reader window needs its own title (for example `Miharchy reader`). Omarchy already matches a Quickshell window this way: `{ class = "^org.quickshell$", title = "^Omarchy shell – dev gallery$" }` (`default/hypr/apps/omarchy-shell.lua:14`).
- **Rule syntax on this machine is Lua.** Hyprland 0.56.2 takes `hl.window_rule({ match = { class = …, title = … }, monitor = "DP-2" })`. Omarchy wraps it as `o.window(match, rules)` (`default/hypr/helpers.lua:142`). `monitor` takes a name or id and an optional `" silent"`. Static rules match the initial title and class.
- **A rule for an absent monitor does no harm, and no good.** Hyprland logs an error and opens the window on the focused monitor (`Window.cpp:2144-2171`). With one screen, both windows land on one monitor, as tiles. On this 3440 px ultrawide, two tiles side by side already give a two-pane layout with no rule. The event `monitor.added` (stubs, line 13) could react to a plug; not measured.
- **The window can move itself at runtime.** `window/miharchy:76` already sends `hl.dsp.window.move` with `window = "address:…"` and a legacy fallback, for the peek. The same call with `monitor = "<name>"` places the reader window when it opens. It runs every time, so it follows a monitor that comes and goes; a static rule does not. Quickshell's `screen` property says it "may be modified to move the window"; whether Hyprland honors it for a floating toplevel is not measured.
- **The peek conflicts with two screens.** A peek is the window on `special:miharchy`. A special workspace shows on one monitor at a time (`hyprctl monitors -j`, `specialWorkspace`). Two windows in that workspace show on the same monitor. So a peek and a split layout cannot both hold; one must give way. The peek key, the next key and Catch-up also assume one window: `peek()` and `openChapter()` close the reader and the manga detail in that window, and `peek-next` focuses one address.
- **Omarchy's place for a personal rule is the end of `hyprland.lua`.** That file ends with `-- Add any other personal Hyprland configuration below.` and the example `-- o.window("qemu", { workspace = "5" })` (`:29`). Setup writes only `bindings.lua` today. A rule step would be the second write into `~/.config/hypr`, into a different file, and only after `y` (ADR 0007's rule for Setup).
- **Mihon has no reader beside a chapter list.** Its Tablet UI setting (`TabletUiMode`: automatic, always, landscape, never) splits the manga screen into info and chapters. The reader stays a full-screen activity. A split reader would be a Miharchy addition, not parity.

### Three ways to place the reader

| | Setup writes a rule | The window moves itself | A setting only, no placement |
|---|---|---|---|
| What it changes | appends `o.window({ class = "^org.quickshell$", title = "^Miharchy reader$" }, { monitor = "…" })` to `hyprland.lua` | `hyprctl dispatch` by address when the reader window opens | nothing outside Miharchy |
| Config file written | yes, a second file in `~/.config/hypr` | none | none |
| When it applies | once, at the window's open | at every reader open | never; the user tiles or drags |
| One screen | error in the Hyprland log, opens on the focused monitor | the dispatch skips an absent monitor (check `monitors -j` first) | tiles on one screen |
| Monitor chosen in | the rule file | global meta `miharchy.<key>` (AGENTS.md) | — |
| Code that exists | `Setup.bindLine` pattern | `window/miharchy` `dispatch()` and `address()` | — |

## Open decisions

These wait for a grilling session:

1. What goes on the second screen: the reader alone, or the chapter list as a pinned pane next to a reader that fills the first screen.
2. Placement: Setup writes a rule, the window moves itself, or no placement at all. The runtime move reuses code that exists and writes no file.
3. The peek: does a split layout turn the peek off, or does the peek keep one window and the split apply only to a plain launch?
4. The setting: one global meta key for the reader monitor, a name such as `DP-2`, empty for off. Or a toggle that takes "the other monitor".
5. Keys across two windows: does each window keep its own keys, or does a key in the chapter list window drive the reader (j/k on the list opens that chapter)?
6. The term: **Reader window**, or a new term for the layout, to add to `GLOSSARY.md` when the plan settles. The glossary says the reader shows "over the window"; that changes.
7. Is the single-screen ultrawide case (two tiles, no rule) enough to ship first?
