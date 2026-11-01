import { useEffect, useRef } from "react";
import Cover from "../components/Cover";
import { DownIcon, HeartIcon, HeartOutlineIcon, LyricsIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, QueueIcon } from "../components/Icons";
import Meta from "../components/Meta";
import { formatResolution } from "../lib/format";
import { usePlayer, useStreamTokenValue } from "../lib/hooks";
import { library, useLibrary } from "../lib/library";
import { player } from "../lib/player";
import { href } from "../lib/router";
import { ui, usePanel } from "../lib/ui";

function close() {
  if (window.history.length > 1) window.history.back();
  else window.location.hash = "#/";
}

/**
 * The stage: the playing song at full size, its cover colour blooming behind it
 * (--ambient, set by lib/ambient.js from the player bar's cover).
 */
export default function NowPlaying() {
  const state = usePlayer();
  const token = useStreamTokenValue();
  const { byId, offlineMode } = useLibrary();
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
      <div className="grid min-h-[60vh] place-items-center text-center">
        <div>
          <h1 className="text-4xl">Nothing playing yet</h1>
          <p className="mt-2 text-muted">Pick a song and it takes the stage here.</p>
          <a className="btn-primary mt-6" href={href("")}>Find something to play</a>
        </div>
      </div>
    );
  }

  const next = state.queue[state.index + 1];
  return (
    <div className="stage -mx-4 -mb-10 -mt-5 min-h-full px-5 pb-12 pt-5 md:-mx-6 md:px-10">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <button type="button" onClick={close} aria-label="Close Now Playing" className="btn-ghost h-10 w-10 justify-center px-0">
          <DownIcon className="h-6 w-6" />
        </button>
        <p className="text-sm text-fg-2">Now playing</p>
        <span className="w-10" />
      </div>

      <div className="mx-auto mt-6 grid max-w-6xl items-center gap-8 md:mt-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-14">
        <Cover track={track} token={token} eager rounded="rounded-lg"
          className="aspect-square w-full max-w-[min(30rem,80vw)] justify-self-center shadow-panel md:justify-self-end" />

        <div className="min-w-0">
          <h1 className="title-display text-[clamp(2.4rem,6vw,4.75rem)] leading-[0.95]">{track.title}</h1>
          <Meta className="mt-4 text-lg text-fg-2" parts={[
            <a key="ar" className="font-semibold text-fg hover:underline" href={href("artist", track.artist_id)}>{track.artist}</a>,
            track.album && <a key="al" className="hover:underline" href={href("album", track.album_id)}>{track.album}</a>,
          ]} />
          <p className="mt-2 text-sm tabular-nums text-muted">{track.codec.toUpperCase()} {formatResolution(track)}</p>

          <div className="mt-8 flex items-center gap-3">
            <button type="button" aria-label="Previous" onClick={() => player.previous()}
              className="grid h-12 w-12 place-items-center rounded-full text-fg hover:bg-fg/10"><PrevIcon className="h-6 w-6" /></button>
            <button ref={playButton} type="button" aria-label={state.playing ? "Pause" : "Play"} onClick={() => player.togglePlay()}
              className="grid h-20 w-20 place-items-center rounded-full bg-accent text-accent-ink shadow-panel transition-transform duration-micro ease-out active:scale-95">
              {state.playing ? <PauseIcon className="h-9 w-9" /> : <PlayIcon className="ml-1 h-9 w-9" />}
            </button>
            <button type="button" aria-label="Next" onClick={() => player.next()}
              className="grid h-12 w-12 place-items-center rounded-full text-fg hover:bg-fg/10"><NextIcon className="h-6 w-6" /></button>
            <button type="button" onClick={() => library.toggleFavorite(track)} disabled={offlineMode}
              aria-label={live.favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={!!live.favorite}
              className={`ml-2 grid h-12 w-12 place-items-center rounded-full hover:bg-fg/10 ${live.favorite ? "text-accent" : "text-fg"}`}>
              {live.favorite ? <HeartIcon className="h-6 w-6" /> : <HeartOutlineIcon className="h-6 w-6" />}
            </button>
          </div>

          <div className="mt-8 flex flex-wrap gap-2">
            <button type="button" className={`btn-secondary ${panel === "lyrics" ? "!border-accent" : ""}`}
              aria-pressed={panel === "lyrics"} onClick={() => ui.togglePanel("lyrics")}>
              <LyricsIcon className="h-4 w-4" /> Lyrics
            </button>
            <button type="button" className={`btn-secondary ${panel === "queue" ? "!border-accent" : ""}`}
              aria-pressed={panel === "queue"} onClick={() => ui.togglePanel("queue")}>
              <QueueIcon className="h-4 w-4" /> Up next
            </button>
          </div>
          {next && (
            <p className="mt-6 truncate text-sm text-muted">
              Next: <span className="text-fg-2">{next.title}</span>, {next.artist}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
