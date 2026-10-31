import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "../components/Grid";
import { CloseIcon, UploadIcon } from "../components/Icons";
import UploadRow from "../components/UploadItem";
import { api } from "../lib/api";
import { formatSize, plural } from "../lib/format";
import { useSession } from "../lib/hooks";
import { library } from "../lib/library";
import { toast, toastError } from "../lib/toast";
import { AUDIO_EXTENSIONS, filesFromDrop, isAudioFile, STATUS_LABELS, uploads, useTransfers } from "../lib/uploads";

/** Submissions list with status tabs; polls while files are being checked or released. */
export function useUploadList(scope, status) {
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    const qs = new URLSearchParams({ scope, ...(status ? { status } : {}) });
    return api(`/api/uploads?${qs}`).then(setData).catch(toastError);
  }, [scope, status]);

  useEffect(() => {
    load();
  }, [load]);
  const busy = data?.uploads.some((u) => u.status === "processing");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [busy, load]);

  const replace = (next, prev) => {
    setData((d) => d && {
      ...d,
      uploads: next ? d.uploads.map((u) => (u.id === prev.id ? next : u)) : d.uploads.filter((u) => u.id !== prev.id),
    });
    if (next?.status === "published") library.load();
    load();
  };
  return { data, load, replace };
}

export function StatusTabs({ counts, value, onChange, order }) {
  const total = Object.values(counts ?? {}).reduce((a, b) => a + b, 0);
  return (
    <div role="tablist" className="mb-3 flex flex-wrap gap-1.5">
      {[["", "All", total], ...order.map((s) => [s, STATUS_LABELS[s], counts?.[s] ?? 0])].map(([s, label, n]) => (
        <button key={s} type="button" role="tab" aria-selected={value === s} onClick={() => onChange(s)}
          className={`rounded-full px-3 py-1 text-xs ${value === s ? "bg-fg text-surface-0" : "bg-surface-2 text-muted hover:text-fg"}`}>
          {label}{n ? ` · ${n}` : ""}
        </button>
      ))}
    </div>
  );
}

function DropZone({ onFiles }) {
  const [dragging, setDragging] = useState(false);
  const files = useRef(null);
  const folder = useRef(null);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={async (e) => { e.preventDefault(); setDragging(false); onFiles(await filesFromDrop(e.dataTransfer)); }}
      className={`grid place-items-center rounded-xl border-2 border-dashed px-6 py-10 text-center text-sm transition-colors ${dragging ? "border-accent bg-accent/5" : "border-line"}`}
    >
      <UploadIcon className="mb-2 h-7 w-7 text-muted" />
      <p className="font-medium">Drop audio files or whole album folders here</p>
      <p className="mt-1 text-xs text-muted">
        {AUDIO_EXTENSIONS.join(" ")} · large files resume automatically if the connection drops
      </p>
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn-secondary" onClick={() => files.current.click()}>Choose files</button>
        <button type="button" className="btn-ghost" onClick={() => folder.current.click()}>Choose folder</button>
      </div>
      <input ref={files} type="file" multiple accept={`${AUDIO_EXTENSIONS.join(",")},audio/*`} className="hidden"
        onChange={(e) => { onFiles([...e.target.files]); e.target.value = ""; }} />
      <input ref={folder} type="file" webkitdirectory="" className="hidden"
        onChange={(e) => { onFiles([...e.target.files]); e.target.value = ""; }} />
    </div>
  );
}

function Transfers() {
  const items = useTransfers();
  if (!items.length) return null;
  const finished = items.some((i) => ["done", "canceled"].includes(i.state));
  return (
    <section className="mt-5 rounded-xl border border-line bg-surface-1 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Transfers</h2>
        {finished && <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => uploads.clearFinished()}>Clear finished</button>}
      </div>
      <ul className="space-y-2.5">
        {items.map((i) => {
          const pct = i.size ? i.received / i.size : 0;
          const label = {
            queued: "Waiting", uploading: `${Math.round(pct * 100)}%`, retrying: `Reconnecting… ${Math.round(pct * 100)}%`,
            done: "Sent · checking", failed: i.error, canceled: "Canceled",
          }[i.state];
          return (
            <li key={i.key} className="text-xs">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{i.name}</span>
                <span className={`shrink-0 ${i.state === "failed" ? "text-danger" : "text-muted"}`}>{label}</span>
                <span className="shrink-0 text-muted">{formatSize(i.size)}</span>
                {i.state === "failed" && <button type="button" className="text-accent" onClick={() => uploads.retry(i.key)}>Retry</button>}
                {["queued", "uploading", "retrying", "failed"].includes(i.state) && (
                  <button type="button" aria-label={`Cancel ${i.name}`} className="text-muted hover:text-fg" onClick={() => uploads.cancel(i.key)}>
                    <CloseIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {["uploading", "retrying", "queued"].includes(i.state) && (
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3">
                  <div className={`h-full transition-[width] ${i.state === "retrying" ? "bg-gold" : "bg-accent"}`} style={{ width: `${pct * 100}%` }} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function Upload() {
  const { user } = useSession();
  const [status, setStatus] = useState("");
  const [publishNow, setPublishNow] = useState(false);
  const { data, load, replace } = useUploadList("mine", status);

  useEffect(() => {
    uploads.onFinished = load;
    return () => {
      uploads.onFinished = null;
    };
  }, [load]);

  if (!user.can_upload) return <p className="text-sm text-muted">You don't have upload access. Ask an admin for the uploader role.</p>;

  const add = (files) => {
    const audio = files.filter((f) => isAudioFile(f.name));
    const skipped = files.length - audio.length;
    if (skipped) toast(`Skipped ${plural(skipped, "file")} that aren't audio`);
    if (audio.length) uploads.add(audio, { publish: user.is_admin && publishNow });
  };

  return (
    <div className="max-w-4xl">
      <PageHeader title="Upload music"
        subtitle={user.is_admin ? "Every file is checked automatically before it goes live."
          : "Every file is checked automatically, then reviewed by an admin before it appears in the library."} />
      <DropZone onFiles={add} />
      {user.is_admin && (
        <label className="mt-3 flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={publishNow} onChange={(e) => setPublishNow(e.target.checked)} />
          Publish my uploads as soon as they pass the checks (likely duplicates still wait for review)
        </label>
      )}
      <Transfers />
      <h2 className="mb-3 mt-8 text-lg font-semibold tracking-tight">Your uploads</h2>
      <StatusTabs counts={data?.counts} value={status} onChange={setStatus}
        order={["invalid", "pending", "scheduled", "published", "declined"]} />
      {data && !data.uploads.length && <p className="py-6 text-sm text-muted">Nothing here yet.</p>}
      <ul className="divide-y divide-line">
        {(data?.uploads ?? []).map((u) => <UploadRow key={u.id} upload={u} admin={user.is_admin} onChange={replace} />)}
      </ul>
    </div>
  );
}
