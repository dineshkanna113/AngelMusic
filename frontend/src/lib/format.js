export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export const formatRate = (hz) => (hz ? `${+(hz / 1000).toFixed(1)} kHz` : "?");

/** e.g. "24-bit / 96 kHz" */
export function formatResolution(track) {
  const depth = track.bit_depth ? `${track.bit_depth}-bit` : null;
  return [depth, formatRate(track.sample_rate)].filter(Boolean).join(" / ");
}

export const isHiRes = (track) => track.lossless && ((track.bit_depth ?? 0) > 16 || (track.sample_rate ?? 0) > 48000);

export const formatBitrate = (bps) => (bps ? `${Math.round(bps / 1000)} kbps` : "");

export const formatSize = (bytes) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** "just now", "5 min ago", "3 h ago", "2 d ago" from a UTC SQLite timestamp or ISO string. */
export function timeAgo(value, now = Date.now()) {
  const t = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/**
 * Syne is wide, so a long name set at the biggest size breaks mid-word. Pick a size class by
 * length: short names stay big, long ones step down.
 */
export const headingSize = (text) =>
  text.length <= 10 ? "text-[clamp(2.4rem,5.5vw,4.2rem)]" : text.length <= 18 ? "text-[clamp(1.9rem,3.8vw,3rem)]" : "text-[clamp(1.5rem,2.8vw,2.3rem)]";

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
