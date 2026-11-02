import { useEffect, useMemo, useState } from "react";
import { AlbumGrid, Section } from "../components/Grid";
import { Artifact, DotLoops, StickerLabel } from "../components/Stickers";
import StoryRings from "../components/StoryRings";
import { useActivity } from "../lib/activity";
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
  const friends = useActivity();
  const liveCount = friends?.filter((f) => f.live).length ?? 0;

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
    <div className="relative">
      <DotLoops size={300} className="absolute -right-24 -top-4 hidden opacity-15 md:block" />
      <header className="relative z-10 mb-8">
        <h1 className="chrome pb-2 text-[clamp(2.4rem,6vw,3.6rem)] leading-[1.1]">{greeting}</h1>
        <p className="mt-1 text-muted">
          {friends === null ? " " : friends.length === 0
            ? "Follow friends to see what they’re playing."
            : liveCount === 0 ? "No friends are listening right now."
              : `${liveCount} ${liveCount === 1 ? "friend is" : "friends are"} listening right now`}
        </p>
        <StoryRings friends={friends} className="mt-5 md:hidden" />
      </header>
      {offlineMode && (
        <p className="relative z-10 mb-6 rounded-md bg-surface-1 px-4 py-3 text-sm font-semibold text-gold shadow-card">
          You’re offline. Only tracks saved for offline are playable. <a className="underline" href={href("downloads")}>See downloads</a>
        </p>
      )}
      {!offlineMode && (
        <a href={href("rewind")} className="relative z-10 mb-8 flex items-center justify-between gap-4 overflow-hidden rounded-lg border-[5px] border-white bg-social p-5 shadow-card md:p-6">
          <span>
            <StickerLabel tone="ink" tilt={-4}>rewind</StickerLabel>
            <span className="mt-2 block font-display text-2xl font-bold text-ink md:text-3xl">See what you played this month</span>
          </span>
          <Artifact kind="vinyl" size={84} tilt={12} className="shrink-0" />
        </a>
      )}
      {!offlineMode && (
        <a href={href("room")} className="relative z-10 -mt-3 mb-8 flex items-center justify-between gap-4 overflow-hidden rounded-lg border-[5px] border-white bg-sky p-5 shadow-card md:p-6">
          <span>
            <StickerLabel tone="ink" tilt={3}>rooms</StickerLabel>
            <span className="mt-2 block font-display text-2xl font-bold text-ink md:text-3xl">Listen together, in sync</span>
          </span>
          <Artifact kind="boombox" size={84} tilt={-8} className="shrink-0" />
        </a>
      )}
      {mixes.length > 0 && (
        <Section title="Made for you" art={<Artifact kind="sparkle" size={34} tilt={-12} />}>
          <MixGrid mixes={mixes} />
        </Section>
      )}
      {recent?.length > 0 && (
        <Section title="Recently played" art={<Artifact kind="headphones" size={40} tilt={8} />}
          action={<a className="text-sm font-semibold text-muted hover:text-fg" href={href("recent")}>Show all</a>}>
          <TrackList tracks={recent.slice(0, 6)} />
        </Section>
      )}
      <Section title="Recently added" art={<Artifact kind="cassette" size={42} tilt={-8} />}
        action={<a className="text-sm font-semibold text-muted hover:text-fg" href={href("albums")}>All albums</a>}>
        <AlbumGrid albums={recentlyAdded} emptyText="Your library is empty. Add music to the library folder or upload it in Settings." />
      </Section>
      {mostPlayed.length > 0 && (
        <Section title="Most played" art={<Artifact kind="drum" size={40} tilt={10} />}>
          <TrackList tracks={mostPlayed} />
        </Section>
      )}
      {hires.length > 0 && (
        <Section title="Hi-Res albums" art={<Artifact kind="vinyl" size={40} tilt={-10} />}>
          <AlbumGrid albums={hires} />
        </Section>
      )}
    </div>
  );
}
