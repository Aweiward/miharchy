.pragma library

// Every child process the mark and the window read runs through command():
// a deadline, and its stdout cut at the producer to cap + 1 bytes, so a
// runaway child can neither hang a job nor fill the shell's memory. A
// result over cap bytes is an error (over()). timeout kills the child's
// whole process group; stdbuf keeps head from holding live lines back.
// The tools go by full path: a job may run with a PATH of its own.
function command(argv, cap, seconds) {
  return ["/bin/sh", "-c", "t=$1 c=$2; shift 2; /usr/bin/timeout -k 5 \"$t\" \"$@\" | /usr/bin/stdbuf -o0 /usr/bin/head -c \"$c\"", "sh", String(seconds), String(cap + 1)].concat(argv)
}

// Whether output passed cap bytes. head counts bytes, a JS string UTF-16
// units, so count its UTF-8 bytes.
function over(text, cap) {
  return encodeURIComponent(String(text)).replace(/%[0-9A-F]{2}/g, "x").length > cap
}

if (typeof module !== "undefined") {
  module.exports = { command: command, over: over }
}
