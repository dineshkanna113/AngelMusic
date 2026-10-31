import { useState } from "react";
import { api } from "../lib/api";
import { formatSize, formatTime } from "../lib/format";
import { useStreamTokenValue } from "../lib/hooks";
import { href } from "../lib/router";
import { toast, toastError } from "../lib/toast";
import { STATUS_LABELS, uploadAudioUrl, uploadCoverUrl } from "../lib/uploads";
import { confirmDialog, Modal, mount, promptDialog } from "./Dialog";
import { DiscIcon, MoreIcon, PlayIcon, TrashIcon } from "./Icons";
import { Menu, MenuItem, MenuSeparator } from "./Menu";
import QualityBadge from "./QualityBadge";

const FIELDS = [
  ["title", "Title"], ["artist", "Artist"], ["album", "Album"], ["album_artist", "Album artist"],
  ["genre", "Genre"], ["year", "Year"], ["track_no", "Track #"], ["disc_no", "Disc #"],
];
const NUMERIC = new Set(["track_no", "disc_no"]);

function TagEditor({ upload, onDone }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(FIELDS.map(([k]) => [k, upload.metadata?.[k] == null ? "" : String(upload.metadata[k])])));
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body = Object.fromEntries(FIELDS.map(([k]) => [k, NUMERIC.has(k) ? (values[k] ? Number(values[k]) : null) : values[k]]));
    try {
      onDone(await api(`/api/uploads/${upload.id}`, { method: "PATCH", body }));
      toast("Tags saved; they're written into the file when it's published");
    } catch (err) {
      toastError(err);
      setBusy(false);
    }
  };

  return (
    <Modal title={`Edit tags · ${upload.filename}`} onClose={() => onDone(null)} wide>
      <form onSubmit={save} className="grid grid-cols-2 gap-3">
        {FIELDS.map(([k, label]) => (
          <label key={k} className={`space-y-1 ${["title", "artist", "album", "album_artist"].includes(k) ? "col-span-2" : ""}`}>
            <span className="text-xs text-muted">
              {label}{upload.edited.includes(k) && <span className="ml-1 text-gold">· edited</span>}
            </span>
            <input className="input" value={values[k]} required={k === "title"}
              inputMode={NUMERIC.has(k) || k === "year" ? "numeric" : undefined}
              pattern={k === "year" ? "\\d{4}" : NUMERIC.has(k) ? "\\d{1,3}" : undefined}
              maxLength={k === "genre" ? 100 : 300}
              onChange={(e) => setValues({ ...values, [k]: e.target.value })} />
          </label>
        ))}
        <div className="col-span-2 mt-2 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => onDone(null)}>Cancel</button>
          <button className="btn-primary" disabled={busy}>Save tags</button>
        </div>
      </form>
    </Modal>
  );
}

function ScheduleDialog({ onDone }) {
  const tomorrow = new Date(Date.now() + 86_400_000);
  tomorrow.setHours(0, 0, 0, 0);
  const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [value, setValue] = useState(local(tomorrow));
  return (
    <Modal title="Schedule release" onClose={() => onDone(null)}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onDone(new Date(value).toISOString()); }}>
        <label className="block space-y-1.5">
          <span className="text-xs text-muted">Goes live for everyone at (your local time)</span>
          <input type="datetime-local" className="input" value={value} min={local(new Date())} required
            onChange={(e) => setValue(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => onDone(null)}>Cancel</button>
          <button className="btn-primary">Schedule</button>
        </div>
      </form>
    </Modal>
  );
}

export const editTags = (upload) => mount((done) => <TagEditor upload={upload} onDone={done} />);
const pickReleaseTime = () => mount((done) => <ScheduleDialog onDone={done} />);

const STATUS_TONE = {
  invalid: "bg-danger/15 text-danger", declined: "bg-danger/15 text-danger", removed: "bg-danger/15 text-danger",
  pending: "bg-gold/15 text-gold", scheduled: "bg-accent/15 text-accent", published: "bg-accent/15 text-accent",
};

export const hasErrors = (u) => u.issues.some((i) => i.level === "error");

export async function approveUpload(upload, releaseAt = null) {
  return api(`/api/uploads/${upload.id}/approve`, { method: "POST", body: releaseAt ? { release_at: releaseAt } : {} });
}

const when = (sqlTime) => sqlTime && new Date(`${sqlTime.replace(" ", "T")}Z`).toLocaleString();

/**
 * One submission. Uploaders can preview, fix tags and withdraw; admins also approve,
 * schedule and decline.
 */
