import { useStreamTokenValue } from "../lib/hooks";
import { useLibrary, useOffline } from "../lib/library";
import { player } from "../lib/player";
import { href } from "../lib/router";
import Cover from "./Cover";
import { playable } from "./Grid";
import { PlayIcon } from "./Icons";
import { StickerLabel } from "./Stickers";

const TONES = ["lime", "gum", "sky", "peach"];
const TILTS = [-3, 2, -1.5, 3];

/** Up to four distinct album covers from a mix, as a 2×2 collage. */
export function MixCover({ tracks, className = "aspect-square w-full" }) {
  const token = useStreamTokenValue();
  const covers = [];
  const seen = new Set();
  for (const t of tracks) {
    if (t.has_cover && !seen.has(t.album_id)) {
      seen.add(t.album_id);
      covers.push(t);
      if (covers.length === 4) break;
    }
  }
  if (covers.length < 4) {
    return <Cover track={covers[0] ?? null} token={token} className={className} rounded="" />;
  }
  return (
    <div className={`${className} grid grid-cols-2 overflow-hidden`}>
      {covers.map((t) => <Cover key={t.id} track={t} token={token} className="aspect-square w-full" rounded="" />)}
    </div>
  );
}

export default function MixGrid({ mixes }) {
  const { offlineMode } = useLibrary();
  const { ids } = useOffline();
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {mixes.map((m, i) => {
        const list = playable(m.tracks, offlineMode, ids);
        return (
          <li key={m.key} className="group min-w-0">
            <div className="relative">
              <a href={href("mix", m.key)} className="block" tabIndex={-1} aria-hidden="true">
                <div className="cover-sticker" style={{ "--tilt": `${TILTS[i % TILTS.length]}deg` }}>
                  <MixCover tracks={m.tracks} />
                </div>
                <StickerLabel tone={TONES[i % TONES.length]} tilt={-7} className="absolute -left-2 bottom-4 max-w-[85%] truncate text-sm">
                  {m.title}
                </StickerLabel>
              </a>
              {list.length > 0 && (
                <button
                  type="button"
                  aria-label={`Play ${m.title}`}
                  onClick={() => {
                    if (player.getSnapshot().shuffle) player.toggleShuffle();
                    player.playQueue(list, 0);
                  }}
                  className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full border-[3px] border-white bg-accent text-ink opacity-0 shadow-sticker transition group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <PlayIcon className="ml-0.5 h-5 w-5" />
                </button>
              )}
            </div>
            <a href={href("mix", m.key)} className="block">
              <p className="mt-3 truncate font-display text-sm font-bold">{m.tag ?? m.title}</p>
              <p className="line-clamp-2 text-xs text-muted">{m.blurb ?? m.subtitle}</p>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
