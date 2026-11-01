import { describe, expect, it } from "vitest";
import { clampForText, contrast, pickAmbient } from "./color";

const JASMINE = { r: 246, g: 239, b: 227 };

function pixels(parts, total = 1000) {
  // parts: [[{r,g,b,a?}, share], ...] -> RGBA buffer of `total` pixels
  const out = new Uint8ClampedArray(total * 4);
  let i = 0;
  for (const [c, share] of parts) {
    const n = Math.round(total * share);
    for (let k = 0; k < n && i < total; k++, i++) out.set([c.r, c.g, c.b, c.a ?? 255], i * 4);
  }
  return out;
}

describe("pickAmbient", () => {
  it("returns the dominant saturated colour, ignoring greys", () => {
    const c = pickAmbient(pixels([[{ r: 200, g: 40, b: 60 }, 0.7], [{ r: 128, g: 128, b: 128 }, 0.3]]));
    expect(Math.abs(c.r - 200)).toBeLessThanOrEqual(16);
    expect(Math.abs(c.g - 40)).toBeLessThanOrEqual(16);
    expect(Math.abs(c.b - 60)).toBeLessThanOrEqual(16);
  });

  it("prefers a saturated minority over a grey majority", () => {
    const c = pickAmbient(pixels([[{ r: 30, g: 30, b: 30 }, 0.8], [{ r: 20, g: 160, b: 200 }, 0.2]]));
    expect(c.b).toBeGreaterThan(c.r);
  });

  it("returns null for an all-grey cover", () => {
    expect(pickAmbient(pixels([[{ r: 90, g: 90, b: 92 }, 1]]))).toBeNull();
  });

  it("returns null for a fully transparent image", () => {
    expect(pickAmbient(pixels([[{ r: 255, g: 0, b: 0, a: 0 }, 1]]))).toBeNull();
  });
});

describe("clampForText", () => {
  it("darkens a near-white colour until jasmine text reads on it", () => {
    const c = clampForText({ r: 250, g: 240, b: 200 });
    expect(contrast(c, JASMINE)).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves an already dark colour nearly unchanged", () => {
    const c = clampForText({ r: 5, g: 5, b: 5 });
    expect(contrast(c, JASMINE)).toBeGreaterThanOrEqual(4.5);
    expect(Math.max(Math.abs(c.r - 5), Math.abs(c.g - 5), Math.abs(c.b - 5))).toBeLessThanOrEqual(30);
  });

  it("keeps the hue of a bright saturated colour", () => {
    const c = clampForText({ r: 255, g: 176, b: 32 });
    expect(contrast(c, JASMINE)).toBeGreaterThanOrEqual(4.5);
    expect(c.r).toBeGreaterThan(c.b);
  });
});

describe("contrast", () => {
  it("matches the WCAG ratio for black on white", () => {
    expect(contrast({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 1);
  });
});
