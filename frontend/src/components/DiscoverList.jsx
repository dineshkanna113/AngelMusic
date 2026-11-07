import Cover from "./Cover";
import { canPlay } from "./TrackList";
import { useStreamTokenValue } from "../lib/hooks";
import { reasonText } from "../lib/live";
import { player } from "../lib/player";

/** Songs you haven't played yet, each with the reason it was picked. */
export default function DiscoverList({ tracks }) {
  const token = useStreamTokenValue();
  const playable = tracks.filter((t) => canPlay(t.mime));
  return (
    <ul className="grid gap-1 rounded-lg bg-surface-1/80 p-2 shadow-card md:grid-cols-2">
      {tracks.map((t) => (
        <li key={t.id}>
          <button type="button" disabled={!canPlay(t.mime)}
            onClick={() => player.playQueue(playable, Math.max(0, playable.findIndex((p) => p.id === t.id)))}
            aria-label={`Play ${t.title} by ${t.artist}`}
            className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-2 disabled:opacity-40">
            <Cover track={t} token={token} className="h-12 w-12" rounded="rounded-[12px]" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{t.title}</span>
              <span className="block truncate text-xs text-muted">{t.artist}</span>
              <span className="block truncate text-xs font-semibold text-gum-ink">{reasonText(t.reason)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
