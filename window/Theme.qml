import QtQuick
import Quickshell
import Quickshell.Io
import "Theme.js" as T

// The active Omarchy theme's colors and font sizes, reloaded live.
QtObject {
  id: theme

  readonly property string home: Quickshell.env("HOME")
  readonly property string themeDir: home + "/.local/state/omarchy/current/theme"

  // Reassigned whole on each load so bindings re-evaluate.
  property var palette: T.parseColors("")
  property var themeShell: ({})
  property var userShell: ({})
  readonly property var shell: T.mergeShell(themeShell, userShell)

  readonly property color background: palette.background
  readonly property color foreground: palette.foreground
  readonly property color accent: palette.accent
  readonly property color muted: palette.muted
  readonly property color urgent: palette.urgent

  // The palette overlay borrows the shell's menu surface roles.
  readonly property color scrim: T.surface(shell, palette, "menu.scrim", "menu.scrim-alpha", "background", 0.5)
  readonly property color panel: T.surface(shell, palette, "menu.background", "menu.background-alpha", "background", 1)
  readonly property color panelBorder: T.surface(shell, palette, "menu.border", "menu.border-alpha", "foreground", 0.2)
  readonly property color selected: T.surface(shell, palette, "menu.selected-background", "menu.selected-background-alpha", "foreground", 0.08)
  readonly property color selectedText: T.surface(shell, palette, "menu.selected-text", null, "accent", 1)

  // "monospace" is the fontconfig alias `omarchy font set` rewrites, as in
  // the shell's Style.qml.
  readonly property string fontFamily: "monospace"
  readonly property int fontSize: T.fontSize(shell, "base-size", 12)
  readonly property int fontSmall: T.fontSize(shell, "body-small", Math.round(fontSize * 0.917))
  readonly property int fontHeading: T.fontSize(shell, "heading", Math.round(fontSize * 1.333))
  readonly property int fontDisplay: T.fontSize(shell, "display", fontSize * 2)

  property FileView colorsFile: FileView {
    path: theme.themeDir + "/colors.toml"
    printErrors: false
    onLoaded: theme.palette = T.parseColors(text())
    onLoadFailed: theme.palette = T.parseColors("")
  }

  property FileView shellFile: FileView {
    path: theme.themeDir + "/shell.toml"
    printErrors: false
    onLoaded: theme.themeShell = T.parseShell(text())
    onLoadFailed: theme.themeShell = ({})
  }

  // `omarchy display text size` writes [font] base-size here.
  property FileView userShellFile: FileView {
    path: theme.home + "/.config/omarchy/shell.toml"
    watchChanges: true
    printErrors: false
    onLoaded: theme.userShell = T.parseShell(text())
    onLoadFailed: theme.userShell = ({})
    onFileChanged: reload()
  }

  // omarchy-theme-set replaces the whole theme directory (rm + mv), which
  // drops any watch on the files inside it, and then rewrites theme.name in
  // place. So theme.name is the one stable file to watch for a switch.
  property FileView themeName: FileView {
    path: theme.home + "/.local/state/omarchy/current/theme.name"
    watchChanges: true
    printErrors: false
    onFileChanged: {
      theme.colorsFile.reload()
      theme.shellFile.reload()
    }
  }
}
