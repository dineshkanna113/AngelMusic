import { useMemo, useState } from "react";
import CollectionActions from "../components/CollectionActions";
import { PageHeader, Select } from "../components/Grid";
import TrackList from "../components/TrackList";
import { formatTime, isHiRes } from "../lib/format";
import { useLibrary } from "../lib/library";

const SORTS = {
  album: null, // server order: album artist, album, disc, track
  title: (a, b) => a.title.localeCompare(b.title),
  artist: (a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
  added: (a, b) => (b.added_at || "").localeCompare(a.added_at || ""),
  plays: (a, b) => b.play_count - a.play_count,
  quality: (a, b) => (b.sample_rate ?? 0) - (a.sample_rate ?? 0) || (b.bit_depth ?? 0) - (a.bit_depth ?? 0),
  duration: (a, b) => b.duration - a.duration,
};

function readPref(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export default function Songs() {
  const { tracks } = useLibrary();
  const [sort, setSort] = useState(() => readPref("ls.songs.sort", "album"));
  const [filter, setFilter] = useState("all");

  const list = useMemo(() => {
    let out = tracks ?? [];
    if (filter === "hires") out = out.filter(isHiRes);
    if (filter === "lossless") out = out.filter((t) => t.lossless);
    const cmp = SORTS[sort];
    return cmp ? [...out].sort(cmp) : out;
  }, [tracks, sort, filter]);

  const changeSort = (v) => {
    setSort(v);
    try {
      localStorage.setItem("ls.songs.sort", v);
    } catch {
      // not persisted
    }
  };

  return (
    <>
      <PageHeader title="Songs" subtitle={`${list.length} tracks · ${formatTime(list.reduce((s, t) => s + t.duration, 0))}`}>
        <Select label="Show" value={filter} onChange={setFilter}
          options={[["all", "All"], ["lossless", "Lossless"], ["hires", "Hi-Res only"]]} />
        <Select label="Sort" value={sort} onChange={changeSort}
          options={[["album", "Album"], ["title", "Title"], ["artist", "Artist"], ["added", "Recently added"],
            ["plays", "Most played"], ["quality", "Highest quality"], ["duration", "Longest"]]} />
      </PageHeader>
      <div className="mb-4"><CollectionActions tracks={list} /></div>
      {tracks === null ? <p className="text-sm text-muted">Loading…</p> : <TrackList tracks={list} />}
    </>
  );
}
