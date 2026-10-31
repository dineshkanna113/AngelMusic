import CollectionActions from "../components/CollectionActions";
import { MixCover } from "../components/MixGrid";
import Meta from "../components/Meta";
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
        <MixCover tracks={m.tracks} className="aspect-square w-48 shrink-0 shadow-panel" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted">Made for you</p>
          <h1 className="font-display mt-1 text-3xl">{m.title}</h1>
          {m.tag && <p className="mt-1 text-sm text-fg-2">{m.tag}</p>}
          {m.blurb && <p className="mt-1 text-sm text-muted">{m.blurb}</p>}
          <p className="mt-1 line-clamp-2 max-w-2xl text-sm text-muted">{m.subtitle}</p>
          <Meta className="mt-1 text-xs text-muted" parts={[plural(m.tracks.length, "track"), formatTime(duration), "refreshes daily"]} />
          <div className="mt-4"><CollectionActions tracks={m.tracks} /></div>
        </div>
      </div>
      <TrackList tracks={m.tracks} />
    </>
  );
}
