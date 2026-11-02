import { useMemo } from "react";
import CollectionActions from "../components/CollectionActions";
import Meta from "../components/Meta";
import TrackList from "../components/TrackList";
import { groupBy } from "../lib/browse";
import { formatTime, plural } from "../lib/format";
import { useLibrary } from "../lib/library";
import { href } from "../lib/router";

const FIELDS = { genre: "genre", mood: "mood", language: "language" };
const TITLES = { genre: "Genre", mood: "Mood", language: "Language" };

/** One genre, mood or language: its songs with the usual play actions. */
export default function BrowseGroup({ kind, groupKey }) {
  const { tracks } = useLibrary();
  const field = FIELDS[kind];
  const group = useMemo(() => (field ? groupBy(tracks ?? [], field).find((g) => g.key === groupKey) : null), [tracks, field, groupKey]);

  if (!field || (tracks && !group)) {
    return (
      <p className="text-sm text-muted">
        Nothing here. <a className="font-semibold underline" href={href("browse")}>Back to Browse</a>
      </p>
    );
  }
  if (!group) return <p className="text-sm text-muted">Loading…</p>;
  const duration = group.tracks.reduce((s, t) => s + t.duration, 0);
  return (
    <>
      <div className="mb-6">
        <p className="text-sm font-bold text-social-ink">{TITLES[kind]}</p>
        <h1 className="chrome mt-1 pb-2 text-[clamp(2.2rem,6vw,4rem)] leading-[1.1]">{group.label}</h1>
        <Meta className="text-sm text-muted" parts={[plural(group.count, "song"), formatTime(duration)]} />
        <div className="mt-4"><CollectionActions tracks={group.tracks} /></div>
      </div>
      <TrackList tracks={group.tracks} />
    </>
  );
}
