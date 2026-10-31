import { isHiRes } from "../lib/format";

export default function QualityBadge({ track }) {
  const label = track.lossless
    ? `${track.bit_depth ?? "?"}/${track.sample_rate ? +(track.sample_rate / 1000).toFixed(1) : "?"}`
    : `${Math.round((track.bitrate || 0) / 1000)}k`;
  // Hi-Res is the one lit badge; plain lossless reads in ink, lossy recedes.
  const tone = isHiRes(track)
    ? "border-accent/50 text-accent"
    : track.lossless
      ? "border-line text-fg-2"
      : "border-line text-muted";
  return (
    <span
      title={`${track.codec.toUpperCase()}, ${track.lossless ? "lossless" : "lossy"}`}
      className={`inline-flex items-center gap-1 rounded-pill border px-2 py-px text-[11px] font-medium leading-4 tabular-nums ${tone}`}
    >
      {track.codec.toUpperCase()} {label}
    </span>
  );
}
