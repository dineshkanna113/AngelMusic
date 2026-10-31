import { isHiRes } from "../lib/format";

export default function QualityBadge({ track }) {
  const label = track.lossless
    ? `${track.bit_depth ?? "?"}/${track.sample_rate ? +(track.sample_rate / 1000).toFixed(1) : "?"}`
    : `${Math.round((track.bitrate || 0) / 1000)}k`;
  const tone = isHiRes(track)
    ? "border-gold/50 text-gold"
    : track.lossless
      ? "border-accent/40 text-accent"
      : "border-line text-muted";
  return (
    <span
      title={`${track.codec.toUpperCase()} · ${track.lossless ? "lossless" : "lossy"}`}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[10px] leading-4 tabular-nums ${tone}`}
    >
      {track.codec.toUpperCase()} {label}
    </span>
  );
}
