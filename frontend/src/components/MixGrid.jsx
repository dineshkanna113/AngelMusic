import { useStreamTokenValue } from "../lib/hooks";
import { useLibrary, useOffline } from "../lib/library";
import { player } from "../lib/player";
import { href } from "../lib/router";
import Cover from "./Cover";
import { playable } from "./Grid";
import { PlayIcon } from "./Icons";

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
    return <Cover track={covers[0] ?? null} token={token} className={className} rounded="rounded-lg" />;
  }
  return (
    <div className={`${className} grid grid-cols-2 overflow-hidden rounded-lg`}>
      {covers.map((t) => <Cover key={t.id} track={t} token={token} className="aspect-square w-full" rounded="" />)}
    </div>
  );
}

export default function MixGrid({ mixes }) {
  const { offlineMode } = useLibrary();
  const { ids } = useOffline();
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {mixes.map((m) => {
        const list = playable(m.tracks, offlineMode, ids);
        return (
          <li key={m.key} className="group min-w-0">
            <div className="relative">
              <a href={href("mix", m.key)} className="block" tabIndex={-1} aria-hidden="true">
                <MixCover tracks={m.tracks} />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-lg bg-gradient-to-t from-black/80 to-transparent px-3 pb-2.5 pt-8">
                  <p className="truncate text-sm font-bold text-white">{m.title}</p>
                </div>
              </a>
              {list.length > 0 && (
                <button
                  type="button"
                  aria-label={`Play ${m.title}`}
                  onClick={() => {
                    if (player.getSnapshot().shuffle) player.toggleShuffle();
                    player.playQueue(list, 0);
                  }}
                  className="absolute right-2 top-2 grid h-10 w-10 place-items-center rounded-full bg-accent text-surface-0 opacity-0 shadow-lg transition group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <PlayIcon className="ml-0.5 h-5 w-5" />
                </button>
              )}
            </div>
            <a href={href("mix", m.key)} className="block">
              <p className="mt-2 truncate text-sm font-medium">{m.title}{m.tag ? ` · ${m.tag}` : ""}</p>
              <p className="line-clamp-2 text-xs text-muted">{m.blurb ?? m.subtitle}</p>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
