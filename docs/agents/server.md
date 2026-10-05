# Suwayomi-Server

How the server runs, and how its credentials stay private.

- Suwayomi-Server runs as the systemd user service `miharchy-server`, from `~/.local/share/miharchy/suwayomi` (mode 700), on `127.0.0.1:4590` with `basic_auth`. `server/miharchy-server` sets it up and is safe to rerun.
- Suwayomi rewrites its `server.conf` with mode 644, so the 700 folder is what keeps the password private.
- No URL carries the credentials. QML `Image` cannot send an Authorization header, and it does not share the cookies of an XHR. So every image from the server goes through `window/ServerImage.qml`: an XHR with the header fetches the bytes, a `FileView` writes them to `$XDG_RUNTIME_DIR/miharchy/images/`, and the `Image` shows that file. Each instance owns its files and empties them when its image changes or it is destroyed. `Model.imageRequest` decides what is the server's: an image from any other host loads as a plain `Image`, without the header.
