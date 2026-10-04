# QML frontend: a thin Omarchy shell plugin plus a separate reader process

The Omarchy shell runs on Quickshell (Qt/QML). A plugin gets live theming, a bar widget and the shell's IPC for free, as `aweiward.omaqbt` shows. But a manga reader holds many large images. Inside the shell process, a crash or memory spike would take the bar down. So the plugin stays thin: a bar widget for updates and a launcher. The library and reader window run as their own Quickshell/QML process, built from the same QML and theme values.

## Considered Options

- Everything inside the shell plugin. Rejected: the reader's memory and crash risk would hit the bar.
- Rust + GTK4/libadwaita, or Tauri. Rejected: they look less like Omarchy and share nothing with the shell's QML.

## Consequences

- The window process must read the Omarchy theme itself. It cannot use the shell's in-process `qs.Commons`.
- Outside Omarchy, the window process can run alone. The plugin is the only Omarchy-only part.
