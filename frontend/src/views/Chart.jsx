import { useEffect, useMemo, useState } from "react";
import CollectionActions from "../components/CollectionActions";
import Cover from "../components/Cover";
import { PageHeader, Select } from "../components/Grid";
import { canPlay } from "../components/TrackList";
import { Artifact } from "../components/Stickers";
import { api } from "../lib/api";
import { formatTime, plural } from "../lib/format";
import { useStreamTokenValue } from "../lib/hooks";
import { player } from "../lib/player";
import { href } from "../lib/router";

const WINDOWS = [["7", "This week"], ["30", "This month"], ["365", "This year"]];
const BADGE = ["bg-accent", "bg-social", "bg-sky"]; // 1, 2, 3

/** Yaapu Top 50: the most played tracks across all listeners. Real counts only. */
export default function Chart() {
  const [days, setDays] = useState("7");
  const [tracks, setTracks] = useState(null);
  const [error, setError] = useState("");
  const token = useStreamTokenValue();

  useEffect(() => {
    setTracks(null);
    setError("");
    api(`/api/charts?days=${days}&limit=50`).then((d) => setTracks(d.tracks)).catch((e) => setError(e.message));
  }, [days]);

  const playable = useMemo(() => (tracks ?? []).filter((t) => canPlay(t.mime)), [tracks]);

  return (
    <div className="relative z-10">
      <PageHeader title="Yaapu Top 50" subtitle="The most played songs across Yaapu.">
        <Select label="Show" value={days} onChange={setDays} options={WINDOWS} />
      </PageHeader>
      {error && <p className="text-sm text-danger">{error}</p>}
      {tracks === null && !error && <p className="text-sm text-muted">Loading…</p>}
      {tracks?.length === 0 && (
        <div className="py-10 text-center">
          <Artifact kind="headphones" size={80} tilt={-8} className="mx-auto" />
          <p className="mt-4 font-display text-xl font-bold">Nothing on the chart yet</p>
          <p className="mt-1 text-sm text-muted">Play some songs and they’ll rank here.</p>
          <a className="btn-primary mt-5" href={href("")}>Find something to play</a>
        </div>
      )}
      {tracks?.length > 0 && (
        <>
          <div className="mb-5"><CollectionActions tracks={tracks} /></div>
          <ol className="space-y-1 rounded-lg bg-surface-1/80 p-2 shadow-card">
            {tracks.map((t) => (
              <li key={t.id}>
                <button type="button" disabled={!canPlay(t.mime)}
                  onClick={() => player.playQueue(playable, Math.max(0, playable.findIndex((p) => p.id === t.id)))}
                  className="grid w-full grid-cols-[3rem_auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-2 disabled:opacity-40"
                  aria-label={`Play ${t.title}, number ${t.rank} on the chart`}>
                  <span className={`grid h-10 w-10 place-items-center justify-self-center rounded-[14px] font-display text-lg font-bold tabular-nums text-ink ${
                    t.rank <= 3 ? `${BADGE[t.rank - 1]} -rotate-6 shadow-sticker` : "text-muted"}`}>{t.rank}</span>
                  <Cover track={t} token={token} className="h-11 w-11" rounded="rounded-[12px]" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{t.title}</span>
                    <span className="block truncate text-xs text-muted">{t.artist}</span>
                  </span>
                  <span className="hidden text-right text-xs tabular-nums text-muted sm:block">
                    <span className="block font-semibold text-fg-2">{plural(t.plays, "play")}</span>
                    {formatTime(t.duration)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
