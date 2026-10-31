import { useEffect, useState } from "react";
import { formatTime, isHiRes } from "../lib/format";
import { usePlayer, useStreamTokenValue } from "../lib/hooks";
import { library, useLibrary } from "../lib/library";
import { player } from "../lib/player";
import { href } from "../lib/router";
import { ui, usePanel } from "../lib/ui";
import Cover from "./Cover";
import {
  HeartIcon, HeartOutlineIcon, LyricsIcon, MoonIcon, MuteIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, QueueIcon,
  RepeatIcon, ShuffleIcon, VolumeIcon, WaveIcon,
} from "./Icons";
import { Menu, MenuItem, MenuLabel } from "./Menu";
import SignalPath from "./SignalPath";

function SeekBar({ state }) {
  const [drag, setDrag] = useState(null);
  const duration = state.duration || 0;
  const value = drag ?? state.currentTime;
  const pct = (t) => (duration ? `${(t / duration) * 100}%` : "0%");

  // Seek once on release: dragging across unbuffered audio would otherwise fire a burst of
  // range requests and stutter.
  const commit = () => {
    if (drag !== null) player.seek(drag);
    setDrag(null);
  };

  return (
    <div className="flex items-center gap-2 text-[11px] tabular-nums text-muted">
      <span className="w-10 text-right">{formatTime(value)}</span>
      <div className="relative h-4 flex-1">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-surface-3">
          {state.buffered.map(([s, e]) => (
            <div key={s} className="absolute inset-y-0 bg-muted/30" style={{ left: pct(s), width: pct(e - s) }} />
          ))}
          <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: pct(value) }} />
        </div>
        <input
          type="range"
          aria-label="Seek"
          min={0}
          max={duration || 1}
          step={0.1}
          value={value}
          disabled={!duration}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          className="seek absolute inset-0 w-full"
        />
      </div>
      <span className="w-10">{formatTime(duration)}</span>
    </div>
  );
}

function SleepTimer({ sleep }) {
  const remaining = sleep?.mode === "time" ? Math.max(0, Math.ceil((sleep.at - Date.now()) / 60_000)) : null;
  return (
    <Menu
      label="Sleep timer"
      trigger={
        <span className="relative">
          <MoonIcon className="h-4 w-4" />
          {sleep && (
            <span className="absolute -right-2.5 -top-2 rounded bg-accent px-1 text-[9px] font-bold leading-3 text-surface-0">
              {remaining ?? "end"}
            </span>
          )}
        </span>
      }
      className={`grid h-9 w-9 place-items-center rounded-full hover:text-fg ${sleep ? "text-accent" : "text-muted"}`}
    >
      {(close) => (
        <>
          <MenuLabel>Sleep timer{remaining !== null ? ` · ${remaining} min left` : sleep ? " · end of track" : ""}</MenuLabel>
          {[15, 30, 45, 60, 90].map((m) => (
            <MenuItem key={m} close={close} onSelect={() => player.setSleepTimer(m)}>{m} minutes</MenuItem>
          ))}
          <MenuItem close={close} onSelect={() => player.setSleepTimer("track")}>End of current track</MenuItem>
          {sleep && <MenuItem close={close} onSelect={() => player.setSleepTimer(null)}>Turn off</MenuItem>}
        </>
      )}
    </Menu>
  );
}

const iconBtn = "grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:text-fg disabled:opacity-40";

