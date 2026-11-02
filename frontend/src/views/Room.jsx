import { useEffect, useRef, useState } from "react";
import Avatar from "../components/Avatar";
import Cover from "../components/Cover";
import { PageHeader } from "../components/Grid";
import { Artifact, StickerLabel } from "../components/Stickers";
import { usePlayer, useStreamTokenValue } from "../lib/hooks";
import { useLibrary } from "../lib/library";
import { REACTIONS, roomSession, useRoom } from "../lib/rooms";
import { href, navigate } from "../lib/router";
import { toast, toastError } from "../lib/toast";

function Lobby() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const start = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      navigate("room", await roomSession.create(name.trim()));
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  const join = (e) => {
    e.preventDefault();
    if (code.trim().length === 6) navigate("room", code.trim().toUpperCase());
  };

  return (
    <div className="relative z-10">
      <PageHeader title="Rooms" subtitle="Listen together. Everyone hears the same song at the same moment." />
      <div className="grid gap-8 lg:grid-cols-2">
        <form onSubmit={start} className="grid content-start gap-4 rounded-lg border-[5px] border-white bg-accent p-6 shadow-card">
          <StickerLabel tone="ink" tilt={-4} className="justify-self-start">host</StickerLabel>
          <h2 className="font-display text-2xl font-bold text-ink">Start a room</h2>
          <p className="text-sm text-ink/80">Whatever you play, your guests hear. Share the code and they join.</p>
          <label className="grid gap-1.5">
            <span className="text-sm font-semibold text-ink">Room name <span className="font-normal text-ink/70">(optional)</span></span>
            <input className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div><button className="btn-secondary" disabled={busy}>{busy ? "Opening…" : "Open the room"}</button></div>
        </form>
        <form onSubmit={join} className="grid content-start gap-4 rounded-lg border-[5px] border-white bg-social p-6 shadow-card">
          <StickerLabel tone="ink" tilt={3} className="justify-self-start">guest</StickerLabel>
          <h2 className="font-display text-2xl font-bold text-ink">Join with a code</h2>
          <p className="text-sm text-ink/80">Ask the host for their 6-character code.</p>
          <label className="grid gap-1.5">
            <span className="text-sm font-semibold text-ink">Code</span>
            <input className="input uppercase tracking-[0.3em]" maxLength={6} autoComplete="off" value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, ""))} />
          </label>
          <div><button className="btn-secondary" disabled={code.trim().length !== 6}>Join</button></div>
        </form>
      </div>
    </div>
  );
}

function Chat({ chat, disabled }) {
  const [text, setText] = useState("");
  const log = useRef(null);
  useEffect(() => { log.current?.scrollTo(0, log.current.scrollHeight); }, [chat.length]);
  const send = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    roomSession.sendChat(text.trim());
    setText("");
  };
  return (
    <section aria-label="Chat" className="flex h-[26rem] flex-col rounded-lg bg-surface-1/80 p-3 shadow-card lg:h-full lg:min-h-[28rem]">
      <ul ref={log} role="log" aria-live="polite" className="flex-1 space-y-2 overflow-y-auto px-1 pb-2">
        {chat.length === 0 && <li className="text-sm text-muted">Say hi. Messages disappear when the room ends.</li>}
        {chat.map((m) => (
          <li key={m.id} className="flex items-start gap-2">
            <Avatar person={m.from} className="h-7 w-7 text-xs" ring={false} />
            <span className="min-w-0 text-sm"><span className="font-semibold">{m.from.display_name}</span>{" "}
              <span className="break-words text-fg-2">{m.text}</span></span>
          </li>
        ))}
      </ul>
      <form onSubmit={send} className="flex gap-2 pt-2">
        <input className="input min-w-0 flex-1" aria-label="Message" maxLength={280} placeholder="Message the room" disabled={disabled}
          value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn-primary" disabled={disabled || !text.trim()}>Send</button>
      </form>
    </section>
  );
}

