import { memo, useCallback, useMemo } from "react";
import { library, useLibrary, useOffline } from "../lib/library";
import { formatTime } from "../lib/format";
import { usePlayerSelect, useStreamTokenValue } from "../lib/hooks";
import { player } from "../lib/player";
import { href } from "../lib/router";
import Cover from "./Cover";
import { DownIcon, HeartIcon, HeartOutlineIcon, OfflineIcon, PauseIcon, PlayIcon, UpIcon } from "./Icons";
import QualityBadge from "./QualityBadge";
import TrackMenu from "./TrackMenu";

const probe = typeof Audio !== "undefined" ? new Audio() : null;
const playableCache = new Map();
export const canPlay = (mime) => {
  if (!playableCache.has(mime)) playableCache.set(mime, !!probe && probe.canPlayType(mime) !== "");
  return playableCache.get(mime);
};

const Row = memo(function Row({
  track, number, current, playing, token, favorite, saved, saving, showAlbum, showCover, offlineMode, onPlay, onRemove,
  onMove, isFirst, isLast,
}) {
  const playable = canPlay(track.mime) && (!offlineMode || saved);
  return (
    <li
      className={`group grid items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-2 ${
        current ? "bg-surface-2/70" : ""
      } ${showAlbum ? "grid-cols-[2rem_auto_1fr_auto] md:grid-cols-[2rem_auto_minmax(0,2fr)_minmax(0,1.3fr)_auto_auto_3rem_auto]" : "grid-cols-[2rem_auto_1fr_auto] md:grid-cols-[2rem_auto_minmax(0,1fr)_auto_auto_3rem_auto]"} ${
        playable ? "" : "opacity-40"
      }`}
      onDoubleClick={() => playable && onPlay(track)}
    >
      <button
        type="button"
        onClick={() => (current ? player.togglePlay() : playable && onPlay(track))}
        disabled={!playable}
        aria-label={current && playing ? `Pause ${track.title}` : `Play ${track.title}`}
        title={playable ? undefined : offlineMode ? "Not saved for offline" : `Your browser can't play ${track.codec.toUpperCase()}`}
        className="grid h-8 w-8 place-items-center rounded-full text-xs tabular-nums text-muted hover:text-fg disabled:cursor-not-allowed"
      >
        {current ? (
          playing ? <PauseIcon className="h-4 w-4 text-accent" /> : <PlayIcon className="h-4 w-4 text-accent" />
        ) : (
          <>
            <span className="group-hover:hidden">{number}</span>
            <PlayIcon className="hidden h-4 w-4 group-hover:block" />
          </>
        )}
      </button>
      {showCover ? <Cover track={track} token={token} className="h-10 w-10" /> : <span />}
      <div className="min-w-0">
        <p className={`truncate text-sm font-medium ${current ? "text-accent" : ""}`}>{track.title}</p>
        <p className="truncate text-xs text-muted">
          <a href={href("artist", track.artist_id)} className="hover:text-fg hover:underline" onClick={(e) => e.stopPropagation()}>
            {track.artist || "Unknown artist"}
          </a>
        </p>
      </div>
      {showAlbum && (
        <a href={href("album", track.album_id)} className="hidden min-w-0 truncate text-xs text-muted hover:text-fg hover:underline md:block">
          {track.album}
        </a>
      )}
      <span className="hidden items-center gap-2 md:flex">
        {saved && <OfflineIcon className="h-3.5 w-3.5 text-accent" title="Available offline" />}
        {saving && <span className="font-mono text-[10px] text-muted">{Math.round(saving * 100)}%</span>}
        <QualityBadge track={track} />
      </span>
      <button
        type="button"
        onClick={() => library.toggleFavorite(track)}
        disabled={offlineMode}
        aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
        aria-pressed={favorite}
        className={`hidden h-8 w-8 place-items-center rounded-full md:grid ${favorite ? "text-accent" : "text-muted opacity-0 hover:text-fg group-hover:opacity-100 focus-visible:opacity-100"}`}
      >
        {favorite ? <HeartIcon className="h-4 w-4" /> : <HeartOutlineIcon className="h-4 w-4" />}
      </button>
      <span className="hidden text-right text-xs tabular-nums text-muted md:block">{formatTime(track.duration)}</span>
      <div className="flex items-center">
        {onMove && (
          <span className="hidden items-center md:flex">
            <button type="button" disabled={isFirst} onClick={() => onMove(-1)} aria-label="Move up"
              className="grid h-7 w-6 place-items-center text-muted opacity-0 hover:text-fg group-hover:opacity-100 disabled:invisible">
              <UpIcon className="h-4 w-4" />
            </button>
            <button type="button" disabled={isLast} onClick={() => onMove(1)} aria-label="Move down"
              className="grid h-7 w-6 place-items-center text-muted opacity-0 hover:text-fg group-hover:opacity-100 disabled:invisible">
              <DownIcon className="h-4 w-4" />
            </button>
          </span>
        )}
        <TrackMenu track={track} onRemove={onRemove} />
      </div>
    </li>
  );
});

/**
 * Shared track list. Clicking a row plays the list from that track.
 * `numbering`: "index" (1..n) or "track" (album track numbers).
 */
export default function TrackList({
  tracks, numbering = "index", showAlbum = true, showCover = true, onRemove, onMove, emptyText = "Nothing here yet.",
}) {
  const { byId, offlineMode } = useLibrary();
  const { ids: offlineIds, progress } = useOffline();
  const token = useStreamTokenValue();
  const currentId = usePlayerSelect((s) => s.queue[s.index]?.id ?? null);
  const playing = usePlayerSelect((s) => s.playing);

  // Use the live library copy so favorites / play counts stay current.
  const rows = useMemo(() => tracks.map((t) => byId.get(t.id) ?? t), [tracks, byId]);
  const playable = useMemo(
    () => rows.filter((t) => canPlay(t.mime) && (!offlineMode || offlineIds.has(t.id))),
    [rows, offlineMode, offlineIds],
  );
  const onPlay = useCallback((track) => player.playQueue(playable, Math.max(0, playable.indexOf(track))), [playable]);

  if (!rows.length) return <p className="px-2 py-6 text-sm text-muted">{emptyText}</p>;

  return (
    <ul className="space-y-0.5">
      {rows.map((t, i) => (
        <Row
          key={`${t.id}-${i}`}
          track={t}
          number={numbering === "track" ? t.track_no ?? "–" : i + 1}
          current={t.id === currentId}
          playing={t.id === currentId && playing}
          token={token}
          favorite={!!t.favorite}
          saved={offlineIds.has(t.id)}
          saving={progress[t.id]}
          showAlbum={showAlbum}
          showCover={showCover}
          offlineMode={offlineMode}
          onPlay={onPlay}
          onRemove={onRemove ? () => onRemove(i) : undefined}
          onMove={onMove ? (dir) => onMove(i, i + dir) : undefined}
          isFirst={i === 0}
          isLast={i === rows.length - 1}
        />
      ))}
    </ul>
  );
}
