import { useDeferredValue, useMemo } from "react";
import { AlbumGrid, ArtistGrid, Section } from "../components/Grid";
import TrackList from "../components/TrackList";
import { useLibrary } from "../lib/library";

// Accent- and case-insensitive: "beyonce" finds "Beyoncé".
const fold = (s) => (s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export default function Search({ query }) {
  const { tracks, albums, artists } = useLibrary();
  const q = useDeferredValue(fold(query).trim());
  const words = q.split(/\s+/).filter(Boolean);
  const hit = (...fields) => {
    const hay = fold(fields.join(" "));
    return words.every((w) => hay.includes(w));
  };

  const results = useMemo(() => {
    if (!words.length) return null;
    return {
      artists: artists.filter((a) => hit(a.name)).slice(0, 12),
      albums: albums.filter((a) => hit(a.name, a.artist, a.year, a.genre)).slice(0, 15),
      tracks: (tracks ?? []).filter((t) => hit(t.title, t.artist, t.album, t.album_artist, t.genre)).slice(0, 100),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tracks, albums, artists]);

  if (!results) return <p className="text-sm text-muted">Type to search songs, albums and artists.</p>;
  const empty = !results.artists.length && !results.albums.length && !results.tracks.length;
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Results for “{query}”</h1>
      {empty && <p className="text-sm text-muted">No matches.</p>}
      {results.tracks.length > 0 && <Section title="Songs"><TrackList tracks={results.tracks} /></Section>}
      {results.albums.length > 0 && <Section title="Albums"><AlbumGrid albums={results.albums} /></Section>}
      {results.artists.length > 0 && <Section title="Artists"><ArtistGrid artists={results.artists} /></Section>}
    </>
  );
}
