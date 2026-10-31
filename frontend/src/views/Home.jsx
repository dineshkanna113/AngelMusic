import { useEffect, useMemo, useState } from "react";
import { AlbumGrid, Section } from "../components/Grid";
import MixGrid from "../components/MixGrid";
import TrackList from "../components/TrackList";
import { api } from "../lib/api";
import { useLibrary } from "../lib/library";
import { useMixes } from "../lib/mixes";
import { href } from "../lib/router";

export default function Home() {
  const { albums, tracks, offlineMode } = useLibrary();
  const [recent, setRecent] = useState(null);
  const mixes = useMixes();

  useEffect(() => {
    if (offlineMode) return;
    api("/api/history?limit=12").then((d) => setRecent(d.tracks)).catch(() => setRecent([]));
  }, [offlineMode]);

  const recentlyAdded = useMemo(
    () => [...albums].sort((a, b) => (b.added_at || "").localeCompare(a.added_at || "")).slice(0, 10),
    [albums],
  );
  const mostPlayed = useMemo(
    () => (tracks ?? []).filter((t) => t.play_count > 0).sort((a, b) => b.play_count - a.play_count).slice(0, 10),
    [tracks],
  );
  const hires = useMemo(() => albums.filter((a) => a.hires).slice(0, 10), [albums]);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{greeting}</h1>
      {offlineMode && (
        <p className="mb-6 rounded-md bg-gold/10 px-3 py-2 text-sm text-gold">
          You're offline. Only tracks saved for offline are playable. <a className="underline" href={href("downloads")}>See downloads</a>
        </p>
      )}
      {mixes.length > 0 && (
        <Section title="Made for you">
          <MixGrid mixes={mixes} />
        </Section>
      )}
      {recent?.length > 0 && (
        <Section title="Recently played" action={<a className="text-xs text-muted hover:text-fg" href={href("recent")}>Show all</a>}>
          <TrackList tracks={recent.slice(0, 6)} />
        </Section>
      )}
      <Section title="Recently added" action={<a className="text-xs text-muted hover:text-fg" href={href("albums")}>All albums</a>}>
        <AlbumGrid albums={recentlyAdded} emptyText="Your library is empty. Add music to the library folder or upload it in Settings." />
      </Section>
      {mostPlayed.length > 0 && (
        <Section title="Most played">
          <TrackList tracks={mostPlayed} />
        </Section>
      )}
      {hires.length > 0 && (
        <Section title="Hi-Res albums">
          <AlbumGrid albums={hires} />
        </Section>
      )}
    </>
  );
}
