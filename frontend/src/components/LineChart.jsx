import { chartPoints } from "../lib/growth";

const W = 640;
const H = 180;

/** Plays per day. One scale: zero at the bottom, the busiest day at the top; both are labelled. */
export default function LineChart({ series }) {
  const { points, max, line, area } = chartPoints(series, W, H, 14);
  const last = points.at(-1);
  const first = series[0]?.date;
  const label = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  const total = series.reduce((n, d) => n + d.plays, 0);
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H + 24}`} role="img" className="h-auto w-full overflow-visible"
        aria-label={`Plays per day, ${label(first)} to ${label(series.at(-1).date)}: ${total} in total, busiest day ${max}`}>
        {[0, 0.5, 1].map((f) => {
          const y = 14 + (H - 28) * (1 - f);
          return (
            <g key={f}>
              <line x1="0" x2={W} y1={y} y2={y} stroke="var(--color-ink)" strokeOpacity={f === 0 ? 0.35 : 0.12} strokeDasharray={f === 0 ? "" : "4 6"} />
              {f > 0 && <text x="0" y={y - 4} fontSize="11" fill="var(--color-muted)">{Math.round(max * f)}</text>}
            </g>
          );
        })}
        <path d={area} fill="var(--color-lime)" fillOpacity="0.55" />
        <path d={line} fill="none" stroke="var(--color-ink)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {last && <circle cx={last.x} cy={last.y} r="6" fill="var(--color-gum)" stroke="var(--color-ink)" strokeWidth="3" />}
        <text x="0" y={H + 18} fontSize="12" fill="var(--color-muted)">{label(first)}</text>
        <text x={W} y={H + 18} fontSize="12" textAnchor="end" fill="var(--color-muted)">{label(series.at(-1).date)}</text>
      </svg>
    </figure>
  );
}
