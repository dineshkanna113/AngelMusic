// Stickers: pill labels and drawn music artifacts, the playful layer of the Sticker chrome
// look. Decoration only (aria-hidden); they never sit on top of player controls.

const TONES = {
  lime: "bg-accent text-ink",
  gum: "bg-social text-ink",
  sky: "bg-sky text-ink",
  peach: "bg-peach text-ink",
  ink: "bg-ink text-accent",
  white: "bg-surface-1 text-ink",
};

/** A pill label with a white border, slightly tilted: "on repeat", "live", "hi-res". */
export function StickerLabel({ tone = "lime", tilt = -6, className = "", children, as: Tag = "span", ...rest }) {
  return (
    <Tag className={`sticker-label ${TONES[tone]} ${className}`} style={{ "--tilt": `${tilt}deg` }} {...rest}>
      {children}
    </Tag>
  );
}

const INK = "var(--color-ink)";
const S = { stroke: INK, strokeWidth: 3, strokeLinejoin: "round", strokeLinecap: "round" };

const ART = {
  vinyl: (
    <>
      <circle cx="32" cy="32" r="28" fill={INK} {...S} />
      <circle cx="32" cy="32" r="21" fill="none" stroke="#4a4454" strokeWidth="1.5" />
      <circle cx="32" cy="32" r="16" fill="none" stroke="#4a4454" strokeWidth="1.5" />
      <circle cx="32" cy="32" r="10" fill="var(--color-lime)" {...S} />
      <circle cx="32" cy="32" r="2.5" fill="#fff" />
      <path d="M14 22a21 21 0 0 1 10-9" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" opacity=".55" />
    </>
  ),
  cassette: (
    <>
      <rect x="4" y="12" width="56" height="40" rx="6" fill="var(--color-peach)" {...S} />
      <rect x="11" y="18" width="42" height="9" rx="2" fill="#fff" {...S} strokeWidth="2.5" />
      <rect x="15" y="31" width="34" height="13" rx="6.5" fill={INK} />
      <circle cx="23" cy="37.5" r="4" fill="#fff" />
      <circle cx="41" cy="37.5" r="4" fill="#fff" />
      <path d="M16 52l4-6h24l4 6" fill="var(--color-gum)" {...S} strokeWidth="2.5" />
    </>
  ),
  headphones: (
    <>
      <path d="M10 38V30a22 22 0 0 1 44 0v8" fill="none" {...S} strokeWidth="5" />
      <rect x="5" y="34" width="13" height="22" rx="6" fill="var(--color-gum)" {...S} />
      <rect x="46" y="34" width="13" height="22" rx="6" fill="var(--color-gum)" {...S} />
    </>
  ),
  boombox: (
    <>
      <path d="M20 16V10h24v6" fill="none" {...S} />
      <rect x="4" y="16" width="56" height="38" rx="7" fill="var(--color-sky)" {...S} />
      <circle cx="18" cy="36" r="10" fill={INK} />
      <circle cx="18" cy="36" r="4" fill="var(--color-lime)" />
      <circle cx="46" cy="36" r="10" fill={INK} />
      <circle cx="46" cy="36" r="4" fill="var(--color-lime)" />
      <rect x="26" y="22" width="12" height="6" rx="2" fill="#fff" {...S} strokeWidth="2" />
    </>
  ),
  drum: (
    <>
      <path d="M10 26v18c0 6 10 10 22 10s22-4 22-10V26" fill="var(--color-gum)" {...S} />
      <ellipse cx="32" cy="26" rx="22" ry="9" fill="#fff" {...S} />
      <path d="M14 34l8 14M50 34l-8 14M32 37v16" fill="none" {...S} strokeWidth="2.5" />
      <path d="M36 4l10 18M52 6L40 22" fill="none" {...S} strokeWidth="4" />
    </>
  ),
  sparkle: (
    <path d="M32 4c3 15 13 25 28 28-15 3-25 13-28 28-3-15-13-25-28-28 15-3 25-13 28-28z" fill="var(--color-lime)" {...S} />
  ),
};

/** A drawn music artifact as a sticker (white outline + soft shadow), slightly tilted. */
export function Artifact({ kind, size = 56, tilt = 0, className = "" }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false"
      className={`artifact ${className}`} style={{ "--tilt": `${tilt}deg` }}>
      {ART[kind]}
    </svg>
  );
}

/** Abstract dot-and-loop line pattern used as background texture. */
export function DotLoops({ className = "", size = 220 }) {
  const dots = [];
  for (const y of [55, 110, 165]) for (const x of [55, 110, 165]) dots.push(<circle key={`${x}-${y}`} cx={x} cy={y} r="4" />);
  return (
    <svg viewBox="0 0 220 220" width={size} height={size} aria-hidden="true" focusable="false"
      className={`pointer-events-none ${className}`} fill="none" stroke="var(--color-ink)" strokeWidth="2.5" strokeLinecap="round">
      <g fill="var(--color-ink)" stroke="none">{dots}</g>
      <path d="M82 28c-30-30-84 24-54 54s30 30 54 54 84-24 54-54-30-30-54-54z" />
      <path d="M138 28c30-30 84 24 54 54s-30 30-54 54-84-24-54-54 30-30 54-54z" />
      <path d="M110 20c22 22 22 46 0 68-22-22-22-46 0-68zM110 132c22 22 22 46 0 68-22-22-22-46 0-68zM20 110c22-22 46-22 68 0-22 22-46 22-68 0zM132 110c22-22 46-22 68 0-22 22-46 22-68 0z" />
    </svg>
  );
}
