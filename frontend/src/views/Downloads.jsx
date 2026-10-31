import { useEffect, useMemo, useState } from "react";
import CollectionActions from "../components/CollectionActions";
import { confirmDialog } from "../components/Dialog";
import { PageHeader } from "../components/Grid";
import TrackList from "../components/TrackList";
import { formatSize, plural } from "../lib/format";
import { useOffline } from "../lib/library";
import { offline, offlineSupported } from "../lib/offline";

export default function Downloads() {
  const { ids, progress } = useOffline();
  const [usage, setUsage] = useState(null);
  const tracks = useMemo(() => offline.tracks().filter((t) => ids.has(t.id)), [ids]);
  const pending = Object.keys(progress).length;

  useEffect(() => {
    offline.usage().then(setUsage).catch(() => {});
  }, [ids]);

  if (!offlineSupported) {
    return (
      <>
        <PageHeader title="Downloads" />
        <p className="text-sm text-muted">Offline storage needs HTTPS (or localhost) and a browser with Cache Storage.</p>
      </>
    );
  }

  const clear = async () => {
    if (await confirmDialog({ title: "Remove all offline copies?", message: "Tracks stay in your library; only the copies on this device are deleted.", confirmLabel: "Remove all" })) {
      offline.clear();
    }
  };

  return (
    <>
      <PageHeader
        title="Downloads"
        subtitle={`${plural(tracks.length, "track")} on this device${usage ? ` · ${formatSize(usage.saved)}` : ""}${
          usage?.quota ? ` · ${formatSize(usage.quota - (usage.used ?? 0))} free` : ""}${pending ? ` · ${pending} downloading` : ""}`}
      >
        {tracks.length > 0 && <button type="button" className="btn-ghost" onClick={clear}>Remove all</button>}
      </PageHeader>
      <p className="mb-4 max-w-2xl text-sm text-muted">
        Saved tracks are stored as the original lossless files and play without a connection. Use “Save for offline”
        on any track, album or playlist.
      </p>
      {tracks.length > 0 && <div className="mb-4"><CollectionActions tracks={tracks} /></div>}
      <TrackList tracks={tracks} emptyText="Nothing saved for offline yet." />
    </>
  );
}
