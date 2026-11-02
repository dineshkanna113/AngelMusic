import { useCallback, useEffect, useState } from "react";
import CollectionActions from "../components/CollectionActions";
import Meta from "../components/Meta";
import Cover from "../components/Cover";
import Avatar from "../components/Avatar";
import { confirmDialog, Modal, mount, promptDialog } from "../components/Dialog";
import { PageHeader } from "../components/Grid";
import { PlusIcon, TrashIcon } from "../components/Icons";
import { MenuItem, MenuSeparator } from "../components/Menu";
import TrackList from "../components/TrackList";
import { newPlaylistWith } from "../components/TrackMenu";
import { api } from "../lib/api";
import { formatTime, plural } from "../lib/format";
import { useSession, useStreamTokenValue } from "../lib/hooks";
import { library, useLibrary } from "../lib/library";
import { href, navigate } from "../lib/router";
import { social } from "../lib/social";
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
            <a href={href("playlist", pl.id)} className="group block">
              <div className="cover-sticker" style={{ "--tilt": "-1.5deg" }}>
                <Cover track={pl.cover_track_id ? byId.get(pl.cover_track_id) : null} token={token}
                  className="aspect-square w-full" rounded="" />
              </div>
              <p className="mt-3 truncate font-display text-sm font-bold">{pl.name}</p>
              <Meta className="text-xs text-muted" parts={[plural(pl.track_count, "track"), formatTime(pl.duration)]} />
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Owner's dialog: who can edit this playlist. Only people you're connected to can be added. */
function CollaboratorsDialog({ playlist, me, onDone }) {
  const [members, setMembers] = useState(null);
  const [connections, setConnections] = useState([]);
  const load = useCallback(() => social.members(playlist.id).then(setMembers).catch(toastError), [playlist.id]);
  useEffect(() => {
    load();
    Promise.all([social.following(me), social.followers(me)]).then(([a, b]) => {
      const seen = new Map();
      [...a, ...b].forEach((p) => seen.set(p.username, p));
      setConnections([...seen.values()]);
    }).catch(() => {});
  }, [load, me]);
  const memberNames = new Set((members ?? []).map((m) => m.username));
  const add = (p) => social.addMember(playlist.id, p.username).then(load).catch(toastError);
  const remove = (p) => social.removeMember(playlist.id, p.username).then(load).catch(toastError);

  return (
    <Modal title="Collaborators" onClose={() => onDone()} wide>
      <p className="mb-4 text-sm text-muted">Collaborators can add, remove and reorder songs. Only you can rename or delete the playlist.</p>
      <ul className="mb-5 divide-y divide-line">
        {(members ?? []).map((p) => (
          <li key={p.username} className="flex items-center gap-3 py-2">
            <Avatar person={p} className="h-9 w-9 text-xs" />
            <span className="min-w-0 flex-1 truncate font-semibold">{p.display_name}</span>
            <button type="button" className="btn-ghost" onClick={() => remove(p)}>Remove</button>
          </li>
        ))}
        {members?.length === 0 && <li className="py-2 text-sm text-muted">No collaborators yet.</li>}
      </ul>
      <h3 className="mb-2 text-base">Add people</h3>
      {connections.filter((p) => !memberNames.has(p.username)).length === 0 ? (
        <p className="text-sm text-muted">Follow friends first; you can add people you follow or who follow you.</p>
      ) : (
        <ul className="max-h-64 divide-y divide-line overflow-y-auto">
          {connections.filter((p) => !memberNames.has(p.username)).map((p) => (
            <li key={p.username} className="flex items-center gap-3 py-2">
              <Avatar person={p} className="h-9 w-9 text-xs" />
              <span className="min-w-0 flex-1 truncate">{p.display_name} <span className="text-muted">@{p.username}</span></span>
              <button type="button" className="btn-social h-9 px-4" onClick={() => add(p)}>Add</button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex justify-end"><button type="button" className="btn-secondary" onClick={() => onDone()}>Done</button></div>
    </Modal>
  );
}

const manageCollaborators = (playlist, me) => mount((done) => <CollaboratorsDialog playlist={playlist} me={me} onDone={done} />);

export function PlaylistView({ id }) {
  const [pl, setPl] = useState(null);
  const [error, setError] = useState("");
  const token = useStreamTokenValue();
  const me = useSession()?.user?.username;
  const isAdmin = useSession()?.user?.is_admin;

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

  const isOwner = pl.role === "owner";
  const canEdit = isOwner || pl.role === "member";
  const leave = async () => {
    if (!(await confirmDialog({ title: "Leave this playlist?", message: "You won't be able to edit it any more.", confirmLabel: "Leave" }))) return;
    try {
      await social.removeMember(pl.id, me);
      library.loadPlaylists();
      navigate("playlists");
    } catch (err) {
      toastError(err);
    }
  };
  const kind = pl.featured ? "Featured on Browse" : pl.collaborative ? "Collaborative playlist" : pl.visibility === "public" ? "Public playlist" : "Playlist";
  const cover = pl.tracks.find((t) => t.has_cover);
  return (
    <>
      <div className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-end">
        <div className="cover-sticker w-48" style={{ "--tilt": "-2deg" }}><Cover track={cover} token={token} className="aspect-square w-full" rounded="" eager /></div>
        <div className="min-w-0">
          <p className={`text-xs font-medium ${pl.collaborative ? "font-bold text-social-ink" : "text-muted"}`}>{kind}</p>
          <h1 className="font-display mt-1 text-3xl">{pl.name}</h1>
          <Meta className="mt-1 text-sm text-muted" parts={[
            !isOwner && <a key="o" className="font-semibold text-fg hover:underline" href={href("u", pl.owner.username)}>{pl.owner.display_name}</a>,
            plural(pl.tracks.length, "track"), formatTime(pl.duration),
          ]} />
          <div className="mt-4">
            <CollectionActions tracks={pl.tracks}>
              {(close) => isOwner ? (
                <>
                  <MenuSeparator />
                  <MenuItem close={close} onSelect={rename}>Rename…</MenuItem>
                  <MenuItem close={close} onSelect={() => save({ visibility: pl.visibility === "public" ? "private" : "public" })}>
                    {pl.visibility === "public" ? "Make private" : "Make public (shows on your profile)"}
                  </MenuItem>
                  <MenuItem close={close} onSelect={() => save({ collaborative: !pl.collaborative })}>
                    {pl.collaborative ? "Stop collaborating" : "Make collaborative"}
                  </MenuItem>
                  {pl.collaborative && (
                    <MenuItem close={close} onSelect={() => manageCollaborators(pl, me)}>Collaborators…</MenuItem>
                  )}
                  {isAdmin && (
                    <MenuItem close={close} onSelect={() => save({ featured: !pl.featured })}>
                      {pl.featured ? "Remove from Browse" : "Feature on Browse"}
                    </MenuItem>
                  )}
                  <MenuItem icon={TrashIcon} close={close} danger onSelect={destroy}>Delete playlist</MenuItem>
                </>
              ) : pl.role === "member" ? (
                <>
                  <MenuSeparator />
                  <MenuItem close={close} onSelect={leave}>Leave playlist</MenuItem>
                </>
              ) : null}
            </CollectionActions>
          </div>
        </div>
      </div>
      <TrackList tracks={pl.tracks} onRemove={canEdit ? remove : undefined} onMove={canEdit ? move : undefined}
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
