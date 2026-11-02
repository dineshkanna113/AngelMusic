import { useEffect, useRef } from "react";
import Cover from "../components/Cover";
import { DownIcon, HeartIcon, HeartOutlineIcon, LyricsIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, QueueIcon, ShareIcon, ShuffleIcon } from "../components/Icons";
import Meta from "../components/Meta";
import { SleepTimer } from "../components/PlayerBar";
import { shareTrack } from "../components/ShareDialog";
import { Artifact, StickerLabel } from "../components/Stickers";
import { useActivity } from "../lib/activity";
import { formatResolution, isHiRes } from "../lib/format";
import { usePlayer, useStreamTokenValue } from "../lib/hooks";
import { library, useLibrary } from "../lib/library";
import { player } from "../lib/player";
import { href } from "../lib/router";
import { ui, usePanel } from "../lib/ui";

function close() {
  if (window.history.length > 1) window.history.back();
  else window.location.hash = "#/";
}

// Syne is wide: shorter titles get the big size, long ones step down so words never break mid-way.
const titleSize = (t) =>
  t.length <= 8 ? "text-[clamp(2.4rem,5vw,4rem)]" : t.length <= 14 ? "text-[clamp(1.9rem,3.4vw,2.9rem)]" : "text-[clamp(1.5rem,2.6vw,2.2rem)]";

const roundBtn = "grid h-12 w-12 place-items-center rounded-full bg-surface-1 text-ink shadow-sticker transition-transform duration-micro ease-out active:scale-95 disabled:opacity-50";

/**
 * The stage: the playing song at full size on a tilted sticker cover, tinted with the cover's
 * colour (--ambient, set by lib/ambient.js from the player pill's cover).
 */
export default function NowPlaying() {
  const state = usePlayer();
  const token = useStreamTokenValue();
  const { byId, offlineMode } = useLibrary();
  const friends = useActivity();
  const panel = usePanel();
  const playButton = useRef(null);
  const track = state.queue[state.index];
  const live = track ? byId.get(track.id) ?? track : null;

  useEffect(() => {
    playButton.current?.focus();
    const onKey = (e) => e.key === "Escape" && !e.defaultPrevented && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!track) {
    return (
      <div className="relative grid min-h-[60vh] place-items-center text-center">
        <div>
          <Artifact kind="vinyl" size={96} tilt={-8} className="mx-auto" />
          <h1 className="chrome mt-4 pb-1 text-4xl">Nothing playing yet</h1>
          <p className="mt-2 text-muted">Pick a song and it takes the stage here.</p>
          <a className="btn-primary mt-6" href={href("")}>Find something to play</a>
        </div>
      </div>
    );
  }

  const next = state.queue[state.index + 1];
  // Real, data-backed stickers only: your plays, the file's quality, friends on the same song.
  const here = (friends ?? []).filter((f) => f.live && f.track?.id === track.id).map((f) => f.person.display_name);
  return (
    <div className="stage relative -mx-4 -mb-10 -mt-4 min-h-full px-5 pb-12 pt-4 md:-mx-6 md:px-10">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <button type="button" onClick={close} aria-label="Close Now Playing" className={roundBtn}>
          <DownIcon className="h-6 w-6" />
        </button>
        <p className="font-display text-sm font-bold">Now playing</p>
        <span className="w-12" />
      </div>

      <div className="mx-auto mt-6 grid max-w-6xl items-center gap-10 md:mt-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-14">
        <div className="relative mx-auto w-full max-w-[min(30rem,64vw)] md:max-w-[min(30rem,82vw)] md:mr-0">
          <div className="cover-sticker" style={{ "--tilt": "-2.5deg" }}>
            <Cover track={track} token={token} eager rounded="" className="aspect-square w-full" />
          </div>
          {live.play_count >= 3 && <StickerLabel tone="lime" tilt={8} className="absolute -right-2 top-5 text-sm">on repeat</StickerLabel>}
          {isHiRes(track) && <StickerLabel tone="sky" tilt={-5} className="absolute -left-3 top-24 text-sm">hi-res</StickerLabel>}
          {here.length > 0 && (
            <StickerLabel tone="gum" tilt={-9} className="absolute -left-3 bottom-7 text-sm">
              {here.length === 1 ? `${here[0]} is here` : `${here[0]} and ${here.length - 1} more are here`}
            </StickerLabel>
          )}
          <Artifact kind="sparkle" size={48} tilt={14} className="absolute -bottom-4 -right-3" />
        </div>

        <div className="min-w-0">
          <h1 className={`chrome break-words pb-2 leading-[1.1] ${titleSize(track.title)}`}>{track.title}</h1>
          <Meta className="mt-2 text-lg text-fg-2" parts={[
            <a key="ar" className="font-bold text-fg hover:underline" href={href("artist", track.artist_id)}>{track.artist}</a>,
            track.album && <a key="al" className="hover:underline" href={href("album", track.album_id)}>{track.album}</a>,
          ]} />
          <p className="mt-2 text-sm font-semibold tabular-nums text-muted">{track.codec.toUpperCase()} {formatResolution(track)}</p>

          <div className="on-ink mt-8 flex flex-wrap items-center gap-3">
            <button type="button" aria-label="Previous" onClick={() => player.previous()} className={roundBtn}><PrevIcon className="h-6 w-6" /></button>
            <button ref={playButton} type="button" aria-label={state.playing ? "Pause" : "Play"} onClick={() => player.togglePlay()}
              className="flex h-16 min-w-40 items-center justify-center gap-3 rounded-pill bg-ink px-8 font-display text-lg font-bold text-accent shadow-float transition-transform duration-micro ease-out active:scale-95">
              {state.playing ? <PauseIcon className="h-7 w-7" /> : <PlayIcon className="h-7 w-7" />}
              {state.playing ? "Pause" : "Play"}
            </button>
            <button type="button" aria-label="Next" onClick={() => player.next()} className={roundBtn}><NextIcon className="h-6 w-6" /></button>
            <button type="button" onClick={() => library.toggleFavorite(track)} disabled={offlineMode}
              aria-label={live.favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={!!live.favorite}
              className={`${roundBtn} ${live.favorite ? "!text-social-ink" : ""}`}>
              {live.favorite ? <HeartIcon className="h-6 w-6" /> : <HeartOutlineIcon className="h-6 w-6" />}
            </button>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-social" onClick={() => shareTrack(live)}>
              <ShareIcon className="h-4 w-4" /> Share
            </button>
            <button type="button" className={`btn-secondary ${panel === "lyrics" ? "!bg-ink !text-accent" : ""}`}
              aria-pressed={panel === "lyrics"} onClick={() => ui.togglePanel("lyrics")}>
              <LyricsIcon className="h-4 w-4" /> Lyrics
            </button>
            <button type="button" className={`btn-secondary ${panel === "queue" ? "!bg-ink !text-accent" : ""}`}
              aria-pressed={panel === "queue"} onClick={() => ui.togglePanel("queue")}>
              <QueueIcon className="h-4 w-4" /> Up next
            </button>
            <button type="button" className={`${roundBtn} !h-11 !w-11 ${state.shuffle ? "!bg-ink !text-accent" : ""}`}
              aria-label="Shuffle" aria-pressed={state.shuffle} onClick={() => player.toggleShuffle()}>
              <ShuffleIcon className="h-5 w-5" />
            </button>
            <SleepTimer sleep={state.sleep} light />
          </div>
          {next && (
            <p className="mt-6 truncate text-sm text-muted">
              Next: <span className="font-semibold text-fg-2">{next.title}</span>, {next.artist}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
