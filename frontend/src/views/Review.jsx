import { useState } from "react";
import { PageHeader } from "../components/Grid";
import UploadRow, { approveUpload, hasErrors } from "../components/UploadItem";
import { plural } from "../lib/format";
import { useSession } from "../lib/hooks";
import { library } from "../lib/library";
import { toast, toastError } from "../lib/toast";
import { StatusTabs, useUploadList } from "./Upload";

export default function Review() {
  const { user } = useSession();
  const [status, setStatus] = useState("pending");
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const { data, load, replace } = useUploadList("all", status);

  if (!user.is_admin) return <p className="text-sm text-muted">Only admins can review uploads.</p>;

  const list = data?.uploads ?? [];
  const ready = list.filter((u) => u.status === "pending" && !hasErrors(u));
  const toggle = (id, on) => setSelected((s) => {
    const next = new Set(s);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });

  const publishSelected = async () => {
    setBusy(true);
    let ok = 0;
    for (const u of ready.filter((x) => selected.has(x.id))) {
      try {
        await approveUpload(u);
        ok++;
      } catch (err) {
        toastError(err);
      }
    }
    setBusy(false);
    setSelected(new Set());
    if (ok) {
      toast(`Published ${plural(ok, "track")}`);
      library.load();
    }
    load();
  };

  return (
    <div className="max-w-5xl">
      <PageHeader title="Review uploads"
        subtitle="Listen, fix tags, then publish now or schedule a release date. Files with errors can only be declined or deleted.">
        {ready.length > 0 && (
          <>
            <button type="button" className="btn-ghost text-xs"
              onClick={() => setSelected(selected.size === ready.length ? new Set() : new Set(ready.map((u) => u.id)))}>
              {selected.size === ready.length ? "Select none" : `Select all ready (${ready.length})`}
            </button>
            <button type="button" className="btn-primary" disabled={!selected.size || busy} onClick={publishSelected}>
              {busy ? "Publishing…" : `Publish ${selected.size || ""}`}
            </button>
          </>
        )}
      </PageHeader>
      <StatusTabs counts={data?.counts} value={status} onChange={(s) => { setStatus(s); setSelected(new Set()); }}
        order={["pending", "invalid", "scheduled", "published", "declined", "removed"]} />
      {data && !list.length && (
        <p className="py-6 text-sm text-muted">{status === "pending" ? "All caught up: nothing is waiting for review." : "Nothing here."}</p>
      )}
      <ul className="divide-y divide-line">
        {list.map((u) => (
          <UploadRow key={u.id} upload={u} admin onChange={replace}
            selected={selected.has(u.id)} onSelect={status === "pending" || status === "" ? (on) => toggle(u.id, on) : undefined} />
        ))}
      </ul>
    </div>
  );
}
