.pragma library

// Why a source request failed, from its error message: what Model.reply
// leaves of a Suwayomi GraphQL error. Suwayomi keeps no reason of its own
// (a download only has state ERROR), so the download queue probes a failed
// chapter and labels the probe's message here; any other failed request
// can be labelled the same way. Pure, so tests/failure.test.js pins it
// against messages seen from the server.

// In order: the first kind whose test matches wins, so a Cloudflare
// timeout is Cloudflare and a source that is not installed is not "not
// found".
var KINDS = [
  { kind: "sourceMissing", test: /source not installed/i, text: "Source not installed" },
  { kind: "cloudflare", test: /cloudflare|just a moment/i, text: "Cloudflare blocked the source" },
  { kind: "notFound", test: /\b404\b|not found/i, text: "Not found on the source" },
  { kind: "network", test: /timeout|timed out|failed to connect|connection (refused|reset)|unable to resolve host|name or service not known|no address associated|network is unreachable/i, text: "No connection to the source" }
]

var MAX_TEXT = 60

function shortened(text) {
  return text.length <= MAX_TEXT ? text : text.slice(0, MAX_TEXT - 1) + "…"
}

// -> { kind, text }: kind one of KINDS' or "other", text for people;
// other carries the message itself, shortened.
function reason(message) {
  var m = String(message || "")
  for (var i = 0; i < KINDS.length; i++) {
    if (KINDS[i].test.test(m)) return { kind: KINDS[i].kind, text: KINDS[i].text }
  }
  return { kind: "other", text: shortened(m.trim() || "Unknown error") }
}

// miharchy-core's error { kind, message } as reason() gives it: core
// names the kind, so only "Source not installed" is read from the text.
function coreReason(error) {
  var m = String((error && error.message) || "")
  if (/source not installed/i.test(m)) return { kind: "sourceMissing", text: "Source not installed" }
  switch (error && error.kind) {
    case "cloudflare": return { kind: "cloudflare", text: "Cloudflare blocked the source" }
    case "network": return { kind: "network", text: "No connection to the source" }
  }
  return { kind: "other", text: shortened(m.trim() || "Unknown error") }
}

// What the user can do about it, or "". flareOn: the server's
// flareSolverrEnabled, the half of Setup's FlareSolverr step the window
// can see without Setup's probe.
function hint(r, flareOn) {
  if (r.kind === "cloudflare" && !flareOn) return "set up FlareSolverr in Setup"
  if (r.kind === "sourceMissing") return "see the library check, ! on the Library"
  return ""
}

if (typeof module !== "undefined") {
  module.exports = {
    coreReason: coreReason,
    KINDS: KINDS,
    MAX_TEXT: MAX_TEXT,
    reason: reason,
    hint: hint
  }
}
