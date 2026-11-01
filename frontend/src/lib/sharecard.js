// Story share cards: a 1080×1920 image of the song for Instagram, WhatsApp and the like.
import { coverUrl, streamToken } from "./api";

const W = 1080;
const H = 1920;
const NIGHT = "#160F1E";
const JASMINE = "#F6EFE3";
const MIST = "#A497B0";
const MARIGOLD = "#FFB020";

/**
 * Break `text` into lines no wider than `maxWidth` (as `measure` reports), at most
 * `maxLines`; the last line ends in an ellipsis when text is left over. A single word
 * wider than the line is cut too.
 */
export function wrapLines(measure, text, maxWidth, maxLines) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  let i = 0;
  while (i < words.length && lines.length < maxLines) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (measure(next) <= maxWidth) {
      line = next;
      i++;
    } else if (line) {
      lines.push(line); // the word starts the next line
      line = "";
    } else {
      lines.push(ellipsize(measure, words[i], maxWidth)); // one word wider than the line
      i++;
    }
  }
  if (line && lines.length < maxLines) {
    lines.push(line);
    line = "";
  }
  if (i < words.length && lines.length) {
    lines[lines.length - 1] = ellipsize(measure, lines[lines.length - 1], maxWidth, true);
  }
  return lines;
}

function ellipsize(measure, text, maxWidth, always = false) {
  if (!always && measure(text) <= maxWidth) return text;
  let s = text.replace(/…$/, "");
  while (s && measure(`${s}…`) > maxWidth) s = s.slice(0, -1).trimEnd();
  return `${s}…`;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawMark(ctx, x, y, size) {
  // Long, short, long: the same bars as the Yaapu mark (24-unit box).
  const u = size / 24;
  ctx.fillStyle = MARIGOLD;
  for (const [bx, by, h, alpha] of [[3, 3, 18, 1], [9.75, 9, 12, 0.7], [16.5, 3, 18, 1]]) {
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.roundRect(x + bx * u, y + by * u, 4.5 * u, h * u, 2.25 * u);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Render the card for `track`; `ambient` is a CSS colour for the top of the gradient. */
export async function renderShareCard(track, ambient = "#251A30") {
  await document.fonts.load('800 80px "Bricolage Grotesque"');
  await document.fonts.load('500 44px "Hanken Grotesk"');
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, ambient);
  bg.addColorStop(0.75, NIGHT);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const cover = { x: 140, y: 300, size: 800 };
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(cover.x, cover.y, cover.size, cover.size, 40);
  ctx.clip();
  ctx.fillStyle = "#251A30";
  ctx.fillRect(cover.x, cover.y, cover.size, cover.size);
  if (track.has_cover) {
    try {
      const img = await loadImage(coverUrl(track.id, await streamToken.get()));
      ctx.drawImage(img, cover.x, cover.y, cover.size, cover.size);
    } catch {
      // keep the plain square
    }
  }
  ctx.restore();

  let y = cover.y + cover.size + 120;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = JASMINE;
  ctx.font = '800 92px "Bricolage Grotesque", "Noto Sans Tamil", sans-serif';
  if ("fontStretch" in ctx) ctx.fontStretch = "condensed";
  for (const line of wrapLines((s) => ctx.measureText(s).width, track.title, 800, 3)) {
    ctx.fillText(line, 140, y);
    y += 96;
  }
  if ("fontStretch" in ctx) ctx.fontStretch = "normal";
  ctx.fillStyle = MIST;
  ctx.font = '500 46px "Hanken Grotesk", "Noto Sans Tamil", sans-serif';
  y += 4;
  for (const line of wrapLines((s) => ctx.measureText(s).width, track.artist || "", 800, 2)) {
    ctx.fillText(line, 140, y);
    y += 58;
  }

  drawMark(ctx, 140, H - 196, 64);
  ctx.fillStyle = JASMINE;
  ctx.font = '800 64px "Bricolage Grotesque", sans-serif';
  ctx.fillText("yaapu", 220, H - 140);
  ctx.fillStyle = MIST;
  ctx.font = '500 34px "Hanken Grotesk", sans-serif';
  ctx.fillText("Listen with me on Yaapu", 140, H - 80);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
