import { useStreamTokenValue } from "../lib/hooks";
import { useLibrary } from "../lib/library";
import { player } from "../lib/player";
import { href } from "../lib/router";
import Cover from "./Cover";
import { PlayIcon } from "./Icons";
import { canPlay } from "./TrackList";

export const playable = (tracks, offlineMode, offlineIds) =>
  tracks.filter((t) => canPlay(t.mime) && (!offlineMode || offlineIds?.has(t.id)));

export function AlbumGrid({ albums, emptyText = "No albums." }) {
  const token = useStreamTokenValue();
  const { offlineMode } = useLibrary();
  if (!albums.length) return <p className="px-2 py-6 text-sm text-muted">{emptyText}</p>;
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {albums.map((a) => (
        <li key={a.id} className="group min-w-0">
          <div className="relative">
            <a href={href("album", a.id)} className="block" tabIndex={-1} aria-hidden="true">
              <Cover track={a.cover} token={token} className="aspect-square w-full" rounded="rounded-lg" />
            </a>
            {!offlineMode && (
              <button
                type="button"
                aria-label={`Play ${a.name}`}
                onClick={() => player.playQueue(playable(a.tracks), 0)}
                className="absolute bottom-2 right-2 grid h-10 w-10 place-items-center rounded-full bg-accent text-surface-0 opacity-0 shadow-lg transition group-hover:opacity-100 focus-visible:opacity-100"
              >
                <PlayIcon className="ml-0.5 h-5 w-5" />
              </button>
            )}
          </div>
          <a href={href("album", a.id)} className="block">
            <p className="mt-2 truncate text-sm font-medium">{a.name}</p>
            <p className="truncate text-xs text-muted">
              {a.artist}
              {a.year ? ` · ${a.year}` : ""}
              {a.hires && <span className="ml-1.5 font-mono text-[10px] text-gold">HI-RES</span>}
            </p>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ArtistGrid({ artists }) {
  const token = useStreamTokenValue();
  if (!artists.length) return <p className="px-2 py-6 text-sm text-muted">No artists.</p>;
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {artists.map((ar) => (
        <li key={ar.id} className="min-w-0 text-center">
          <a href={href("artist", ar.id)} className="block">
            <Cover track={ar.cover} token={token} className="mx-auto aspect-square w-full" rounded="rounded-full" />
            <p className="mt-2 truncate text-sm font-medium">{ar.name}</p>
            <p className="truncate text-xs text-muted">
              {ar.albums.length} album{ar.albums.length === 1 ? "" : "s"} · {ar.track_count} tracks
            </p>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Section({ title, action, children }) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export const Select = ({ label, value, onChange, options }) => (
  <label className="flex items-center gap-2 text-xs text-muted">
    {label}
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-line bg-surface-2 px-2 py-1.5 text-xs text-fg">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </label>
);
