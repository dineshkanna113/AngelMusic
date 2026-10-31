import { useEffect, useState } from "react";
import { formatBitrate, formatRate, formatResolution, formatSize } from "../lib/format";
import { outputSampleRate } from "../lib/player";

function Row({ label, value, note, tone = "text-fg" }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-right">
        <span className={`text-sm ${tone}`}>{value}</span>
        {note && <span className="block text-[11px] leading-snug text-muted">{note}</span>}
      </dd>
    </div>
  );
}

/**
 * Shows exactly what happens to the audio between the file and the speakers, including
 * the parts a browser can't do losslessly. Most players hide resampling; this doesn't.
 */
export default function SignalPath({ track, state, gainDb, onClose }) {
  const [deviceRate, setDeviceRate] = useState(null);
  useEffect(() => setDeviceRate(outputSampleRate()), []);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const resampled = deviceRate && track.sample_rate && deviceRate !== track.sample_rate;
  const attenuated = state.muted || state.volume < 1 || gainDb !== 0;

  return (
    <div
      role="dialog"
      aria-label="Signal path"
      className="absolute bottom-full right-0 mb-3 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface-1 p-4 shadow-2xl"
    >
      <h2 className="mb-1 text-sm font-semibold">Signal path</h2>
      <dl className="divide-y divide-line">
        <Row
          label="Source"
          value={`${track.codec.toUpperCase()} · ${formatResolution(track)}`}
          note={`${track.channels ?? "?"} ch · ${formatBitrate(track.bitrate)} · ${formatSize(track.size)}`}
          tone={track.lossless ? "text-accent" : "text-fg"}
        />
        <Row label="Delivery" value="Original file, untouched" note="No transcoding. Byte-range streamed, so seeking is instant." />
        <Row
          label="Output device"
          value={deviceRate ? formatRate(deviceRate) : "Unknown"}
          tone={resampled ? "text-gold" : "text-accent"}
          note={
            resampled
              ? `Browser resamples ${formatRate(track.sample_rate)} → ${formatRate(deviceRate)}. For a native match, set your OS output device to ${formatRate(track.sample_rate)}.`
              : deviceRate
                ? "Sample rate matches the source — no resampling."
                : null
          }
        />
        <Row
          label="Level"
          value={attenuated ? "Digitally attenuated" : "Unity gain"}
          tone={attenuated ? "text-gold" : "text-accent"}
          note={
            attenuated
              ? `Volume ${Math.round(state.volume * 100)}%${gainDb ? ` · ReplayGain ${gainDb.toFixed(1)} dB` : ""}${state.muted ? " · muted" : ""}. Set 100% and ReplayGain off for an unaltered signal.`
              : "Samples reach the mixer unaltered."
          }
        />
        <Row
          label="Buffer"
          value={`${Math.round(state.bufferedAhead)} s ahead`}
          note={state.nextReady ? "Next track preloaded" : "Next track loads near the end of this one"}
        />
      </dl>
    </div>
  );
}
