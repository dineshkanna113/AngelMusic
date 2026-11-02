import { useEffect, useMemo, useState } from "react";
import Avatar from "../components/Avatar";
import DropCard from "../components/DropCard";
import { PageHeader, Section, Select } from "../components/Grid";
import LineChart from "../components/LineChart";
import { Artifact } from "../components/Stickers";
import { formatTime, plural } from "../lib/format";
import { growth } from "../lib/growth";
import { useSession } from "../lib/hooks";
import { useLibrary } from "../lib/library";
import { href } from "../lib/router";
import { toast, toastError } from "../lib/toast";
import { useStudioArtists } from "../lib/useStudio";

const WINDOWS = [["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"]];
const TONES = ["bg-accent", "bg-social", "bg-sky", "bg-peach"];

function Tile({ label, value, i }) {
  return (
    <div className={`rounded-lg border-[4px] border-white p-4 shadow-sticker ${TONES[i % TONES.length]}`}
      style={{ transform: `rotate(${[-1.5, 1, -1, 1.5][i % 4]}deg)` }}>
      <p className="font-display text-3xl font-bold tabular-nums leading-none text-ink">{value.toLocaleString()}</p>
      <p className="mt-1 text-xs font-semibold text-ink/70">{label}</p>
    </div>
  );
}

function Ranked({ rows, empty, render }) {
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  const top = Math.max(...rows.map((r) => r.plays));
  return (
    <ol className="grid gap-2">
      {rows.map((r, i) => (
        <li key={i} className="relative overflow-hidden rounded-md bg-surface-1/80 px-3 py-2">
          <span className="absolute inset-y-0 left-0 bg-accent/40" style={{ width: `${(r.plays / top) * 100}%` }} aria-hidden="true" />
          <span className="relative flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">{render(r)}</span>
            <span className="shrink-0 font-semibold tabular-nums">{plural(r.plays, "play")}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function DropForm({ artistId, uploads, onCreated }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [when, setWhen] = useState("");
  const [uploadId, setUploadId] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const drop = await growth.createDrop({
        artist_id: artistId, title: title.trim(), description: description.trim(),
        release_at: new Date(when).toISOString(), upload_id: uploadId || null,
      });
      if (file) await growth.uploadArtwork(drop.id, file).catch(toastError);
      toast("Drop announced");
      setTitle(""); setDescription(""); setWhen(""); setUploadId(""); setFile(null);
      e.target.reset();
      onCreated();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid max-w-xl gap-4 rounded-lg bg-surface-1/80 p-5 shadow-card">
      <label className="grid gap-1.5">
        <span className="text-sm text-fg-2">Title</span>
        <input className="input" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="grid gap-1.5">
        <span className="text-sm text-fg-2">Description <span className="text-muted">({500 - description.length} left)</span></span>
        <textarea className="input h-24 resize-none rounded-md py-3" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="grid gap-1.5">
        <span className="text-sm text-fg-2">Release time (your local time)</span>
        <input className="input" type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} />
      </label>
      {uploads.length > 0 && (
        <label className="grid gap-1.5">
          <span className="text-sm text-fg-2">Track to release</span>
          <select className="input" value={uploadId} onChange={(e) => setUploadId(e.target.value)}>
            <option value="">Choose later</option>
            {uploads.map((u) => <option key={u.id} value={u.id}>{u.metadata?.title || u.filename}</option>)}
          </select>
          <span className="text-xs text-muted">When this upload is published, the drop goes live and pre-savers get the track.</span>
        </label>
      )}
      <label className="grid gap-1.5">
        <span className="text-sm text-fg-2">Artwork <span className="text-muted">(PNG, JPEG or WebP, under 2 MB)</span></span>
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <div><button className="btn-primary" disabled={busy || !title.trim() || !when}>{busy ? "Announcing…" : "Announce drop"}</button></div>
    </form>
  );
}

function Drops({ artistId, uploads }) {
  const [drops, setDrops] = useState(null);
  const load = () => growth.drops(artistId).then(setDrops).catch(() => setDrops([]));
  useEffect(() => { setDrops(null); load(); }, [artistId]);

  const remove = async (d) => {
    try { await growth.deleteDrop(d.id); toast("Drop removed"); load(); } catch (err) { toastError(err); }
  };
  const copy = async (d) => {
    const url = `${window.location.origin}${d.share_url}`;
    try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { toast(url); }
  };

  return (
    <>
      {drops?.length > 0 && (
        <ul className="mb-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {drops.map((d, i) => (
            <li key={d.id} className="grid justify-items-start gap-2">
              <DropCard drop={d} tilt={[-2, 1.5, -1][i % 3]} />
              <div className="flex gap-2">
                <button type="button" className="btn-ghost" onClick={() => copy(d)}>Copy link</button>
                <button type="button" className="btn-ghost" onClick={() => remove(d)}>Delete</button>
              </div>
              <span className="text-xs text-muted">{plural(d.presaves, "pre-save")}</span>
            </li>
          ))}
        </ul>
      )}
      <h3 className="mb-3 font-display text-lg font-bold">Announce a drop</h3>
      <DropForm artistId={artistId} uploads={uploads} onCreated={load} />
    </>
  );
}

