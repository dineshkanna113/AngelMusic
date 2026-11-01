// Publishes the playing cover's colour as CSS variables (--ambient, --ambient-ink) on :root.
// The Now Playing stage blooms from it; everything falls back to dusk/jasmine without art.
import { clampForText, pickAmbient } from "./color";

const SIZE = 32;
let canvas = null;
let lastSrc = null;

function set(color) {
  const root = document.documentElement.style;
  if (color) {
    root.setProperty("--ambient", `rgb(${color.r} ${color.g} ${color.b})`);
    root.setProperty("--ambient-ink", "var(--color-jasmine)");
  } else {
    root.removeProperty("--ambient");
    root.removeProperty("--ambient-ink");
  }
}

export const ambient = {
  /** Read the colour from a loaded <img>. A tainted canvas or a grey cover falls back. */
  fromImage(img) {
    if (!img?.complete || !img.naturalWidth || img.currentSrc === lastSrc) return;
    lastSrc = img.currentSrc;
    try {
      canvas ??= document.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const picked = pickAmbient(ctx.getImageData(0, 0, SIZE, SIZE).data);
      set(picked && clampForText(picked));
    } catch {
      set(null); // cross-origin image without CORS: keep the defaults
    }
  },
  reset() {
    lastSrc = null;
    set(null);
  },
};
