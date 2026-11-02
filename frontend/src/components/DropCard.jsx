import { Artifact, StickerLabel } from "./Stickers";
import { artSrc, parseUtc } from "../lib/growth";
import { href } from "../lib/router";

const when = (iso) => new Date(parseUtc(iso)).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const BADGE = {
  upcoming: ["lime", "pre-save"],
  dropping_soon: ["gum", "dropping soon"],
  out: ["sky", "out now"],
};

/** A release announcement as a tilted sticker card. */
export default function DropCard({ drop, tilt = -2 }) {
  const [tone, label] = BADGE[drop.status];
  const art = artSrc(drop.artwork_url);
  return (
    <a href={href("drop", drop.slug)} aria-label={`${drop.title} by ${drop.artist.name}, ${label}`}
      className="group block w-56 shrink-0 transition-transform duration-short ease-out hover:rotate-0" style={{ transform: `rotate(${tilt}deg)` }}>
      <span className="relative block aspect-square overflow-hidden rounded-lg border-[4px] border-white bg-lilac shadow-sticker">
        {art ? <img src={art} alt="" className="h-full w-full object-cover" loading="lazy" />
          : <span className="grid h-full w-full place-items-center"><Artifact kind="vinyl" size={96} tilt={8} /></span>}
        <StickerLabel tone={tone} tilt={-5} className="absolute left-3 top-3">{label}</StickerLabel>
      </span>
      <span className="mt-3 block truncate font-display text-base font-bold">{drop.title}</span>
      <span className="block truncate text-sm text-muted">{drop.artist.name}</span>
      <span className="block text-xs tabular-nums text-muted">{drop.status === "out" ? "Out now" : when(drop.release_at)}</span>
    </a>
  );
}
