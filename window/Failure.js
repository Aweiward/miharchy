.pragma library

// Why a source request failed, from its error message. The download queue
// labels a failed chapter with it, and any other failed request can be
// labelled the same way. Pure, so tests/failure.test.js pins it against
// messages seen from the server.

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

// miharchy-core's error { kind, message } as reason() gives it. The text
// decides first ("HTTP 404" comes as kind network), then core's kind.
function coreReason(error) {
  var r = reason(error && error.message)
  var kind = error && error.kind
  if (r.kind !== "other" || (kind !== "cloudflare" && kind !== "network")) return r
  return KINDS.filter(function(k) { return k.kind === kind }).map(function(k) { return { kind: k.kind, text: k.text } })[0]
}

if (typeof module !== "undefined") {
  module.exports = {
    coreReason: coreReason,
    KINDS: KINDS,
    MAX_TEXT: MAX_TEXT,
    reason: reason
  }
}
