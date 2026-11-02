import { useEffect, useMemo, useState } from "react";
import Cover from "../components/Cover";
import { PageHeader, Select } from "../components/Grid";
import { Artifact, StickerLabel } from "../components/Stickers";
import { plural } from "../lib/format";
import { useStreamTokenValue } from "../lib/hooks";
import { formatListening, live, rewindPeriods } from "../lib/live";
import { player } from "../lib/player";
import { href } from "../lib/router";
import { renderRewindCard } from "../lib/sharecard";
import { toastError } from "../lib/toast";

const TONES = ["bg-accent", "bg-social", "bg-sky"];

function Tile({ label, value, i }) {
  return (
    <div className={`rounded-lg border-[4px] border-white p-4 shadow-sticker ${TONES[i]}`}
      style={{ transform: `rotate(${[-1.5, 1.2, -1][i]}deg)` }}>
      <p className="font-display text-3xl font-bold leading-none text-ink md:text-4xl">{value}</p>
      <p className="mt-1 text-xs font-semibold text-ink/70">{label}</p>
    </div>
  );
}

/** Your listening recap for a month or year. Only real counts; an empty period says so. */
export default function Rewind() {
  const periods = useMemo(() => rewindPeriods(), []);
  const [period, setPeriod] = useState("month");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const token = useStreamTokenValue();

  useEffect(() => {
    setData(null);
    setError("");
    live.rewind(period).then(setData).catch((e) => setError(e.message));
  }, [period]);

  const share = async () => {
    setBusy(true);
    try {
      const blob = await renderRewindCard(data, formatListening(data.seconds));
      const file = new File([blob], `yaapu-rewind-${period}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `My ${data.label} on Yaapu` }).catch((e) => { if (e.name !== "AbortError") throw e; });
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const day = data?.busiest_day && new Date(`${data.busiest_day.date}T00:00:00Z`)
    .toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

  return (
    <div className="relative z-10">
      <PageHeader title="Your Rewind" subtitle="What you actually listened to.">
        <Select label="Period" value={period} onChange={setPeriod} options={periods} />
        {data?.plays > 0 && <button type="button" className="btn-primary" disabled={busy} onClick={share}>{busy ? "Making card…" : "Share card"}</button>}
      </PageHeader>
      {error && <p className="text-sm text-danger">{error}</p>}
      {!data && !error && <p className="text-sm text-muted">Loading…</p>}
      {data?.plays === 0 && (
        <div className="py-10 text-center">
          <Artifact kind="vinyl" size={80} tilt={-8} className="mx-auto" />
          <p className="mt-4 font-display text-xl font-bold">Nothing to rewind for {data.label}</p>
          <p className="mt-1 text-sm text-muted">Play some songs and they’ll show up here.</p>
          <a className="btn-primary mt-5" href={href("")}>Find something to play</a>
        </div>
      )}
      {data?.plays > 0 && (
        <>
          <StickerLabel tone="ink" tilt={-3}>{data.label}</StickerLabel>
          <div className="mb-8 mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
            <Tile i={0} label={data.plays === 1 ? "play" : "plays"} value={data.plays.toLocaleString()} />
            <Tile i={1} label="listened" value={formatListening(data.seconds)} />
            <Tile i={2} label={data.active_days === 1 ? "day with music" : "days with music"} value={data.active_days} />
          </div>
          <p className="mb-10 max-w-xl text-fg-2">
            {data.top_genre && <>Your sound was <strong>{data.top_genre}</strong>. </>}
            {day && <>Your biggest day was <strong>{day}</strong> with {plural(data.busiest_day.plays, "play")}.</>}
          </p>
          <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
            <section>
              <h2 className="mb-4 text-xl md:text-2xl">Top songs</h2>
              <ol className="space-y-1 rounded-lg bg-surface-1/80 p-2 shadow-card">
                {data.top_tracks.map((t, i) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => player.playQueue(data.top_tracks, i)}
                      className="grid w-full grid-cols-[2rem_auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface-2"
                      aria-label={`Play ${t.title}`}>
                      <span className="font-display text-lg font-bold tabular-nums text-muted">{i + 1}</span>
                      <Cover track={t} token={token} className="h-11 w-11" rounded="rounded-[12px]" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{t.title}</span>
                        <span className="block truncate text-xs text-muted">{t.artist}</span>
                      </span>
                      <span className="text-xs font-semibold tabular-nums text-fg-2">{plural(t.plays, "play")}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
            <section>
              <h2 className="mb-4 text-xl md:text-2xl">Top artists</h2>
              <ol className="grid gap-2">
                {data.top_artists.map((a, i) => (
                  <li key={a.id}>
                    <a href={href("artist", a.id)} className="flex items-center justify-between gap-3 rounded-pill bg-surface-1/80 px-4 py-3 shadow-sticker hover:bg-surface-2">
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="font-display text-lg font-bold tabular-nums text-muted">{i + 1}</span>
                        <span className="truncate font-semibold">{a.name}</span>
                      </span>
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-fg-2">{plural(a.plays, "play")}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
