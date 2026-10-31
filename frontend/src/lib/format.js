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

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
