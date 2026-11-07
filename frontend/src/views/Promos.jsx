import { useEffect, useState } from "react";
import { PageHeader } from "../components/Grid";
import { API_BASE, accessToken, ApiError } from "../lib/api";
import { billingApi } from "../lib/billing";
import { toast, toastError } from "../lib/toast";

const EMPTY = { title: "", body: "", link: "", starts_at: "", ends_at: "" };

async function uploadImage(id, file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/promos/${id}/image`, {
    method: "POST", headers: { Authorization: `Bearer ${await accessToken()}` }, body: form,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.detail || `Upload failed (${res.status})`);
}

/** Admin: the promo cards Free users see on Home and Browse. */
export default function Promos() {
  const [promos, setPromos] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => billingApi.allPromos().then(setPromos).catch((e) => { toastError(e); setPromos([]); });
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { title: form.title.trim(), body: form.body.trim(), link: form.link.trim() || null,
        starts_at: form.starts_at || null, ends_at: form.ends_at || null };
      const made = await billingApi.createPromo(body);
      if (file) await uploadImage(made.id, file).catch(toastError);
      toast("Promo added");
      setForm(EMPTY); setFile(null); e.target.reset();
      load();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (p) => billingApi.editPromo(p.id, { active: !p.active }).then(load).catch(toastError);
  const remove = (p) => billingApi.deletePromo(p.id).then(() => { toast("Promo removed"); load(); }).catch(toastError);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  return (
    <div className="relative z-10 max-w-3xl">
      <PageHeader title="Promos" subtitle="Cards Free listeners see on Home and Browse. Premium listeners never see them." />
      <ul className="mb-8 divide-y divide-line rounded-lg bg-surface-1/80 shadow-card">
        {promos === null && <li className="p-4 text-sm text-muted">Loading…</li>}
        {promos?.length === 0 && <li className="p-4 text-sm text-muted">No promos yet.</li>}
        {promos?.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            {p.image_url && <img src={`${API_BASE}${p.image_url}`} alt="" className="h-12 w-12 rounded-md object-cover" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{p.title}</span>
              <span className="block truncate text-xs text-muted">{p.active ? "Live" : "Paused"}{p.starts_at ? ` · from ${p.starts_at.slice(0, 10)}` : ""}{p.ends_at ? ` · until ${p.ends_at.slice(0, 10)}` : ""}</span>
            </span>
            <button type="button" className="btn-ghost text-xs" onClick={() => toggle(p)}>{p.active ? "Pause" : "Resume"}</button>
            <button type="button" className="btn-ghost text-xs" onClick={() => remove(p)}>Delete</button>
          </li>
        ))}
      </ul>
      <form onSubmit={create} className="grid max-w-xl gap-4 rounded-lg bg-surface-1/80 p-5 shadow-card">
        <h2 className="font-display text-lg font-bold">Add a promo</h2>
        <label className="grid gap-1.5"><span className="text-sm text-fg-2">Title</span>
          <input className="input" required maxLength={80} value={form.title} onChange={set("title")} /></label>
        <label className="grid gap-1.5"><span className="text-sm text-fg-2">Text <span className="text-muted">(optional)</span></span>
          <input className="input" maxLength={200} value={form.body} onChange={set("body")} /></label>
        <label className="grid gap-1.5"><span className="text-sm text-fg-2">Link <span className="text-muted">(https:// or a place in the app like #/browse)</span></span>
          <input className="input" value={form.link} onChange={set("link")} /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5"><span className="text-sm text-fg-2">Starts</span>
            <input className="input" type="date" value={form.starts_at} onChange={set("starts_at")} /></label>
          <label className="grid gap-1.5"><span className="text-sm text-fg-2">Ends</span>
            <input className="input" type="date" value={form.ends_at} onChange={set("ends_at")} /></label>
        </div>
        <label className="grid gap-1.5"><span className="text-sm text-fg-2">Image <span className="text-muted">(PNG, JPEG or WebP, under 2 MB)</span></span>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <div><button className="btn-primary" disabled={busy || !form.title.trim()}>{busy ? "Adding…" : "Add promo"}</button></div>
      </form>
    </div>
  );
}