export default function PlayerBar() {
  const state = usePlayer();
  const token = useStreamTokenValue();
  const { byId, offlineMode } = useLibrary();
  const panel = usePanel();
  const [showPath, setShowPath] = useState(false);
  const track = state.queue[state.index];
  const live = track ? byId.get(track.id) ?? track : null;

  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const inField = e.target.closest?.("input, textarea, select, [contenteditable]") && e.target.type !== "range";
      if (inField) return;
      if (e.code === "Space") {
        if (e.target.closest?.("button, a")) return; // let focused controls activate normally
        e.preventDefault();
        player.togglePlay();
      } else if (e.key === "ArrowRight" && e.shiftKey) player.next();
      else if (e.key === "ArrowLeft" && e.shiftKey) player.previous();
      else if (e.key === "ArrowRight" && e.target.type !== "range") player.seek(player.audio.currentTime + 10);
      else if (e.key === "ArrowLeft" && e.target.type !== "range") player.seek(player.audio.currentTime - 10);
      else if (e.key === "m" || e.key === "M") player.toggleMute();
      else if (e.key === "l" || e.key === "L") ui.togglePanel("lyrics");
      else if (e.key === "q" || e.key === "Q") ui.togglePanel("queue");
      else if ((e.key === "f" || e.key === "F") && player.track) library.toggleFavorite(player.track);
      else if (e.key === "/") {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.title = track ? `${state.playing ? "▶ " : ""}${track.title} · ${track.artist}` : "AngelStream";
  }, [track, state.playing]);

  if (!track) return null;

  const gainDb = 20 * Math.log10(player.gainFactor(track.id));
  const repeatLabel = { off: "Repeat off", all: "Repeat all", one: "Repeat one" }[state.repeat];

  return (
    <div className="border-t border-line bg-surface-1">
      {state.error && <p role="alert" className="bg-danger/15 px-4 py-1.5 text-center text-xs text-danger">{state.error}</p>}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)] md:px-4 md:py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <a href={href("album", track.album_id)} aria-label="Go to album">
            <Cover track={track} token={token} className="h-12 w-12" eager />
          </a>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{track.title}</p>
            <a href={href("artist", track.artist_id)} className="block truncate text-xs text-muted hover:text-fg hover:underline">{track.artist}</a>
          </div>
          <button type="button" onClick={() => library.toggleFavorite(track)} disabled={offlineMode}
            aria-label={live.favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={!!live.favorite}
            className={`${iconBtn} hidden sm:grid ${live.favorite ? "!text-accent" : ""}`}>
            {live.favorite ? <HeartIcon className="h-4 w-4" /> : <HeartOutlineIcon className="h-4 w-4" />}
          </button>
        </div>

        {/* Mobile: compact play/next on the first row */}
        <div className="flex items-center md:hidden">
          <button type="button" onClick={() => player.togglePlay()} aria-label={state.playing ? "Pause" : "Play"}
            className="relative grid h-10 w-10 place-items-center rounded-full bg-fg text-surface-0">
            {state.buffering && <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-accent" />}
            {state.playing ? <PauseIcon /> : <PlayIcon className="ml-0.5 h-5 w-5" />}
          </button>
          <button type="button" className={iconBtn} onClick={() => player.next()} aria-label="Next"><NextIcon /></button>
        </div>

        <div className="col-span-2 md:col-span-1">
          <div className="mb-0.5 hidden items-center justify-center gap-1 md:flex">
            <button type="button" className={`${iconBtn} ${state.shuffle ? "!text-accent" : ""}`} onClick={() => player.toggleShuffle()}
              aria-label="Shuffle" aria-pressed={state.shuffle}>
              <ShuffleIcon className="h-4 w-4" />
            </button>
            <button type="button" className={iconBtn} onClick={() => player.previous()} aria-label="Previous"><PrevIcon /></button>
            <button type="button" onClick={() => player.togglePlay()} aria-label={state.playing ? "Pause" : "Play"}
              className="relative grid h-10 w-10 place-items-center rounded-full bg-fg text-surface-0 transition-transform hover:scale-105">
              {state.buffering && <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-accent" />}
              {state.playing ? <PauseIcon /> : <PlayIcon className="ml-0.5 h-5 w-5" />}
            </button>
            <button type="button" className={iconBtn} onClick={() => player.next()} aria-label="Next"><NextIcon /></button>
            <button type="button" className={`${iconBtn} relative ${state.repeat !== "off" ? "!text-accent" : ""}`}
              onClick={() => player.cycleRepeat()} aria-label={repeatLabel} title={repeatLabel}>
              <RepeatIcon className="h-4 w-4" />
              {state.repeat === "one" && <span className="absolute right-1 top-1 text-[9px] font-bold">1</span>}
            </button>
          </div>
          <SeekBar state={state} />
        </div>

        <div className="relative col-span-2 flex items-center justify-between gap-1 md:col-span-1 md:justify-end">
          <button
            type="button"
            onClick={() => setShowPath((v) => !v)}
            aria-expanded={showPath}
            title="Signal path"
            className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
              isHiRes(track) ? "border-gold/50 text-gold" : track.lossless ? "border-accent/40 text-accent" : "border-line text-muted"
            }`}
          >
            <WaveIcon className="h-3 w-3" />
            {track.codec.toUpperCase()}
            {track.bit_depth ? ` ${track.bit_depth}/` : " "}
            {track.sample_rate ? +(track.sample_rate / 1000).toFixed(1) : ""}
          </button>
          <div className="flex items-center">
            <button type="button" className={`${iconBtn} md:hidden ${state.shuffle ? "!text-accent" : ""}`} onClick={() => player.toggleShuffle()}
              aria-label="Shuffle" aria-pressed={state.shuffle}><ShuffleIcon className="h-4 w-4" /></button>
            <button type="button" className={`${iconBtn} ${panel === "lyrics" ? "!text-accent" : ""}`} onClick={() => ui.togglePanel("lyrics")}
              aria-label="Lyrics" aria-pressed={panel === "lyrics"} title={track.has_lyrics ? "Lyrics" : "Lyrics (none for this track)"}>
              <LyricsIcon className="h-4 w-4" />
            </button>
            <button type="button" className={`${iconBtn} ${panel === "queue" ? "!text-accent" : ""}`} onClick={() => ui.togglePanel("queue")}
              aria-label="Queue" aria-pressed={panel === "queue"}>
              <QueueIcon className="h-4 w-4" />
            </button>
            <SleepTimer sleep={state.sleep} />
            <button type="button" className={`${iconBtn} hidden lg:grid`} onClick={() => player.toggleMute()} aria-label={state.muted ? "Unmute" : "Mute"}>
              {state.muted || state.volume === 0 ? <MuteIcon className="h-4 w-4" /> : <VolumeIcon className="h-4 w-4" />}
            </button>
            <input type="range" aria-label="Volume" min={0} max={1} step={0.01} value={state.muted ? 0 : state.volume}
              onChange={(e) => player.setVolume(Number(e.target.value))} className="volume hidden w-24 lg:block" />
          </div>
          {showPath && <SignalPath track={track} state={state} gainDb={gainDb} onClose={() => setShowPath(false)} />}
        </div>
      </div>
    </div>
  );
}
