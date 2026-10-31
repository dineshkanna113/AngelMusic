import { api, API_BASE, streamToken } from "../lib/api";
import { useSession } from "../lib/hooks";
import { library, useLibrary, useOffline } from "../lib/library";
import { buildRadio } from "../lib/mixes";
import { offline, offlineSupported } from "../lib/offline";
import { player } from "../lib/player";
import { navigate } from "../lib/router";
import { toast, toastError } from "../lib/toast";
import { confirmDialog, promptDialog } from "./Dialog";
import {
  AlbumIcon, ArtistIcon, DownloadIcon, HeartIcon, HeartOutlineIcon, MoreIcon, OfflineIcon, PlaylistIcon, PlusIcon,
  QueueIcon, RadioIcon, TrashIcon,
} from "./Icons";
import { playable } from "./Grid";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "./Menu";

export async function newPlaylistWith(tracks) {
  const name = await promptDialog({ title: "New playlist", label: "Name", confirmLabel: "Create" });
  if (!name) return;
  try {
    await library.createPlaylist(name, tracks.map((t) => t.id));
    toast(`Created ${name}`);
  } catch (err) {
    toastError(err);
  }
}

export async function saveOffline(tracks) {
  const pending = tracks.filter((t) => !offline.has(t.id));
  if (!pending.length) return;
  toast(pending.length === 1 ? `Saving ${pending[0].title} for offline…` : `Saving ${pending.length} tracks for offline…`);
  for (const t of pending) {
    try {
      await offline.save(t);
    } catch (err) {
      if (err.name !== "AbortError") toastError(err);
      return;
    }
  }
  toast(pending.length === 1 ? `${pending[0].title} is available offline` : `${pending.length} tracks available offline`);
}

async function downloadFile(track) {
  const token = await streamToken.get();
  const a = document.createElement("a");
  a.href = `${API_BASE}/api/download/${track.id}?t=${encodeURIComponent(token)}`;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Playlist picker shared by track and album menus. */
export function AddToPlaylistItems({ tracks, close }) {
  const { playlists } = useLibrary();
  return (
    <>
      <MenuLabel>Add to playlist</MenuLabel>
      <MenuItem icon={PlusIcon} close={close} onSelect={() => newPlaylistWith(tracks)}>New playlist…</MenuItem>
      {(playlists ?? []).map((pl) => (
        <MenuItem key={pl.id} icon={PlaylistIcon} close={close} onSelect={() => library.addToPlaylist(pl, tracks.map((t) => t.id))}>
          {pl.name}
        </MenuItem>
      ))}
    </>
  );
}

async function takeDown(track) {
  const ok = await confirmDialog({
    title: `Remove “${track.title}” from the library?`,
    message: "It disappears for every user, including from playlists. The file is kept in the server's removed folder so it can be restored.",
    confirmLabel: "Remove",
  });
  if (!ok) return;
  try {
    await api(`/api/tracks/${track.id}`, { method: "DELETE" });
    toast(`Removed ${track.title}`);
    library.load();
  } catch (err) {
    toastError(err);
  }
}

export default function TrackMenu({ track, onRemove, removeLabel = "Remove from playlist" }) {
  const { byId, tracks, offlineMode } = useLibrary();
  const { ids: offlineIds, progress } = useOffline();
  const live = byId.get(track.id) ?? track;
  const saved = offlineIds.has(track.id);
  const saving = track.id in progress;
  const isAdmin = useSession()?.user?.is_admin;

  return (
    <Menu
      label={`More options for ${track.title}`}
      trigger={<MoreIcon className="h-4 w-4" />}
      className="grid h-8 w-8 place-items-center rounded-full text-muted opacity-70 hover:bg-surface-3 hover:text-fg group-hover:opacity-100"
    >
      {(close) => (
        <>
          <MenuItem icon={QueueIcon} close={close} onSelect={() => { player.playNext([track]); toast("Playing next"); }}>
            Play next
          </MenuItem>
          <MenuItem icon={QueueIcon} close={close} onSelect={() => { player.addToQueue([track]); toast("Added to queue"); }}>
            Add to queue
          </MenuItem>
          <MenuItem icon={RadioIcon} close={close} onSelect={() => {
            if (player.getSnapshot().shuffle) player.toggleShuffle();
            player.playQueue(buildRadio(live, playable(tracks ?? [], offlineMode, offlineIds)), 0);
            toast(`Playing ${track.title} radio`);
          }}>
            Start radio
          </MenuItem>
          <MenuItem
            icon={live.favorite ? HeartIcon : HeartOutlineIcon}
            close={close}
            disabled={offlineMode}
            onSelect={() => library.toggleFavorite(track)}
          >
            {live.favorite ? "Remove from favorites" : "Add to favorites"}
          </MenuItem>
          {onRemove && <MenuItem icon={TrashIcon} close={close} onSelect={onRemove}>{removeLabel}</MenuItem>}
          <MenuSeparator />
          <MenuItem icon={AlbumIcon} close={close} onSelect={() => navigate("album", track.album_id)}>Go to album</MenuItem>
          <MenuItem icon={ArtistIcon} close={close} onSelect={() => navigate("artist", track.artist_id)}>Go to artist</MenuItem>
          <MenuSeparator />
          {offlineSupported && (
            saved ? (
              <MenuItem icon={OfflineIcon} close={close} onSelect={() => offline.remove(track.id)}>Remove offline copy</MenuItem>
            ) : saving ? (
              <MenuItem icon={OfflineIcon} close={close} onSelect={() => offline.cancel(track.id)}>
                Cancel download ({Math.round(progress[track.id] * 100)}%)
              </MenuItem>
            ) : (
              <MenuItem icon={OfflineIcon} close={close} disabled={offlineMode} onSelect={() => saveOffline([track])}>
                Save for offline
              </MenuItem>
            )
          )}
          <MenuItem icon={DownloadIcon} close={close} disabled={offlineMode} onSelect={() => downloadFile(track).catch(toastError)}>
            Download original file
          </MenuItem>
          {!offlineMode && (
            <>
              <MenuSeparator />
              <AddToPlaylistItems tracks={[track]} close={close} />
            </>
          )}
          {isAdmin && !offlineMode && (
            <>
              <MenuSeparator />
              <MenuItem icon={TrashIcon} close={close} danger onSelect={() => takeDown(track)}>Remove from library…</MenuItem>
            </>
          )}
        </>
      )}
    </Menu>
  );
}
