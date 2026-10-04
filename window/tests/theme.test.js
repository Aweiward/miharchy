const { test } = require("node:test");
const assert = require("node:assert/strict");
const T = require("./load")("Theme.js");

const COLORS = `
base00 = "#302270" # comment
background = "#302270"
foreground = "#86f3f5"
muted = "#aa8acf"
accent = "#898efa"
red = "#ff50cf"
color0 = "#000000"
color4 = "#0000ff"
`;

const SHELL = `
# header
[menu]
background       = "#24196a"
background-alpha = 0.84
text             = "#b8f7f9"
selected-background = "rgb(75c4f4) rgb(898efa) 42deg"
selected-text    = accent
border-width     = "0 0"
[font]
base-size = 14
title = 16 # inline comment
`;

test("parseColors prefers semantic keys over ANSI slots", () => {
  assert.deepEqual(T.parseColors(COLORS), { foreground: "#86f3f5", background: "#302270", accent: "#898efa", urgent: "#ff50cf", muted: "#aa8acf" });
});

test("parseColors falls back to color0/4/7/8, then defaults", () => {
  const p = T.parseColors(`color0 = "#111111"\ncolor4 = "#444444"\ncolor7 = "#777777"\ncolor8 = "#888888"`);
  assert.deepEqual(p, { foreground: "#777777", background: "#111111", accent: "#444444", urgent: T.DEFAULT_PALETTE.urgent, muted: "#888888" });
  assert.deepEqual(T.parseColors(""), { ...T.DEFAULT_PALETTE, muted: T.DEFAULT_PALETTE.foreground }, "muted follows foreground, as in Color.qml");
});

test("parseShell flattens sections and accepts every value form", () => {
  const v = T.parseShell(SHELL);
  assert.equal(v["menu.background"], "#24196a");
  assert.equal(v["menu.background-alpha"], "0.84");
  assert.equal(v["menu.selected-text"], "accent");
  assert.equal(v["menu.border-width"], "0 0");
  assert.equal(v["font.title"], "16");
});

test("mergeShell lets the user override win", () => {
  assert.deepEqual(T.mergeShell({ "font.base-size": "12", "a.b": "x" }, { "font.base-size": "16" }), { "font.base-size": "16", "a.b": "x" });
});

test("surface composes color and alpha into #AARRGGBB", () => {
  const p = T.parseColors(COLORS);
  const v = T.parseShell(SHELL);
  assert.equal(T.surface(v, p, "menu.background", "menu.background-alpha", "background", 1), "#d624196a");
  assert.equal(T.surface(v, p, "menu.selected-background", "menu.selected-background-alpha", "accent", 0.5), "#8075c4f4", "first gradient stop, alpha fallback");
  assert.equal(T.surface(v, p, "menu.selected-text", null, "foreground", 1), "#ff898efa", "role name resolves to the palette");
  assert.equal(T.surface({}, p, "menu.scrim", "menu.scrim-alpha", "background", 0.5), "#80302270", "missing key falls back to the role");
  assert.equal(T.surface({ "x.c": "nonsense" }, p, "x.c", null, "muted", 1), "#ffaa8acf");
});

test("fontSize reads [font] keys with a fallback", () => {
  const v = T.parseShell(SHELL);
  assert.equal(T.fontSize(v, "base-size", 12), 14);
  assert.equal(T.fontSize(v, "display", 24), 24);
});
