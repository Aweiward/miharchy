.pragma library
.import "Capped.js" as Capped

// The one folder the window writes its runtime files into (server images,
// the reading card, Setup's QR code): $XDG_RUNTIME_DIR/miharchy. shell.qml
// checks it once at start, as plugin/Mark.js and window/miharchy do: made
// 0700, and the user's own real directory, not a symlink planted there.
// With no XDG_RUNTIME_DIR, or a failed check, it is "" and each feature
// that would write there does nothing: never a path from /, never /tmp.

// $XDG_RUNTIME_DIR/miharchy, or "" when the variable is unset or empty.
function candidate(env) {
  return env ? env + "/miharchy" : ""
}

// Prints ok once dir is ready. images/ holds the server images.
function checkCommand(dir) {
  return Capped.command(["sh", "-c",
    "(umask 077; mkdir -p \"$1\") 2>/dev/null\n" +
    "[ -d \"$1\" ] && [ ! -L \"$1\" ] && [ -O \"$1\" ] || exit 0\n" +
    "(umask 077; mkdir -p \"$1/images\") 2>/dev/null && echo ok",
    "sh", dir], 16, 10)
}

var checked = ""

// checkCommand's output -> the folder to write into, or "". Kept for
// folder(): .pragma library keeps one copy per process.
function decide(dir, text) {
  checked = dir && String(text).trim() === "ok" ? dir : ""
  return checked
}

function folder() {
  return checked
}

if (typeof module !== "undefined") {
  module.exports = { candidate: candidate, checkCommand: checkCommand, decide: decide, folder: folder }
}
