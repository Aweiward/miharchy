# Setup installs dependencies through Omarchy, not an AUR package

Miharchy installs only as an Omarchy plugin (`omarchy plugin add`), and there will be no AUR package (#43 closed). pacman cannot place a plugin where Omarchy looks for it (`~/.config/omarchy/plugins/`), so a full package would need a per-user link and a second update channel beside `omarchy plugin update`; a package of dependencies only would duplicate Setup. A stock Omarchy already has Quickshell, `jq`, `curl`, `docker`, `qrencode` and `yay`; it lacks a JDK 21+, `qt6-websockets` and `suwayomi-server-bin`. So Setup installs those itself, through Omarchy's own installers (`omarchy-pkg-add`, `omarchy-pkg-aur-add`) in Omarchy's floating terminal: the user sees the exact command and types the sudo password there. Miharchy never runs `sudo` out of sight and never sees the password.

## Considered Options

- An AUR package with the plugin, the unit and the helper. Rejected: a per-user link and two update channels for one plugin.
- An AUR package of dependencies only. Rejected: Setup can do the same in one step, on the machine it already checks.
- Keep showing commands to copy. Rejected: three commands to copy is where a new user stops.

## Consequences

- Supersedes ADR 0005's line that the package caps `suwayomi-server-bin` at the checked version. The cap moves to install time: before it installs, Setup reads the AUR's version (`yay -Si`) and asks first when it is newer than `APPROVED_SUWAYOMI`. The runtime warning stays.
- Setup's rule becomes "never runs an install command without a terminal the user sees", in place of "never runs an install command".
