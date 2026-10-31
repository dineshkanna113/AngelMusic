import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { usePlayer, usePlayerSelect, useStreamTokenValue } from "../lib/hooks";
import { player } from "../lib/player";
import { ui, usePanel } from "../lib/ui";
import Cover from "./Cover";
import { CloseIcon, DownIcon, TrashIcon, UpIcon } from "./Icons";
import { newPlaylistWith } from "./TrackMenu";

function PanelFrame({ title, actions, children }) {
  return (
    <aside className="fixed inset-x-0 bottom-[var(--player-h)] top-0 z-30 flex flex-col border-l border-line bg-surface-1 lg:static lg:inset-auto lg:z-auto lg:w-96 lg:shrink-0">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="flex-1 text-sm font-semibold">{title}</h2>
        {actions}
        <button type="button" aria-label="Close panel" onClick={() => ui.closePanel()} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:text-fg">
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}

function QueueRow({ track, index, current, token, isFirst, isLast }) {
  return (
    <li className={`group flex items-center gap-3 px-3 py-1.5 hover:bg-surface-2 ${current ? "bg-surface-2/70" : ""}`}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => player.jumpTo(index)}>
        <Cover track={track} token={token} className="h-9 w-9" />
        <span className="min-w-0">
          <span className={`block truncate text-sm ${current ? "font-medium text-accent" : ""}`}>{track.title}</span>
          <span className="block truncate text-xs text-muted">{track.artist}</span>
        </span>
      </button>
      {!current && (
        <span className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          <button type="button" aria-label="Move up" disabled={isFirst} onClick={() => player.moveInQueue(index, index - 1)}
            className="grid h-7 w-6 place-items-center text-muted hover:text-fg disabled:invisible"><UpIcon className="h-4 w-4" /></button>
          <button type="button" aria-label="Move down" disabled={isLast} onClick={() => player.moveInQueue(index, index + 1)}
            className="grid h-7 w-6 place-items-center text-muted hover:text-fg disabled:invisible"><DownIcon className="h-4 w-4" /></button>
          <button type="button" aria-label={`Remove ${track.title} from queue`} onClick={() => player.removeFromQueue(index)}
            className="grid h-7 w-7 place-items-center text-muted hover:text-danger"><TrashIcon className="h-4 w-4" /></button>
        </span>
      )}
    </li>
  );
}

function QueuePanel() {
  const queue = usePlayerSelect((s) => s.queue);
  const index = usePlayerSelect((s) => s.index);
  const token = useStreamTokenValue();
  const current = queue[index];
  const upcoming = queue.slice(index + 1);
  const history = queue.slice(0, Math.max(0, index));

  return (
    <PanelFrame
      title="Queue"
      actions={queue.length > 0 && (
        <>
          <button type="button" className="btn-ghost text-xs" onClick={() => newPlaylistWith(queue)}>Save</button>
          {upcoming.length > 0 && <button type="button" className="btn-ghost text-xs" onClick={() => player.clearUpcoming()}>Clear</button>}
        </>
      )}
    >
      {!current && <p className="p-4 text-sm text-muted">The queue is empty. Play something, or use “Add to queue”.</p>}
      {current && (
        <>
          <h3 className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Now playing</h3>
          <ul><QueueRow track={current} index={index} current token={token} /></ul>
          <h3 className="px-4 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Up next {upcoming.length > 0 && `· ${upcoming.length}`}
          </h3>
          {upcoming.length === 0 && <p className="px-4 text-sm text-muted">Nothing queued.</p>}
          <ul>
            {upcoming.map((t, i) => (
              <QueueRow key={`${t.id}-${index + 1 + i}`} track={t} index={index + 1 + i} token={token}
                isFirst={i === 0} isLast={i === upcoming.length - 1} />
            ))}
          </ul>
          {history.length > 0 && (
            <>
              <h3 className="px-4 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">Played</h3>
              <ul className="opacity-60">
                {history.map((t, i) => <QueueRow key={`${t.id}-${i}`} track={t} index={i} token={token} isFirst={i === 0} />)}
              </ul>
            </>
          )}
        </>
      )}
    </PanelFrame>
  );
}

function LyricsPanel() {
  const { queue, index, currentTime } = usePlayer();
  const track = queue[index];
  const [state, setState] = useState({ id: null, lyrics: null, error: "" });
  const activeRef = useRef(null);
  const containerRef = useRef(null);
  const userScrolled = useRef(0);

  useEffect(() => {
    if (!track) return;
    if (!track.has_lyrics) {
      setState({ id: track.id, lyrics: null, error: "" });
      return;
    }
    let alive = true;
    setState({ id: track.id, lyrics: undefined, error: "" });
    api(`/api/tracks/${track.id}/lyrics`)
      .then((l) => alive && setState({ id: track.id, lyrics: l, error: "" }))
      .catch((err) => alive && setState({ id: track.id, lyrics: null, error: err.status === 404 ? "" : err.message }));
    return () => {
      alive = false;
    };
  }, [track]);

  const synced = state.lyrics?.synced;
  const activeIdx = useMemo(() => {
    if (!synced) return -1;
    let lo = -1;
    for (let i = 0; i < synced.length && synced[i].time <= currentTime + 0.15; i++) lo = i;
    return lo;
  }, [synced, currentTime]);

  useEffect(() => {
    // Follow the active line unless the user scrolled in the last 4 seconds.
    if (Date.now() - userScrolled.current < 4000) return;
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIdx]);

  let body;
  if (!track) body = <p className="p-4 text-sm text-muted">Nothing playing.</p>;
  else if (state.lyrics === undefined) body = <p className="p-4 text-sm text-muted">Loading lyrics…</p>;
  else if (state.error) body = <p className="p-4 text-sm text-danger">{state.error}</p>;
  else if (!state.lyrics) {
    body = (
      <p className="p-4 text-sm text-muted">
        No lyrics for this track. Add a <code className="font-mono">LYRICS</code> tag, or put a <code className="font-mono">.lrc</code> file
        with the same name next to the audio file for time-synced lyrics.
      </p>
    );
  } else if (synced) {
    body = (
      <ol className="space-y-3 px-5 py-6">
        {synced.map((line, i) => (
          <li key={`${line.time}-${i}`} ref={i === activeIdx ? activeRef : null}>
            <button
              type="button"
              onClick={() => player.seek(line.time)}
              className={`text-left text-lg font-semibold leading-snug transition-colors ${
                i === activeIdx ? "text-fg" : i < activeIdx ? "text-muted/60" : "text-muted"
              } hover:text-fg`}
            >
              {line.text || "♪"}
            </button>
          </li>
        ))}
      </ol>
    );
  } else {
    body = <p className="whitespace-pre-line px-5 py-6 text-base leading-relaxed">{state.lyrics.plain}</p>;
  }

  return (
    <PanelFrame title={track ? `Lyrics · ${track.title}` : "Lyrics"}>
      <div ref={containerRef} onWheel={() => (userScrolled.current = Date.now())} onTouchMove={() => (userScrolled.current = Date.now())}>
        {body}
      </div>
    </PanelFrame>
  );
}

export default function SidePanel() {
  const panel = usePanel();
  if (panel === "queue") return <QueuePanel />;
  if (panel === "lyrics") return <LyricsPanel />;
  return null;
}
