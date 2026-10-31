import CollectionActions from "../components/CollectionActions";
import { MixCover } from "../components/MixGrid";
import TrackList from "../components/TrackList";
import { formatTime, plural } from "../lib/format";
import { useMixes } from "../lib/mixes";
import { href } from "../lib/router";

export function MixView({ id }) {
  const mixes = useMixes();
  const m = mixes.find((x) => x.key === id);
  if (!m) {
    return (
      <p className="text-sm text-muted">
        {mixes.length ? "This mix isn't available today." : "Loading…"} <a className="underline" href={href("")}>Back to Home</a>
      </p>
    );
  }
  const duration = m.tracks.reduce((s, t) => s + t.duration, 0);
  return (
    <>
      <div className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-end">
        <MixCover tracks={m.tracks} className="aspect-square w-48 shrink-0 shadow-xl" />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Made for you</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{m.title}{m.tag ? <span className="text-muted"> · {m.tag}</span> : null}</h1>
          {m.blurb && <p className="mt-1 text-sm text-muted">{m.blurb}</p>}
          <p className="mt-1 line-clamp-2 max-w-2xl text-sm text-muted">{m.subtitle}</p>
          <p className="mt-1 text-xs text-muted">{plural(m.tracks.length, "track")} · {formatTime(duration)} · refreshes daily</p>
          <div className="mt-4"><CollectionActions tracks={m.tracks} /></div>
        </div>
      </div>
      <TrackList tracks={m.tracks} />
    </>
  );
}
