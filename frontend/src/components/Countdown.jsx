import { useEffect, useState } from "react";
import { countdownParts } from "../lib/growth";

const UNITS = [["days", "days"], ["hours", "hours"], ["minutes", "min"], ["seconds", "sec"]];

/** Big sticker tiles counting down to a release. Ticks each second; still when reduced motion is on. */
export default function Countdown({ releaseAt, onDone }) {
  const [now, setNow] = useState(() => Date.now());
  const parts = countdownParts(releaseAt, now);

  useEffect(() => {
    if (parts.done) { onDone?.(); return; }
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = setInterval(() => setNow(Date.now()), still ? 60_000 : 1000);
    return () => clearInterval(timer);
  }, [parts.done, onDone]);

  if (parts.done) return null;
  return (
    <div role="timer" aria-label={`${parts.days} days ${parts.hours} hours ${parts.minutes} minutes left`}
      className="flex flex-wrap gap-3">
      {UNITS.map(([key, label], i) => (
        <div key={key} className="grid w-[4.5rem] place-items-center rounded-lg border-[3px] border-white bg-surface-1 py-3 shadow-sticker"
          style={{ transform: `rotate(${[-3, 2, -2, 3][i]}deg)` }}>
          <span className="font-display text-3xl font-bold tabular-nums leading-none text-ink">{String(parts[key]).padStart(2, "0")}</span>
          <span className="mt-1 text-[11px] font-semibold text-muted">{label}</span>
        </div>
      ))}
    </div>
  );
}
