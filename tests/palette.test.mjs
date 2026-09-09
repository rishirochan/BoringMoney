import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

// Account colours must stay far enough apart to tell one card from another at dot and
// stripe sizes. Hue alone is not enough: the original palette shared L and C, and its
// closest pair sat at 0.082, which read as a single blue-green.
const MIN_DISTANCE = 0.12;

test("account colours are perceptually distinguishable", () => {
  const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const colors = [...css.matchAll(/--source-color-\d+: oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/g)]
    .map(([, l, c, h]) => {
      const radians = (Number(h) * Math.PI) / 180;
      return [Number(l), Number(c) * Math.cos(radians), Number(c) * Math.sin(radians)];
    });
  assert.equal(colors.length, 6, "expected six account colours");

  for (const [i, a] of colors.entries()) {
    for (const b of colors.slice(i + 1)) {
      const distance = Math.hypot(...a.map((value, axis) => value - b[axis]));
      assert.ok(distance >= MIN_DISTANCE, `colours ${i} and ${colors.indexOf(b)} are ${distance.toFixed(3)} apart`);
    }
  }
});
