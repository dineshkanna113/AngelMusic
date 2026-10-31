import { useMemo, useState } from "react";
import CollectionActions from "../components/CollectionActions";
import Cover from "../components/Cover";
import { AlbumGrid, ArtistGrid, PageHeader, Select } from "../components/Grid";
import TrackList from "../components/TrackList";
import { formatResolution, formatTime } from "../lib/format";
import { useStreamTokenValue } from "../lib/hooks";
import { useLibrary } from "../lib/library";
import { href } from "../lib/router";

const ALBUM_SORTS = {
  artist: null,
  name: (a, b) => a.name.localeCompare(b.name),
  year: (a, b) => (b.year || "").localeCompare(a.year || ""),
  added: (a, b) => (b.added_at || "").localeCompare(a.added_at || ""),
  plays: (a, b) => b.play_count - a.play_count,
};

export function Albums() {
  const { albums } = useLibrary();
  const [sort, setSort] = useState("artist");
  const list = useMemo(() => (ALBUM_SORTS[sort] ? [...albums].sort(ALBUM_SORTS[sort]) : albums), [albums, sort]);
  return (
    <>
      <PageHeader title="Albums" subtitle={`${albums.length} albums`}>
        <Select label="Sort" value={sort} onChange={setSort}
          options={[["artist", "Artist"], ["name", "Title"], ["year", "Year"], ["added", "Recently added"], ["plays", "Most played"]]} />
      </PageHeader>
      <AlbumGrid albums={list} />
    </>
  );
}

export function Artists() {
  const { artists } = useLibrary();
  return (
    <>
      <PageHeader title="Artists" subtitle={`${artists.length} artists`} />
      <ArtistGrid artists={artists} />
    </>
  );
}

function qualitySummary(tracks) {
  const res = [...new Set(tracks.map(formatResolution))];
  const codecs = [...new Set(tracks.map((t) => t.codec.toUpperCase()))];
  return `${codecs.join("/")} · ${res.length === 1 ? res[0] : "mixed resolution"}`;
}

export function AlbumView({ id }) {
  const { albums, tracks } = useLibrary();
  const token = useStreamTokenValue();
  const album = albums.find((a) => a.id === id);
  if (!album) return <p className="text-sm text-muted">{tracks === null ? "Loading…" : "Album not found."}</p>;
  const discs = new Set(album.tracks.map((t) => t.disc_no ?? 1));

  return (
    <>
      <div className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-end">
        <Cover track={album.cover} token={token} className="aspect-square w-48 sm:w-56" rounded="rounded-xl" eager />
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Album</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{album.name}</h1>
          <p className="mt-2 text-sm">
            <a className="font-medium hover:underline" href={href("artist", album.artist_id)}>{album.artist}</a>
            <span className="text-muted">
              {album.year ? ` · ${album.year}` : ""} · {album.tracks.length} tracks · {formatTime(album.duration)}
            </span>
          </p>
          <p className={`mt-1 font-mono text-xs ${album.hires ? "text-gold" : "text-accent"}`}>{qualitySummary(album.tracks)}</p>
          <div className="mt-4"><CollectionActions tracks={album.tracks} /></div>
        </div>
      </div>
      {[...discs].sort().map((disc) => (
        <div key={disc}>
          {discs.size > 1 && <h3 className="mb-1 mt-4 px-2 text-xs font-semibold uppercase tracking-wide text-muted">Disc {disc}</h3>}
          <TrackList tracks={album.tracks.filter((t) => (t.disc_no ?? 1) === disc)} numbering="track" showAlbum={false} showCover={false} />
        </div>
      ))}
    </>
  );
}

export function ArtistView({ id }) {
  const { artists, tracks } = useLibrary();
  const token = useStreamTokenValue();
  const artist = artists.find((a) => a.id === id);
  const all = useMemo(() => artist?.albums.flatMap((a) => a.tracks) ?? [], [artist]);
  const top = useMemo(() => [...all].sort((a, b) => b.play_count - a.play_count).slice(0, 5), [all]);
  if (!artist) return <p className="text-sm text-muted">{tracks === null ? "Loading…" : "Artist not found."}</p>;

  return (
    <>
      <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end">
        <Cover track={artist.cover} token={token} className="aspect-square w-40" rounded="rounded-full" eager />
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Artist</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{artist.name}</h1>
          <p className="mt-1 text-sm text-muted">{artist.albums.length} albums · {artist.track_count} tracks</p>
          <div className="mt-4"><CollectionActions tracks={all} /></div>
        </div>
      </div>
      {top.some((t) => t.play_count > 0) && (
        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold">Most played</h2>
          <TrackList tracks={top} />
        </section>
      )}
      <h2 className="mb-3 text-lg font-semibold">Albums</h2>
      <AlbumGrid albums={artist.albums} />
    </>
  );
}

export function Favorites() {
  const { tracks } = useLibrary();
  const favs = useMemo(
    () => (tracks ?? []).filter((t) => t.favorite).sort((a, b) => (b.starred_at || "").localeCompare(a.starred_at || "")),
    [tracks],
  );
  return (
    <>
      <PageHeader title="Favorites" subtitle={`${favs.length} tracks · no limit`} />
      <div className="mb-4"><CollectionActions tracks={favs} /></div>
      <TrackList tracks={favs} emptyText="Tap the heart on any track to save it here." />
    </>
  );
}