export default function UploadRow({ upload: u, admin = false, onChange, selected, onSelect }) {
  const token = useStreamTokenValue();
  const [previewing, setPreviewing] = useState(false);
  const md = u.metadata;
  const canEdit = ["pending", "invalid"].includes(u.status) || (admin && u.status === "scheduled");
  const canReview = admin && ["pending", "scheduled"].includes(u.status) && !hasErrors(u);
  const canPreview = !["uploading", "published", "removed"].includes(u.status);

  const run = async (fn, message) => {
    try {
      const next = await fn();
      if (message) toast(message);
      onChange(next ?? null, u);
    } catch (err) {
      toastError(err);
    }
  };
  const edit = async () => {
    const next = await editTags(u);
    if (next) onChange(next, u);
  };
  const schedule = async () => {
    const at = await pickReleaseTime();
    if (at) run(() => approveUpload(u, at), `Scheduled for ${new Date(at).toLocaleString()}`);
  };
  const decline = async () => {
    const note = await promptDialog({ title: `Decline ${md?.title ?? u.filename}?`, label: "Reason (shown to the uploader)", confirmLabel: "Decline" });
    if (note !== null) {
      run(() => api(`/api/uploads/${u.id}/decline`, { method: "POST", body: { note } }), "Declined");
    }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: "Delete this upload?", message: `${u.filename} will be removed from the server.` }))) return;
    run(async () => { await api(`/api/uploads/${u.id}`, { method: "DELETE" }); return null; }, "Upload deleted");
  };

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        {onSelect && (
          <input type="checkbox" className="mt-4" checked={selected} disabled={!canReview}
            aria-label={`Select ${md?.title ?? u.filename}`} onChange={(e) => onSelect(e.target.checked)} />
        )}
        <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded bg-surface-2">
          {u.technical?.has_cover && canPreview && token
            ? <img src={uploadCoverUrl(u.id, token)} alt="" className="h-full w-full object-cover" loading="lazy" />
            : <DiscIcon className="h-6 w-6 text-muted" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">{md?.title || u.filename}</p>
            <span className={`rounded px-1.5 py-px text-[11px] font-medium ${STATUS_TONE[u.status] ?? "bg-surface-3 text-muted"}`}>
              {STATUS_LABELS[u.status] ?? u.status}
            </span>
            {u.technical && <QualityBadge track={u.technical} />}
          </div>
          <p className="truncate text-xs text-muted">
            {md ? [md.artist || "No artist", md.album || "No album", md.year].filter(Boolean).join(" · ") : "Checking file…"}
          </p>
          <p className="truncate text-[11px] text-muted">
            {u.filename} · {formatSize(u.size)}{u.technical ? ` · ${formatTime(u.technical.duration)}` : ""}
            {admin && u.uploader ? ` · by ${u.uploader}` : ""} · {when(u.created_at)}
          </p>
          {u.issues.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {u.issues.map((i) => (
                <li key={i.code + i.message} className={`text-xs ${i.level === "error" ? "text-danger" : "text-gold"}`}>
                  {i.level === "error" ? "✕" : "!"} {i.message}
                  {i.track_id && i.code === "possible_duplicate" && admin && (
                    <a className="ml-1 underline" href={href("search", md?.title ?? "")}>View</a>
                  )}
                </li>
              ))}
            </ul>
          )}
          {u.status === "scheduled" && <p className="mt-1 text-xs text-accent">Goes live {when(u.release_at)}</p>}
          {u.review_note && <p className="mt-1 text-xs text-muted">Reviewer note: {u.review_note}</p>}
          {u.status === "published" && <p className="mt-1 text-xs text-muted">Live since {when(u.published_at)}{u.reviewer ? ` · approved by ${u.reviewer}` : ""}</p>}
          {previewing && token && (
            <audio className="mt-2 h-9 w-full max-w-md" controls autoPlay preload="metadata" src={uploadAudioUrl(u.id, token)} />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canPreview && u.technical && (
            <button type="button" aria-label={previewing ? "Hide preview" : "Preview"} title="Preview"
              className={`grid h-8 w-8 place-items-center rounded-full hover:bg-surface-3 ${previewing ? "text-accent" : "text-muted"}`}
              onClick={() => setPreviewing((v) => !v)}>
              <PlayIcon className="h-4 w-4" />
            </button>
          )}
          {canReview && (
            <button type="button" className="btn-primary px-3 py-1 text-xs"
              onClick={() => run(() => approveUpload(u), `${md?.title ?? u.filename} is live`)}>
              Publish
            </button>
          )}
          <Menu label="Upload actions" trigger={<MoreIcon className="h-4 w-4" />}
            className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-fg">
            {(close) => (
              <>
                <MenuItem close={close} disabled={!canEdit || !md} onSelect={edit}>Edit tags…</MenuItem>
                {admin && (
                  <>
                    <MenuItem close={close} disabled={!canReview} onSelect={schedule}>
                      {u.status === "scheduled" ? "Change release time…" : "Schedule release…"}
                    </MenuItem>
                    <MenuItem close={close} disabled={!["pending", "scheduled", "invalid"].includes(u.status)} onSelect={decline}>
                      Decline…
                    </MenuItem>
                  </>
                )}
                <MenuSeparator />
                <MenuItem icon={TrashIcon} close={close} danger
                  disabled={["published", "processing"].includes(u.status)} onSelect={remove}>
                  Delete upload
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
      </div>
    </li>
  );
}
