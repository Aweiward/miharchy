const { test } = require("node:test");
const assert = require("node:assert/strict");
const S = require("./load")("Scan.js");

// RGBA bytes of a w x h page: gray(x, y) -> 0..255 for each pixel.
const page = (w, h, gray) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = gray(x, y), i = (y * w + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  return data;
};
// Art inside the rect [x0, x1) x [y0, y1), margin elsewhere: a busy
// pattern that never reads as plain.
const framed = (w, h, margin, x0, y0, x1, y1) => page(w, h, (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1 ? 60 + (x * 37 + y * 11) % 120 : margin);
const near = (box, want) => {
  assert.ok(box, "a crop");
  for (const k of Object.keys(want)) assert.ok(Math.abs(box[k] - want[k]) < 0.015, k + ": " + box[k] + " vs " + want[k]);
};

test("a white margin crops on all four sides in paged, the left and right in webtoon", () => {
  const s = S.analyze(framed(100, 140, 255, 10, 14, 90, 126), 100, 140);
  near(s.page, { x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
  near(s.strip, { x: 0.1, y: 0, width: 0.8, height: 1 });
});

test("a black margin crops as a white one does", () => {
  near(S.analyze(framed(100, 140, 0, 8, 7, 92, 133), 100, 140).page, { x: 0.08, y: 0.05, width: 0.84, height: 0.9 });
});

test("each side reads its own margin: white on one, black on another, none on a third", () => {
  const data = page(100, 140, (x, y) => x < 10 ? 255 : x >= 95 ? 0 : y < 14 ? 255 : 60 + (x * 37 + y * 11) % 120);
  near(S.analyze(data, 100, 140).page, { x: 0.1, y: 0.1, width: 0.85, height: 0.9 });
});

test("no side loses more than a quarter of the page", () => {
  near(S.analyze(framed(100, 140, 255, 40, 0, 100, 140), 100, 140).page, { x: 0.25, y: 0, width: 0.75, height: 1 });
});

test("a crop that would keep less than 60% of the page leaves it whole", () => {
  const s = S.analyze(framed(100, 140, 255, 20, 21, 80, 119), 100, 140);
  assert.equal(s.page, null, "0.6 x 0.7 keeps 42%");
  near(s.strip, { x: 0.2, width: 0.6 });
});

test("a mostly white text page stays whole", () => {
  const text = page(100, 140, (x, y) => x >= 22 && x < 78 && y >= 30 && y < 110 && y % 6 < 2 && (x * 7) % 9 < 6 ? 20 : 255);
  assert.equal(S.analyze(text, 100, 140).page, null);
});

test("a page with art to its edges has nothing to crop", () => {
  const s = S.analyze(framed(100, 140, 255, 0, 0, 100, 140), 100, 140);
  assert.deepEqual([s.page, s.strip], [null, null]);
  assert.equal(S.analyze(page(100, 140, () => 255), 100, 140).page, null, "a blank page stays whole");
});

test("scan noise in the margin still crops: grain and a few specks", () => {
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const data = page(100, 140, (x, y) => {
    if (x >= 10 && x < 90 && y >= 14 && y < 126) return 60 + (x * 37 + y * 11) % 120;
    return rand() < 0.01 ? 30 : 255 - Math.floor(rand() * 25);
  });
  near(S.analyze(data, 100, 140).page, { x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
});

test("a wide page crops each half on its own, in fractions of the whole page", () => {
  const data = page(200, 140, (x, y) => (x >= 10 && x < 92 && y >= 14 && y < 126) || (x >= 104 && x < 196 && y >= 7 && y < 133) ? 60 + (x * 37 + y * 11) % 120 : 255);
  const s = S.analyze(data, 200, 140);
  near(s.halves[0], { x: 0.05, y: 0.1, width: 0.41, height: 0.8 });
  near(s.halves[1], { x: 0.52, y: 0.05, width: 0.46, height: 0.9 });
  assert.equal(S.analyze(framed(100, 140, 255, 10, 14, 90, 126), 100, 140).halves, null, "a tall page has no halves");
});

test("the analysis knows the page's luminance, for Auto levels", () => {
  const s = S.analyze(page(2, 1, (x) => x ? 255 : 0), 2, 1);
  assert.deepEqual(Array.from(S.luminance(page(2, 1, (x) => x ? 255 : 0))), [0, 255]);
  assert.deepEqual([s.width, s.height], [2, 1]);
});

// Auto levels: { black, white } in luminance 0..255 for the part a mode
// shows, null to leave the page as it is.
const rgba = (w, h, color) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = color(x, y), i = (y * w + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return data;
};
// Art whose luminance runs evenly from lo to hi.
const ramp = (lo, hi) => (x, y) => lo + ((x * 37 + y * 11) % 100) * (hi - lo) / 99;

test("a muddy page gets its darkest part as the black point and its lightest as the white", () => {
  const s = S.analyze(page(100, 140, ramp(60, 190)), 100, 140);
  assert.deepEqual(s.levels.page, { black: 60, white: 190 });
  assert.deepEqual(s.levels.strip, { black: 60, white: 190 });
});

test("a page that already spans the range is left as it is", () => {
  assert.equal(S.analyze(page(100, 140, ramp(0, 255)), 100, 140).levels.page, null);
  assert.equal(S.analyze(page(100, 140, ramp(20, 235)), 100, 140).levels.page, null, "a range of 215 is not clearly narrow");
  assert.deepEqual(S.analyze(page(100, 140, ramp(25, 225)), 100, 140).levels.page, { black: 25, white: 225 }, "200 is");
});

test("at most 0.5% of the page clips at each end: specks past it move neither point", () => {
  const specks = (n, v) => (x, y) => y * 100 + x < n ? v : ramp(60, 190)(x, y);
  assert.deepEqual(S.analyze(page(100, 140, specks(70, 0)), 100, 140).levels.page, { black: 60, white: 190 }, "70 black pixels of 14000 clip");
  assert.equal(S.analyze(page(100, 140, specks(80, 0)), 100, 140).levels.page.black, 0, "80 are more than 0.5%");
  assert.deepEqual(S.analyze(page(100, 140, specks(70, 255)), 100, 140).levels.page, { black: 60, white: 190 });
});

test("a blank or flat page is left as it is: a stretch would only show its grain", () => {
  assert.equal(S.analyze(page(100, 140, () => 255), 100, 140).levels.page, null);
  assert.equal(S.analyze(page(100, 140, ramp(120, 170)), 100, 140).levels.page, null);
});

test("a color page reads its luminance, one pair of points for all three channels", () => {
  const colors = [[255, 0, 0], [0, 0, 255], [0, 255, 0], [190, 190, 190]];
  const s = S.analyze(rgba(100, 140, (x, y) => colors[(x + y) % 4]), 100, 140);
  assert.deepEqual(s.levels.page, { black: 29, white: 190 }, "red, green and blue each span 0 to 255, their luminance does not");
});

test("levels read the part shown: inside the crop box, and each half on its own", () => {
  const framedMud = page(100, 140, (x, y) => x >= 10 && x < 90 && y >= 14 && y < 126 ? ramp(60, 190)(x, y) : 255);
  assert.deepEqual(S.analyze(framedMud, 100, 140).levels.page, { black: 60, white: 190 }, "the white margin is not the white point");
  const wide = page(200, 140, (x, y) => x < 100 ? ramp(60, 190)(x, y) : ramp(0, 255)(x, y));
  assert.deepEqual(S.analyze(wide, 200, 140).levels.halves, [{ black: 60, white: 190 }, null]);
  assert.equal(S.analyze(framedMud, 100, 140).levels.halves, null, "a tall page has no halves");
});

test("the effect stretches the black point to black and the white point to white, linearly", () => {
  // MultiEffect's shader: (v - 0.5) * (1 + contrast) + 0.5 + brightness.
  const shade = (e, v) => ((v / 255 - 0.5) * (1 + e.contrast) + 0.5 + e.brightness) * 255;
  const e = S.effect({ black: 60, white: 190 });
  assert.ok(Math.abs(shade(e, 60)) < 1e-9 && Math.abs(shade(e, 190) - 255) < 1e-9);
  assert.ok(Math.abs(shade(e, 125) - 127.5) < 1e-9, "the middle stays the middle");
  assert.equal(S.effect(null), null);
});
