.pragma library

// The window runs as its own process, so after `omarchy plugin update` it
// keeps running the code it loaded. These decide when that code changed on
// disk and how a restart starts a new window.

// The bytes of the window's QML and JS are the version it runs. A git HEAD
// would miss a dev checkout's edits and an install without git. $1 is the
// window folder; the check only reads.
var FINGERPRINT = 'cat "$1"/*.qml "$1"/*.js | sha256sum'

function fingerprintCommand(dir) {
  return ["sh", "-c", FINGERPRINT, "sh", dir]
}

// start: the fingerprint of the code this process loaded, from the first
// check. changed: the files on disk differ from it now.
var INITIAL = { start: "", changed: false }

function check(state, output) {
  var m = /^[0-9a-f]{64}\b/.exec(String(output || ""))
  if (!m) return state
  if (!state.start) return { start: m[0], changed: false }
  return { start: state.start, changed: m[0] !== state.start }
}

// Waits until the process pid has ended, then runs the launcher: its
// `quickshell -n` refuses to start while the old window runs. An ended
// process its parent has not reaped yet counts as ended. The new window
// opens on the Library, not on what started the old one.
var RELAUNCH = 'while [ -d "/proc/$1" ] && ! grep -qs "^State:.Z" "/proc/$1/status"; do sleep 0.2; done; unset MIHARCHY_OPEN_CHAPTER MIHARCHY_OPEN_VIEW; exec "$2"'

function relaunchCommand(pid, launcher) {
  return ["sh", "-c", RELAUNCH, "sh", String(pid), launcher]
}

if (typeof module !== "undefined") {
  module.exports = {
    INITIAL: INITIAL,
    fingerprintCommand: fingerprintCommand,
    check: check,
    relaunchCommand: relaunchCommand
  }
}