/** The artist's home: real numbers, their drops, and who listens most. */
export default function Studio() {
  const session = useSession();
  const isAdmin = session?.user?.is_admin;
  const owned = useStudioArtists();
  const { artists: libraryArtists } = useLibrary();
  const artists = useMemo(
    () => (isAdmin ? (libraryArtists ?? []).map((a) => ({ id: a.id, name: a.name })) : owned ?? []),
    [isAdmin, libraryArtists, owned],
  );
  const [artistId, setArtistId] = useState("");
  const [days, setDays] = useState("30");
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  const [uploads, setUploads] = useState([]);

  useEffect(() => { if (!artistId && artists.length) setArtistId(artists[0].id); }, [artists, artistId]);
  useEffect(() => {
    if (!artistId) return;
    setStats(null); setError("");
    growth.stats(artistId, days).then(setStats).catch((e) => setError(e.message));
  }, [artistId, days]);
  useEffect(() => {
    if (!session?.user?.can_upload) return;
    growth.uploads()
      .then((list) => setUploads(list.filter((u) => !["published", "removed"].includes(u.status))))
      .catch(() => setUploads([]));
  }, [session?.user?.can_upload]);

  if (owned === null && !isAdmin) return <p className="text-sm text-muted">Loading…</p>;
  if (!artists.length) {
    return (
      <div className="py-10 text-center">
        <Artifact kind="headphones" size={80} tilt={-8} className="mx-auto" />
        <p className="mt-4 font-display text-xl font-bold">No artist to manage yet</p>
        <p className="mt-1 text-sm text-muted">Ask an admin to give you access to your artist page.</p>
      </div>
    );
  }

  return (
    <div className="relative z-10">
      <PageHeader title="Studio" subtitle="Real numbers from real listening.">
        <Select label="Artist" value={artistId} onChange={setArtistId} options={artists.map((a) => [a.id, a.name])} />
        <Select label="Show" value={days} onChange={setDays} options={WINDOWS} />
      </PageHeader>
      {error && <p className="text-sm text-danger">{error}</p>}
      {stats === null && !error && <p className="text-sm text-muted">Loading…</p>}
      {stats && (
        <>
          <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3">
            <Tile i={0} label="plays" value={stats.plays} />
            <Tile i={1} label="listeners" value={stats.listeners} />
            <Tile i={2} label="followers" value={stats.followers} />
          </div>
          <Section title="Plays per day" art={<Artifact kind="vinyl" size={36} tilt={-10} />}>
            {stats.plays === 0 ? <p className="text-sm text-muted">No plays in this window yet.</p> : <LineChart series={stats.series} />}
          </Section>
          <div className="grid gap-x-10 lg:grid-cols-2">
            <Section title="Top tracks" art={<Artifact kind="drum" size={34} tilt={8} />}>
              <Ranked rows={stats.top_tracks} empty="Nothing played yet."
                render={(t) => <span className="truncate"><span className="font-semibold">{t.title}</span> <span className="text-muted">{formatTime(t.duration)}</span></span>} />
            </Section>
            <Section title="Top fans" art={<Artifact kind="sparkle" size={34} tilt={-8} />}>
              <Ranked rows={stats.top_fans} empty="No listeners yet."
                render={(f) => f.person ? (
                  <a className="flex min-w-0 items-center gap-2 hover:underline" href={href("u", f.person.username)}>
                    <Avatar person={f.person} className="h-7 w-7 text-xs" ring={false} />
                    <span className="truncate font-semibold">{f.person.display_name}</span>
                  </a>
                ) : <span className="text-muted">A private listener</span>} />
            </Section>
            <Section title="Countries">
              <Ranked rows={stats.countries} empty="Location shows up when Yaapu runs behind a CDN that reports where listeners are."
                render={(c) => <span className="font-semibold">{c.name}</span>} />
            </Section>
            <Section title="Cities">
              <Ranked rows={stats.cities} empty="No city data yet." render={(c) => <span className="font-semibold">{c.name}</span>} />
            </Section>
          </div>
        </>
      )}
      <Section title="Drops" art={<Artifact kind="cassette" size={38} tilt={6} />}>
        {artistId && <Drops artistId={artistId} uploads={uploads} />}
      </Section>
    </div>
  );
}
