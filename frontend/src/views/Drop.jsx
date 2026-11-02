import { useCallback, useEffect, useState } from "react";
import Countdown from "../components/Countdown";
import { Artifact, StickerLabel } from "../components/Stickers";
import { artSrc, growth, parseUtc } from "../lib/growth";
import { plural } from "../lib/format";
import { headingSize } from "../lib/format";
import { player } from "../lib/player";
import { useLibrary } from "../lib/library";
import { href } from "../lib/router";
import { toast, toastError } from "../lib/toast";

/** One release: artwork, countdown, pre-save, and a play button once it is out. */
export default function Drop({ slug }) {
  const { tracks } = useLibrary();
  const [drop, setDrop] = useState(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () => growth.drop(slug).then(setDrop).catch(() => setMissing(true)),
    [slug],
  );
  useEffect(() => { setDrop(null); setMissing(false); load(); }, [load]);

  if (missing) return <p className="text-sm text-muted">This drop is gone or the link is wrong.</p>;
  if (!drop) return <p className="text-sm text-muted">Loading…</p>;

  const art = artSrc(drop.artwork_url);
  const track = drop.track_id ? tracks?.find((t) => t.id === drop.track_id) : null;
  const releaseDate = new Date(parseUtc(drop.release_at)).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" });

  const togglePresave = async () => {
    const on = !drop.presaved;
    setBusy(true);
    try {
      await growth.presave(drop.id, on);
      setDrop((d) => ({ ...d, presaved: on, presaves: Math.max(0, d.presaves + (on ? 1 : -1)) }));
      if (on) toast("Pre-saved. It lands in your favorites on release.");
    } catch (err) {
      toastError(err);
      load();
    } finally {
      setBusy(false);
    }
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${drop.share_url}`);
      toast("Link copied");
    } catch {
      toast(`${window.location.origin}${drop.share_url}`);
    }
  };

  return (
    <div className="relative z-10 mx-auto grid max-w-4xl gap-8 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] md:items-center">
      <div className="cover-sticker mx-auto w-64 md:w-full" style={{ "--tilt": "-3deg" }}>
        <div className="relative aspect-square w-full overflow-hidden bg-lilac">
          {art ? <img src={art} alt={`Artwork for ${drop.title}`} className="h-full w-full object-cover" />
            : <div className="grid h-full w-full place-items-center"><Artifact kind="vinyl" size={140} tilt={8} /></div>}
        </div>
      </div>
      <div className="min-w-0">
        <StickerLabel tone={drop.status === "out" ? "sky" : "lime"} tilt={-4}>
          {drop.status === "out" ? "out now" : drop.status === "dropping_soon" ? "dropping soon" : "coming soon"}
        </StickerLabel>
        <h1 className={`chrome mt-3 break-words pb-2 leading-[1.1] ${headingSize(drop.title)}`}>{drop.title}</h1>
        <p className="text-lg">
          <a className="font-semibold hover:underline" href={href("artist", drop.artist.id)}>{drop.artist.name}</a>
        </p>
        {drop.description && <p className="mt-3 max-w-xl whitespace-pre-line text-fg-2">{drop.description}</p>}

        {drop.status === "upcoming" && (
          <div className="mt-6 grid gap-3">
            <Countdown releaseAt={drop.release_at} onDone={() => setDrop((d) => d && d.status === "upcoming" ? { ...d, status: "dropping_soon" } : d)} />
            <p className="text-sm text-muted">Drops {releaseDate}</p>
          </div>
        )}
        {drop.status === "dropping_soon" && (
          <p className="mt-6 text-sm text-muted">The time has come. It goes live as soon as the track is published.</p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {drop.status === "out" ? (
            track ? (
              <button type="button" className="btn-primary" onClick={() => player.playQueue([track], 0)}>Play now</button>
            ) : (
              <span className="text-sm text-muted">{tracks === null ? "Loading…" : "Find it in your library."}</span>
            )
          ) : (
            <button type="button" aria-pressed={drop.presaved} disabled={busy} onClick={togglePresave}
              className={drop.presaved ? "btn-secondary" : "btn-primary"}>
              {drop.presaved ? "Pre-saved" : "Pre-save"}
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={copyLink}>Copy link</button>
          {drop.status !== "out" && <span className="text-sm text-muted">{plural(drop.presaves, "pre-save")}</span>}
        </div>
      </div>
    </div>
  );
}
