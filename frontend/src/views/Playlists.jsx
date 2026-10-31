import { useCallback, useEffect, useState } from "react";
import CollectionActions from "../components/CollectionActions";
import Cover from "../components/Cover";
import { confirmDialog, promptDialog } from "../components/Dialog";
import { PageHeader } from "../components/Grid";
import { PlusIcon, TrashIcon } from "../components/Icons";
import { MenuItem, MenuSeparator } from "../components/Menu";
import TrackList from "../components/TrackList";
import { newPlaylistWith } from "../components/TrackMenu";
import { api } from "../lib/api";
import { formatTime } from "../lib/format";
import { useStreamTokenValue } from "../lib/hooks";
import { library, useLibrary } from "../lib/library";
import { href, navigate } from "../lib/router";
import { toast, toastError } from "../lib/toast";

export function Playlists() {
  const { playlists, byId } = useLibrary();
  const token = useStreamTokenValue();
  useEffect(() => {
    library.loadPlaylists();
  }, []);

  return (
    <>
      <PageHeader title="Playlists" subtitle={playlists ? `${playlists.length} playlists` : ""}>
        <button type="button" className="btn-primary flex items-center gap-1.5" onClick={() => newPlaylistWith([])}>
          <PlusIcon className="h-4 w-4" /> New playlist
        </button>
      </PageHeader>
      {playlists?.length === 0 && (
        <p className="text-sm text-muted">No playlists yet. Create one, or use “Add to playlist” from any track’s menu.</p>
      )}
      <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {(playlists ?? []).map((pl) => (
          <li key={pl.id} className="min-w-0">
            <a href={href("playlist", pl.id)} className="block">
              <Cover track={pl.cover_track_id ? byId.get(pl.cover_track_id) : null} token={token}
                className="aspect-square w-full" rounded="rounded-lg" />
              <p className="mt-2 truncate text-sm font-medium">{pl.name}</p>
              <p className="truncate text-xs text-muted">{pl.track_count} tracks · {formatTime(pl.duration)}</p>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

export function PlaylistView({ id }) {
  const [pl, setPl] = useState(null);
  const [error, setError] = useState("");
  const token = useStreamTokenValue();

  const load = useCallback(() => {
    api(`/api/playlists/${id}`).then(setPl).catch((err) => setError(err.message));
  }, [id]);
  useEffect(load, [load]);

  const save = async (patch) => {
    try {
      setPl(await api(`/api/playlists/${id}`, { method: "PATCH", body: patch }));
      library.loadPlaylists();
    } catch (err) {
      toastError(err);
      load();
    }
  };

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!pl) return <p className="text-sm text-muted">Loading…</p>;

  const ids = pl.tracks.map((t) => t.id);
  const move = (from, to) => {
    const next = [...ids];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setPl({ ...pl, tracks: next.map((tid) => pl.tracks.find((t) => t.id === tid)) });
    save({ track_ids: next });
  };
  const remove = (i) => save({ track_ids: ids.filter((_, n) => n !== i) });

  const rename = async () => {
    const name = await promptDialog({ title: "Rename playlist", label: "Name", initial: pl.name });
    if (name) save({ name });
  };
  const destroy = async () => {
    if (!(await confirmDialog({ title: "Delete playlist?", message: `“${pl.name}” will be deleted. The tracks stay in your library.` }))) return;
    try {
      await library.deletePlaylist(pl.id);
      toast("Playlist deleted");
      navigate("playlists");
    } catch (err) {
      toastError(err);
    }
  };

  const cover = pl.tracks.find((t) => t.has_cover);
  return (
    <>
      <div className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-end">
        <Cover track={cover} token={token} className="aspect-square w-48" rounded="rounded-xl" eager />
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Playlist</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{pl.name}</h1>
          <p className="mt-1 text-sm text-muted">{pl.tracks.length} tracks · {formatTime(pl.duration)}</p>
          <div className="mt-4">
            <CollectionActions tracks={pl.tracks}>
              {(close) => (
                <>
                  <MenuSeparator />
                  <MenuItem close={close} onSelect={rename}>Rename…</MenuItem>
                  <MenuItem icon={TrashIcon} close={close} danger onSelect={destroy}>Delete playlist</MenuItem>
                </>
              )}
            </CollectionActions>
          </div>
        </div>
      </div>
      <TrackList tracks={pl.tracks} onRemove={remove} onMove={move}
        emptyText="This playlist is empty. Add tracks from any track’s menu." />
    </>
  );
}

export function Recent() {
  const [tracks, setTracks] = useState(null);
  const load = () => api("/api/history?limit=200").then((d) => setTracks(d.tracks)).catch(toastError);
  useEffect(() => {
    load();
  }, []);
  const clear = async () => {
    if (!(await confirmDialog({ title: "Clear listening history?", message: "Play counts and recently played will be reset.", confirmLabel: "Clear" }))) return;
    await api("/api/history", { method: "DELETE" }).catch(toastError);
    library.load();
    load();
  };
  return (
    <>
      <PageHeader title="Recently played">
        {tracks?.length > 0 && <button type="button" className="btn-ghost" onClick={clear}>Clear history</button>}
      </PageHeader>
      {tracks === null ? <p className="text-sm text-muted">Loading…</p> : <TrackList tracks={tracks} emptyText="Nothing played yet." />}
    </>
  );
}
