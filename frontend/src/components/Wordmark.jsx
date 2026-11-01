/** The Yaapu mark: an ink sticker tile with a lime dot, set at a tilt. */
export function YaapuMark({ className = "h-6 w-6" }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
      <g transform="rotate(-8 12 12)">
        <rect x="2" y="2" width="20" height="20" rx="6.5" fill="var(--color-ink)" />
        <circle cx="12" cy="12" r="4.6" fill="var(--color-lime)" />
      </g>
    </svg>
  );
}

export default function Wordmark({ size = "text-2xl", className = "" }) {
  return (
    <span className={`wordmark inline-flex items-center gap-[0.22em] ${size} ${className}`}>
      <YaapuMark className="h-[0.86em] w-[0.86em] shrink-0" />
      <span>yaapu</span>
    </span>
  );
}
