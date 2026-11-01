// Colour from cover art, for the Now Playing bloom. Pure functions; lib/ambient.js does the DOM side.

const JASMINE = { r: 246, g: 239, b: 227 };
const MIN_SATURATION = 0.25;

function hsl({ r, g, b }) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: h / 6, s, l };
}

function rgb({ h, s, l }) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: Math.round(channel(h + 1 / 3) * 255), g: Math.round(channel(h) * 255), b: Math.round(channel(h - 1 / 3) * 255) };
}

function luminance({ r, g, b }) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The cover's most common saturated colour, from RGBA pixels. Greys and transparent pixels
 * don't count, so a small vivid area beats a large dull one. Null when nothing qualifies.
 */
export function pickAmbient(pixels) {
  const buckets = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const c = { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2] };
    if (hsl(c).s < MIN_SATURATION) continue;
    const key = ((c.r >> 4) << 8) | ((c.g >> 4) << 4) | (c.b >> 4);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n += 1;
    bucket.r += c.r;
    bucket.g += c.g;
    bucket.b += c.b;
    buckets.set(key, bucket);
  }
  let best = null;
  for (const bucket of buckets.values()) if (!best || bucket.n > best.n) best = bucket;
  return best && { r: Math.round(best.r / best.n), g: Math.round(best.g / best.n), b: Math.round(best.b / best.n) };
}

/** Darken (keeping the hue) until jasmine text on the colour reaches 4.5:1. */
export function clampForText(color) {
  let c = color;
  const shade = hsl(color);
  while (contrast(c, JASMINE) < 4.5 && shade.l > 0) {
    shade.l = Math.max(0, shade.l - 0.02);
    c = rgb(shade);
  }
  return c;
}
