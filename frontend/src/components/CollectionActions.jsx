import { useLibrary, useOffline } from "../lib/library";
import { offline, offlineSupported } from "../lib/offline";
import { player } from "../lib/player";
import { toast } from "../lib/toast";
import { playable } from "./Grid";
import { MoreIcon, OfflineIcon, PlayIcon, QueueIcon, ShuffleIcon } from "./Icons";
import { Menu, MenuItem, MenuSeparator } from "./Menu";
import { AddToPlaylistItems, saveOffline } from "./TrackMenu";

/** Play / shuffle / more-menu row for albums, artists, playlists and favorites. */
export default function CollectionActions({ tracks, children }) {
  const { offlineMode } = useLibrary();
  const { ids } = useOffline();
  const list = playable(tracks, offlineMode, ids);
  const allSaved = tracks.length > 0 && tracks.every((t) => ids.has(t.id));

  const shuffle = () => {
    if (!player.getSnapshot().shuffle) player.toggleShuffle();
    player.playQueue(list, Math.floor(Math.random() * list.length));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn-primary flex items-center gap-1.5" disabled={!list.length}
        onClick={() => {
          if (player.getSnapshot().shuffle) player.toggleShuffle();
          player.playQueue(list, 0);
        }}>
        <PlayIcon className="h-4 w-4" /> Play
      </button>
      <button type="button" className="btn-secondary flex items-center gap-1.5" disabled={!list.length} onClick={shuffle}>
        <ShuffleIcon className="h-4 w-4" /> Shuffle
      </button>
      <Menu label="More actions" trigger={<MoreIcon className="h-4 w-4" />}
        className="grid h-9 w-9 place-items-center rounded-full border border-line text-muted hover:text-fg">
        {(close) => (
          <>
            <MenuItem icon={QueueIcon} close={close} disabled={!list.length}
              onSelect={() => { player.playNext(list); toast("Playing next"); }}>Play next</MenuItem>
            <MenuItem icon={QueueIcon} close={close} disabled={!list.length}
              onSelect={() => { player.addToQueue(list); toast(`Added ${list.length} tracks to queue`); }}>Add to queue</MenuItem>
            {offlineSupported && (
              allSaved ? (
                <MenuItem icon={OfflineIcon} close={close}
                  onSelect={() => tracks.forEach((t) => offline.remove(t.id))}>Remove offline copies</MenuItem>
              ) : (
                <MenuItem icon={OfflineIcon} close={close} disabled={offlineMode}
                  onSelect={() => saveOffline(tracks)}>Save all for offline</MenuItem>
              )
            )}
            {children?.(close)}
            {!offlineMode && (
              <>
                <MenuSeparator />
                <AddToPlaylistItems tracks={tracks} close={close} />
              </>
            )}
          </>
        )}
      </Menu>
    </div>
  );
}
