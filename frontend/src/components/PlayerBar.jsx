import { useEffect, useState } from "react";
import { formatRate, formatTime, isHiRes } from "../lib/format";
import { usePlayer, useStreamTokenValue } from "../lib/hooks";
import { library, useLibrary } from "../lib/library";
import { player } from "../lib/player";
import { ambient } from "../lib/ambient";
import { href, navigate } from "../lib/router";
import { ui, usePanel } from "../lib/ui";
import Cover from "./Cover";
import {
  HeartIcon, HeartOutlineIcon, LyricsIcon, MoonIcon, MuteIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, QueueIcon,
  RepeatIcon, ShuffleIcon, VolumeIcon,
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
    <div className="flex items-center gap-3 text-xs tabular-nums text-ink-muted">
      <span className="w-10 text-right">{formatTime(value)}</span>
      <div className="relative h-5 flex-1">
        <div className="slot absolute inset-x-0 top-1/2 -translate-y-1/2">
          {state.buffered.map(([s, e]) => (
            <div key={s} className="absolute inset-y-0 bg-muted/25" style={{ left: pct(s), width: pct(e - s) }} />
          ))}
          <div className="slot-fill" style={{ width: pct(value) }} />
        </div>
        {drag !== null && <span className="scrub-bubble" style={{ left: pct(drag) }}>{formatTime(drag)}</span>}
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

/** `light`: for use on the pearl ground (the Now Playing stage) instead of the dark pill. */
export function SleepTimer({ sleep, light = false }) {
  const remaining = sleep?.mode === "time" ? Math.max(0, Math.ceil((sleep.at - Date.now()) / 60_000)) : null;
  return (
    <Menu
      label="Sleep timer"
      trigger={
        <span className="relative">
          <MoonIcon className="h-4 w-4" />
          {sleep && (
            <span className="absolute -right-2.5 -top-2 rounded-sm bg-accent px-1 text-[9px] font-semibold leading-3 text-accent-ink">
              {remaining ?? "end"}
            </span>
          )}
        </span>
      }
      className={light
        ? `grid h-11 w-11 place-items-center rounded-full bg-surface-1 shadow-sticker ${sleep ? "!bg-ink text-accent" : "text-ink"}`
        : `grid h-9 w-9 place-items-center rounded-full hover:text-white ${sleep ? "text-accent" : "text-ink-muted"}`}
    >
      {(close) => (
        <>
          <MenuLabel>{remaining !== null ? `Sleep timer, ${remaining} min left` : sleep ? "Sleep timer, end of track" : "Sleep timer"}</MenuLabel>
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

const iconBtn = "grid h-9 w-9 place-items-center rounded-full text-ink-muted transition-colors hover:text-white disabled:opacity-40";

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

  // No art: the stage falls back to the default colour instead of keeping the last cover's.
  useEffect(() => {
    if (track && !track.has_cover) ambient.reset();
  }, [track]);

  useEffect(() => {
    document.title = track ? `${state.playing ? "Playing: " : ""}${track.title}, ${track.artist}` : "Yaapu";
  }, [track, state.playing]);

  if (!track) return null;

  const gainDb = 20 * Math.log10(player.gainFactor(track.id));
  const repeatLabel = { off: "Repeat off", all: "Repeat all", one: "Repeat one" }[state.repeat];

  return (
    <div className="px-3 pb-3 pt-2 md:px-4">
      <div className="on-ink relative mx-auto max-w-6xl rounded-[32px] bg-ink px-3 py-2.5 text-white shadow-float md:rounded-pill md:px-4">
        {state.error && <p role="alert" className="mb-2 rounded-pill bg-danger px-4 py-1 text-center text-xs text-white">{state.error}</p>}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 items-center gap-3">
            <a href={href("now")} aria-label="Open Now Playing" className="shrink-0">
              <Cover track={track} token={token} className={`spin h-12 w-12 border-[3px] border-white md:h-14 md:w-14 ${state.playing ? "playing" : ""}`}
                rounded="rounded-full" eager onImage={ambient.fromImage} />
            </a>
            <div className="min-w-0">
              <button type="button" onClick={() => navigate("now")} className="block max-w-full text-left">
                <span className="title-display block truncate text-base hover:underline">{track.title}</span>
              </button>
              <a href={href("artist", track.artist_id)} className="block truncate text-xs text-ink-muted hover:text-white hover:underline">{track.artist}</a>
            </div>
            <button type="button" onClick={() => library.toggleFavorite(track)} disabled={offlineMode}
              aria-label={live.favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={!!live.favorite}
              className={`${iconBtn} hidden sm:grid ${live.favorite ? "!text-social" : ""}`}>
              {live.favorite ? <HeartIcon className="h-5 w-5" /> : <HeartOutlineIcon className="h-5 w-5" />}
            </button>
          </div>

          {/* Phone: play and next on the first row */}
          <div className="flex items-center gap-1 md:hidden">
            <button type="button" onClick={() => player.togglePlay()} aria-label={state.playing ? "Pause" : "Play"}
              className="relative grid h-12 w-12 place-items-center rounded-full bg-accent text-ink active:scale-95">
              {state.buffering && <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-ink" />}
              {state.playing ? <PauseIcon className="h-6 w-6" /> : <PlayIcon className="ml-0.5 h-6 w-6" />}
            </button>
            <button type="button" className={iconBtn} onClick={() => player.next()} aria-label="Next"><NextIcon className="h-5 w-5" /></button>
          </div>

          <div className="col-span-2 md:col-span-1">
            <div className="mb-0.5 hidden items-center justify-center gap-1.5 md:flex">
              <button type="button" className={`${iconBtn} ${state.shuffle ? "!text-accent" : ""}`} onClick={() => player.toggleShuffle()}
                aria-label="Shuffle" aria-pressed={state.shuffle}>
                <ShuffleIcon className="h-4 w-4" />
              </button>
              <button type="button" className={iconBtn} onClick={() => player.previous()} aria-label="Previous"><PrevIcon className="h-5 w-5" /></button>
              <button type="button" onClick={() => player.togglePlay()} aria-label={state.playing ? "Pause" : "Play"}
                className="relative grid h-12 w-12 place-items-center rounded-full bg-accent text-ink transition-transform duration-micro ease-out hover:scale-105 active:scale-95">
                {state.buffering && <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-ink" />}
                {state.playing ? <PauseIcon className="h-6 w-6" /> : <PlayIcon className="ml-0.5 h-6 w-6" />}
              </button>
              <button type="button" className={iconBtn} onClick={() => player.next()} aria-label="Next"><NextIcon className="h-5 w-5" /></button>
              <button type="button" className={`${iconBtn} relative ${state.repeat !== "off" ? "!text-accent" : ""}`}
                onClick={() => player.cycleRepeat()} aria-label={repeatLabel} title={repeatLabel}>
                <RepeatIcon className="h-4 w-4" />
                {state.repeat === "one" && <span className="absolute right-1 top-1 text-[9px] font-bold">1</span>}
              </button>
            </div>
            <SeekBar state={state} />
          </div>

          <div className="relative col-span-2 hidden items-center justify-between gap-1 md:col-span-1 md:flex md:justify-end">
            <button
              type="button"
              onClick={() => setShowPath((v) => !v)}
              aria-expanded={showPath}
              title="Signal path"
              aria-label={`Signal path: ${track.codec.toUpperCase()}${track.bit_depth ? ` ${track.bit_depth}-bit` : ""} ${formatRate(track.sample_rate)}`}
              className={`whitespace-nowrap rounded-pill px-3 py-1 font-display text-xs font-bold tabular-nums ${isHiRes(track) ? "bg-accent text-ink" : "bg-ink-soft text-white"}`}
            >
              {track.bit_depth ? `${track.bit_depth}/` : ""}{track.sample_rate ? +(track.sample_rate / 1000).toFixed(1) : "?"} {track.codec.toUpperCase()}
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
                onChange={(e) => player.setVolume(Number(e.target.value))} className="volume hidden w-24 lg:block"
                style={{ "--level": `${(state.muted ? 0 : state.volume) * 100}%` }} />
            </div>
            {showPath && <SignalPath track={track} state={state} gainDb={gainDb} onClose={() => setShowPath(false)} />}
          </div>
        </div>
      </div>
    </div>
  );
}
