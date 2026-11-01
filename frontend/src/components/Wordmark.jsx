/**
 * The Yaapu mark: three bars, long, short, long, the way a line of metre (yaappu)
 * alternates beats. Drawn in marigold beside the lowercase name in the display face.
 */
export function YaapuMark({ className = "h-6 w-6" }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <rect x="3" y="3" width="4.5" height="18" rx="2.25" fill="var(--color-marigold)" />
      <rect x="9.75" y="9" width="4.5" height="12" rx="2.25" fill="var(--color-marigold)" opacity="0.7" />
      <rect x="16.5" y="3" width="4.5" height="18" rx="2.25" fill="var(--color-marigold)" />
    </svg>
  );
}

export default function Wordmark({ size = "text-2xl", className = "" }) {
  return (
    <span className={`wordmark inline-flex items-center gap-[0.18em] ${size} ${className}`}>
      <YaapuMark className="h-[0.62em] w-[0.62em] shrink-0 translate-y-[0.06em]" />
      <span>yaapu</span>
    </span>
  );
}
