import { useStreamTokenValue } from "../lib/hooks";
import { plural } from "../lib/format";
import { useLibrary } from "../lib/library";
import { player } from "../lib/player";
import { href } from "../lib/router";
import Cover from "./Cover";
import Meta from "./Meta";
import { PlayIcon } from "./Icons";
import { canPlay } from "./TrackList";

export const playable = (tracks, offlineMode, offlineIds) =>
  tracks.filter((t) => canPlay(t.mime) && (!offlineMode || offlineIds?.has(t.id)));

// Featured covers sit at a slight tilt; the grid cycles through these.
const TILTS = [-2, 1.5, -1, 2.5, -1.5];

export function AlbumGrid({ albums, emptyText = "No albums." }) {
  const token = useStreamTokenValue();
  const { offlineMode } = useLibrary();
  if (!albums.length) return <p className="px-2 py-6 text-sm text-muted">{emptyText}</p>;
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {albums.map((a, i) => (
        <li key={a.id} className="group min-w-0">
          <div className="relative">
            <a href={href("album", a.id)} className="block" tabIndex={-1} aria-hidden="true">
              <div className="cover-sticker" style={{ "--tilt": `${TILTS[i % TILTS.length]}deg` }}>
                <Cover track={a.cover} token={token} className="aspect-square w-full" rounded="" />
              </div>
            </a>
            {!offlineMode && (
              <button
                type="button"
                aria-label={`Play ${a.name}`}
                onClick={() => player.playQueue(playable(a.tracks), 0)}
                className="absolute bottom-3 right-3 grid h-11 w-11 place-items-center rounded-full border-[3px] border-white bg-accent text-ink opacity-0 shadow-sticker transition group-hover:opacity-100 focus-visible:opacity-100"
              >
                <PlayIcon className="ml-0.5 h-5 w-5" />
              </button>
            )}
          </div>
          <a href={href("album", a.id)} className="block">
            <p className="mt-3 truncate font-display text-sm font-bold">{a.name}</p>
            <Meta className="text-xs text-muted" parts={[
              <span key="a" className="block max-w-full truncate">{a.artist}</span>,
              a.year,
              a.hires && <span key="h" className="font-bold text-social-ink">Hi-Res</span>,
            ]} />
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
            <div className="cover-sticker !rounded-full" style={{ "--tilt": "0" }}><Cover track={ar.cover} token={token} className="mx-auto aspect-square w-full" rounded="" /></div>
            <p className="mt-2 truncate text-sm font-medium">{ar.name}</p>
            <p className="truncate text-xs text-muted">
              <Meta className="justify-center" parts={[plural(ar.albums.length, "album"), plural(ar.track_count, "track")]} />
            </p>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** subtitle: a string, or a list of parts set as a meta line. */
export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="chrome truncate pb-2 text-4xl leading-[1.1]">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-muted">{Array.isArray(subtitle) ? <Meta parts={subtitle} /> : subtitle}</p>
        )}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Section({ title, action, art, children }) {
  return (
    <section className="relative z-10 mb-10">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-3 text-xl md:text-2xl">{title}{art}</h2>
        <span className="shrink-0 whitespace-nowrap">{action}</span>
      </div>
      {children}
    </section>
  );
}

export const Select = ({ label, value, onChange, options }) => (
  <label className="flex items-center gap-2 text-xs text-muted">
    {label}
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="rounded-pill border-0 bg-surface-1 px-3 py-1.5 text-xs font-semibold text-fg shadow-sticker">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </label>
);
