// Story share cards: a 1080×1920 image of the song for Instagram, WhatsApp and the like.
import { coverUrl, streamToken } from "./api";

const W = 1080;
const H = 1920;
const PEARL = "#F7F2FF";
const MINT = "#D6F7EE";
const INK = "#19161F";
const MUTED = "#5A5466";
const LIME = "#C6FF3D";
const GUM = "#FF6FD8";

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
  // The Yaapu mark: an ink tile with a lime dot, tilted.
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.rotate((-8 * Math.PI) / 180);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.roundRect(-size / 2, -size / 2, size, size, size * 0.32);
  ctx.fill();
  ctx.fillStyle = LIME;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.23, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSticker(ctx, text, x, y, fill, tiltDeg) {
  ctx.save();
  ctx.font = '800 44px "Syne", sans-serif';
  const w = ctx.measureText(text).width + 64;
  ctx.translate(x, y);
  ctx.rotate((tiltDeg * Math.PI) / 180);
  ctx.shadowColor = "rgba(60,20,90,0.35)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.roundRect(0, 0, w, 88, 44);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(8, 8, w - 16, 72, 36);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 32, 46);
  ctx.restore();
}

/** Render the card for `track`; `ambient` is a CSS colour for the top of the gradient. */
export async function renderShareCard(track, ambient) {
  await document.fonts.load('800 80px "Syne"');
  await document.fonts.load('500 44px "Hanken Grotesk"');
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Pearl-to-mint ground, tinted at the top with the cover's colour.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, PEARL);
  bg.addColorStop(1, MINT);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  if (ambient) {
    const tint = ctx.createRadialGradient(W * 0.4, 700, 40, W * 0.4, 700, 900);
    tint.addColorStop(0, ambient);
    tint.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  // The cover: a white-bordered sticker, tilted.
  const size = 800;
  ctx.save();
  ctx.translate(W / 2, 640);
  ctx.rotate((-3 * Math.PI) / 180);
  ctx.shadowColor = "rgba(60,20,90,0.4)";
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 30;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.roundRect(-size / 2 - 20, -size / 2 - 20, size + 40, size + 40, 90);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.beginPath();
  ctx.roundRect(-size / 2, -size / 2, size, size, 70);
  ctx.clip();
  ctx.fillStyle = "#E7E2F0";
  ctx.fillRect(-size / 2, -size / 2, size, size);
  if (track.has_cover) {
    try {
      const img = await loadImage(coverUrl(track.id, await streamToken.get()));
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
    } catch {
      // keep the plain square
    }
  }
  ctx.restore();

  if (track.play_count >= 3) drawSticker(ctx, "on repeat", W - 420, 250, LIME, 8);
  if (track.lossless && ((track.bit_depth ?? 0) > 16 || (track.sample_rate ?? 0) > 48000)) drawSticker(ctx, "hi-res", 70, 380, "#9BE7FF", -6);

  let y = 1220;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK;
  // Syne is wide: step the size down until the whole title fits without an ellipsis.
  let titleSize = 86;
  let titleLines;
  for (const size of [86, 74, 64, 54]) {
    titleSize = size;
    ctx.font = `800 ${size}px "Syne", "Noto Sans Tamil", sans-serif`;
    titleLines = wrapLines((t) => ctx.measureText(t).width, track.title, 860, 3);
    if (!titleLines.some((l) => l.endsWith("…")) || size === 54) break;
  }
  for (const line of titleLines) {
    ctx.fillText(line, 110, y);
    y += titleSize * 1.1;
  }
  ctx.fillStyle = MUTED;
  ctx.font = '600 46px "Hanken Grotesk", "Noto Sans Tamil", sans-serif';
  y += 8;
  for (const line of wrapLines((t) => ctx.measureText(t).width, track.artist || "", 860, 2)) {
    ctx.fillText(line, 110, y);
    y += 60;
  }

  drawMark(ctx, 110, H - 200, 76);
  ctx.fillStyle = INK;
  ctx.font = '800 72px "Syne", sans-serif';
  ctx.fillText("yaapu", 210, H - 138);
  ctx.fillStyle = MUTED;
  ctx.font = '600 34px "Hanken Grotesk", sans-serif';
  ctx.fillText("Listen with me on Yaapu", 110, H - 80);
  ctx.fillStyle = GUM;
  ctx.beginPath();
  ctx.arc(W - 130, H - 130, 22, 0, Math.PI * 2);
  ctx.fill();

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
