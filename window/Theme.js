.pragma library

// Reads the active Omarchy theme the way the shell does
// (~/.local/share/omarchy/shell/Commons/Color.qml), since the window runs
// outside the shell and cannot import qs.Commons (ADR 0003).

var DEFAULT_PALETTE = { foreground: "#cacccc", background: "#101315", accent: "#cacccc", urgent: "#a55555" }

// colors.toml text -> { foreground, background, accent, urgent, muted },
// with Color.qml's color0/4/7/8 fallbacks for themes without semantic keys.
function parseColors(raw) {
  var p = {}
  var ansi = {}
  var lines = String(raw || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(/^\s*([A-Za-z0-9_-]+)\s*=\s*["']?(#[0-9A-Fa-f]{6})/)
    if (!m) continue
    var k = m[1]
    if (k === "foreground" || k === "background" || k === "accent" || k === "muted") p[k] = m[2]
    else if (k === "red" || k === "color1") p.urgent = m[2]
    else if (/^color[0478]$/.test(k)) ansi[k] = m[2]
  }
  var fg = p.foreground || ansi.color7 || DEFAULT_PALETTE.foreground
  return {
    foreground: fg,
    background: p.background || ansi.color0 || DEFAULT_PALETTE.background,
    accent: p.accent || ansi.color4 || DEFAULT_PALETTE.accent,
    urgent: p.urgent || DEFAULT_PALETTE.urgent,
    muted: p.muted || ansi.color8 || fg
  }
}

// shell.toml text -> flat { "section.key": raw string }. Same grammar as
// Color.qml's parseShell: quoted strings, numbers, width lists, bare roles.
function parseShell(raw) {
  var parsed = {}
  var lines = String(raw || "").split("\n")
  var section = ""
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/^\s+|\s+$/g, "")
    if (!line || line.charAt(0) === "#") continue
    var sectionMatch = line.match(/^\[([A-Za-z0-9_-]+)\]\s*(#.*)?$/)
    if (sectionMatch) { section = sectionMatch[1]; continue }
    var kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*["']([^"']+)["']\s*(#.*)?$/)
      || line.match(/^([A-Za-z0-9_-]+)\s*=\s*(-?\d+(?:\.\d+)?)\s*(#.*)?$/)
      || line.match(/^([A-Za-z0-9_-]+)\s*=\s*(-?\d+(?:\.\d+)?(?:\s+-?\d+(?:\.\d+)?){1,3})\s*(#.*)?$/)
      || line.match(/^([A-Za-z0-9_-]+)\s*=\s*([A-Za-z][A-Za-z0-9_-]*)\s*(#.*)?$/)
    if (!kv || !section) continue
    parsed[section + "." + kv[1]] = kv[2]
  }
  return parsed
}

// The theme user override wins key by key, as in Color.qml's mergeShell.
function mergeShell(theme, user) {
  var merged = {}
  for (var t in theme) merged[t] = theme[t]
  for (var u in user) merged[u] = user[u]
  return merged
}

// A shell.toml color token -> "#rrggbb", or null. Takes the first stop of
// a gradient ("rgb(75c4f4) rgb(898efa) 42deg") and resolves role names.
function flatColor(token, palette) {
  var parts = String(token || "").trim().split(/\s+/)
  var first = parts[0] || ""
  var role = first.toLowerCase()
  if (role === "text") role = "foreground"
  if (palette[role]) return palette[role]
  var m = first.match(/^#([0-9a-fA-F]{6})$/) || first.match(/^rgba?\(([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?\)$/)
  return m ? "#" + m[1].toLowerCase() : null
}

// A surface color as "#AARRGGBB" from shell values, e.g.
// surface(v, p, "menu.background", "menu.background-alpha", "background", 1).
function surface(values, palette, colorKey, alphaKey, fallbackRole, alphaFallback) {
  var rgb = flatColor(values[colorKey], palette) || palette[fallbackRole]
  var a = alphaKey ? Number(values[alphaKey]) : NaN
  if (!isFinite(a) || values[alphaKey] === undefined) a = alphaFallback
  a = Math.max(0, Math.min(1, a))
  var hex = Math.round(a * 255).toString(16)
  return "#" + (hex.length < 2 ? "0" + hex : hex) + rgb.slice(1)
}

function fontSize(values, key, fallback) {
  var n = parseInt(values["font." + key], 10)
  return isFinite(n) && n > 0 ? n : fallback
}

if (typeof module !== "undefined") {
  module.exports = {
    DEFAULT_PALETTE: DEFAULT_PALETTE,
    parseColors: parseColors,
    parseShell: parseShell,
    mergeShell: mergeShell,
    flatColor: flatColor,
    surface: surface,
    fontSize: fontSize
  }
}
