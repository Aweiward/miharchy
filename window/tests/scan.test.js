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