function InRoom() {
  const room = useRoom();
  const { byId } = useLibrary();
  const token = useStreamTokenValue();
  const isHost = room.you?.is_host;
  const mine = usePlayer();
  // The host shows what their own player is on; everyone else shows what the host last sent.
  const track = isHost ? mine.queue[mine.index] ?? null : room.room?.track_id ? byId.get(room.room.track_id) : null;
  const open = room.status === "open";

  const invite = `${window.location.origin}${window.location.pathname}#/room/${room.code}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(invite); toast("Invite link copied"); } catch { toast(invite); }
  };
  const leave = () => { roomSession.leave(); navigate("room"); };
  const end = async () => {
    try { await roomSession.end(); toast("Room ended"); navigate("room"); } catch (err) { toastError(err); }
  };

  if (["gone", "full", "ended"].includes(room.status)) {
    return (
      <div className="py-10 text-center">
        <Artifact kind="boombox" size={90} tilt={-6} className="mx-auto" />
        <p className="mt-4 font-display text-xl font-bold">{room.error}</p>
        <button type="button" className="btn-primary mt-5" onClick={leave}>Back to Rooms</button>
      </div>
    );
  }

  return (
    <div className="relative z-10">
      <PageHeader title={room.room?.name ?? "Joining…"} subtitle={room.status === "reconnecting" ? "Reconnecting…" : room.status === "connecting" ? "Connecting…" : isHost ? "You’re the host. Whatever you play, everyone hears." : `Listening with ${room.room?.host.display_name}`}>
        <button type="button" className="btn-secondary" onClick={copy}>Copy invite</button>
        {isHost ? <button type="button" className="btn-ghost" onClick={end}>End room</button>
          : <button type="button" className="btn-ghost" onClick={leave}>Leave</button>}
      </PageHeader>
      {room.error && open && <p role="status" className="mb-4 text-sm font-semibold text-gum-ink">{room.error}</p>}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="relative min-w-0">
          <div className="mb-6 flex flex-wrap items-center gap-4">
            <StickerLabel tone="lime" tilt={-5}>code</StickerLabel>
            <span className="font-display text-4xl font-bold tracking-[0.25em] text-ink" aria-label={`Room code ${room.code.split("").join(" ")}`}>{room.code}</span>
          </div>
          <div className="flex items-center gap-5 rounded-lg bg-surface-1/80 p-4 shadow-card">
            <div className="cover-sticker w-28 shrink-0 sm:w-36" style={{ "--tilt": "-3deg" }}>
              <Cover track={track} token={token} className="aspect-square w-full" rounded="" eager />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-muted">Now playing</p>
              {track ? (
                <>
                  <p className="truncate font-display text-xl font-bold sm:text-2xl">{track.title}</p>
                  <p className="truncate text-sm text-muted">{track.artist}</p>
                </>
              ) : <p className="text-sm text-muted">{isHost ? "Play a song and it plays for everyone." : "Waiting for the host to play something."}</p>}
            </div>
          </div>
          <h2 className="mb-3 mt-8 text-xl">In the room</h2>
          <ul className="flex flex-wrap gap-3">
            {room.members.map((m) => (
              <li key={m.username} className="flex items-center gap-2 rounded-pill bg-surface-1/80 py-1 pl-1 pr-4 shadow-sticker">
                <Avatar person={m} className="h-8 w-8 text-sm" ring={false} />
                <span className="text-sm font-semibold">{m.display_name}</span>
                {m.is_host && <StickerLabel tone="gum" tilt={0} className="!px-2 !py-0 text-[11px]">host</StickerLabel>}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap gap-2" role="group" aria-label="Reactions">
            {REACTIONS.map((emoji) => (
              <button key={emoji} type="button" disabled={!open} onClick={() => roomSession.sendReaction(emoji)}
                aria-label={`React ${emoji}`}
                className="grid h-12 w-12 place-items-center rounded-full border-[3px] border-white bg-surface-1 text-2xl shadow-sticker transition-transform duration-short hover:-translate-y-1 active:scale-95 disabled:opacity-40">
                {emoji}
              </button>
            ))}
          </div>
          <div className="pointer-events-none absolute inset-x-0 -bottom-2 h-72 overflow-hidden" aria-hidden="true">
            {room.reactions.map((r) => (
              <span key={r.id} className="yp-float absolute bottom-0 text-4xl" style={{ left: `${r.x}%` }} title={r.from.display_name}>{r.emoji}</span>
            ))}
          </div>
        </div>
        <Chat chat={room.chat} disabled={!open} />
      </div>
    </div>
  );
}

/** #/room opens the lobby; #/room/CODE joins that room. */
export default function Room({ code }) {
  const room = useRoom();
  useEffect(() => {
    if (code) roomSession.join(code).catch(toastError);
  }, [code]);
  useEffect(() => {
    if (!code && room.code && ["open", "connecting", "reconnecting"].includes(room.status)) navigate("room", room.code);
  }, [code, room.code, room.status]);
  if (!code) return <Lobby />;
  // The first render happens before the join effect has set the room code.
  return room.code === code.toUpperCase() ? <InRoom /> : <p className="text-sm text-muted">Joining…</p>;
}

export const roomHref = (code) => href("room", code);
