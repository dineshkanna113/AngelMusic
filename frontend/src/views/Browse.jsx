import { useEffect, useMemo, useState } from "react";
import Cover from "../components/Cover";
import DropCard from "../components/DropCard";
import PromoCards from "../components/PromoCard";
import { growth } from "../lib/growth";
import { AlbumGrid, PageHeader, Section } from "../components/Grid";
import { Artifact, StickerLabel } from "../components/Stickers";
import { api } from "../lib/api";
import { groupBy, newReleases } from "../lib/browse";
import { plural } from "../lib/format";
import { useStreamTokenValue } from "../lib/hooks";
import { useLibrary } from "../lib/library";
import { href } from "../lib/router";
import { PlaylistGrid } from "./Profile";

const TONES = ["bg-accent", "bg-social", "bg-sky", "bg-peach"];
const TILTS = [-2.5, 2, -1.5, 3];

/** Genre / mood / language tiles: colour stickers with a count and a little cover. */
function TileGrid({ kind, groups }) {
  const token = useStreamTokenValue();
  return (
    <ul className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
      {groups.map((g, i) => (
        <li key={g.key}>
          <a href={href("browse", kind, g.key)}
            className={`relative block h-32 overflow-hidden rounded-lg border-[4px] border-white p-4 shadow-sticker transition-transform duration-short ease-out hover:rotate-0 ${TONES[i % TONES.length]}`}
            style={{ transform: `rotate(${TILTS[i % TILTS.length]}deg)` }}>
            <span className="block break-words font-display text-base font-bold leading-tight text-ink md:text-lg">{g.label}</span>
            <span className="mt-1 block text-xs font-semibold text-ink/70">{plural(g.count, "song")}</span>
            <span className="absolute -bottom-3 -right-2 w-16 rotate-12 overflow-hidden rounded-md border-[3px] border-white shadow-sticker">
              <Cover track={g.cover} token={token} className="aspect-square w-full" rounded="" />
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** The chart banner. Shown only when something was actually played this week. */
function ChartBanner() {
  const [top, setTop] = useState(null);
  useEffect(() => {
    api("/api/charts?days=7&limit=1").then((d) => setTop(d.tracks[0] ?? null)).catch(() => setTop(null));
  }, []);
  if (!top) return null;
  return (
    <a href={href("chart")} className="relative mb-10 block overflow-hidden rounded-lg border-[5px] border-white bg-accent p-6 shadow-card md:p-8">
      <StickerLabel tone="ink" tilt={-4}>this week</StickerLabel>
      <h2 className="mt-3 text-[clamp(2rem,5vw,3.4rem)] leading-none text-ink">Yaapu Top 50</h2>
      <p className="mt-2 max-w-md text-ink/80">
        What everyone’s playing. <span className="font-bold text-ink">#1 right now: {top.title}</span>, {top.artist}.
      </p>
      <Artifact kind="vinyl" size={120} tilt={12} className="absolute -bottom-4 right-6 hidden sm:block" />
    </a>
  );
}

export default function Browse() {
  const { tracks, albums, offlineMode } = useLibrary();
  const [editorial, setEditorial] = useState([]);
  const [drops, setDrops] = useState([]);
  useEffect(() => {
    if (offlineMode) return;
    api("/api/editorial").then((d) => setEditorial(d.playlists)).catch(() => setEditorial([]));
    growth.drops().then((list) => setDrops(list.filter((d) => d.status !== "out"))).catch(() => setDrops([]));
  }, [offlineMode]);

  const genres = useMemo(() => groupBy(tracks ?? [], "genre"), [tracks]);
  const moods = useMemo(() => groupBy(tracks ?? [], "mood"), [tracks]);
  const languages = useMemo(() => groupBy(tracks ?? [], "language"), [tracks]);
  const fresh = useMemo(() => newReleases(albums, 10), [albums]);

  return (
    <div className="relative z-10">
      <PageHeader title="Browse" subtitle="Find your next favourite." />
      <PromoCards className="mb-8" />
      {!offlineMode && <ChartBanner />}
      {drops.length > 0 && (
        <Section title="Upcoming drops" art={<Artifact kind="cassette" size={40} tilt={-8} />}>
          <ul className="flex gap-6 overflow-x-auto px-2 pb-4 pt-2">
            {drops.map((d, i) => <li key={d.id}><DropCard drop={d} tilt={[-2, 1.5, -1][i % 3]} /></li>)}
          </ul>
        </Section>
      )}
      {fresh.length > 0 && (
        <Section title="New releases" art={<Artifact kind="sparkle" size={34} tilt={-12} />}
          action={<a className="text-sm font-semibold text-muted hover:text-fg" href={href("albums")}>All albums</a>}>
          <AlbumGrid albums={fresh} />
        </Section>
      )}
      {editorial.length > 0 && (
        <Section title="Picked for you" art={<Artifact kind="headphones" size={40} tilt={8} />}>
          <PlaylistGrid playlists={editorial} />
        </Section>
      )}
      {genres.length > 0 && <Section title="Genres" art={<Artifact kind="cassette" size={42} tilt={-8} />}><TileGrid kind="genre" groups={genres} /></Section>}
      {moods.length > 0 && <Section title="Moods" art={<Artifact kind="boombox" size={44} tilt={6} />}><TileGrid kind="mood" groups={moods} /></Section>}
      {languages.length > 0 && <Section title="Languages" art={<Artifact kind="drum" size={40} tilt={10} />}><TileGrid kind="language" groups={languages} /></Section>}
      {tracks?.length > 0 && !genres.length && !moods.length && !languages.length && (
        <p className="text-sm text-muted">Tag your music with genre, mood or language and it shows up here.</p>
      )}
    </div>
  );
}
