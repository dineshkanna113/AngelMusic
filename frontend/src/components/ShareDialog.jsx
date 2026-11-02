import { useEffect, useState } from "react";
import { renderShareCard } from "../lib/sharecard";
import { toast, toastError } from "../lib/toast";
import { Modal, mount } from "./Dialog";

const linkFor = (track) => `${window.location.origin}${window.location.pathname}#/album/${track.album_id}`;

function ShareDialog({ track, onDone }) {
  const [blob, setBlob] = useState(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let url;
    const ambient = document.documentElement.style.getPropertyValue("--ambient").trim() || undefined; // set only when the cover has colour
    renderShareCard(track, ambient).then((b) => {
      setBlob(b);
      url = URL.createObjectURL(b);
      setPreview(url);
    }).catch(toastError);
    return () => url && URL.revokeObjectURL(url);
  }, [track]);

  const file = blob && new File([blob], `yaapu-${track.title.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}.png`, { type: "image/png" });
  const canShareFile = file && navigator.canShare?.({ files: [file] });

  const share = async () => {
    try {
      await navigator.share({ files: [file], title: track.title, text: `${track.title} by ${track.artist} on Yaapu`, url: linkFor(track) });
      onDone();
    } catch (err) {
      if (err.name !== "AbortError") toastError(err);
    }
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = preview;
    a.download = file.name;
    a.click();
  };
  const copy = () => navigator.clipboard?.writeText(linkFor(track)).then(() => toast("Link copied")).catch(toastError);

  return (
    <Modal title={`Share ${track.title}`} onClose={() => onDone()}>
      <div className="grid gap-4">
        <div className="mx-auto aspect-[9/16] w-48 overflow-hidden rounded-md bg-surface-2">
          {preview ? <img src={preview} alt="Story card preview" className="h-full w-full object-cover" />
            : <p className="grid h-full place-items-center text-xs text-muted">Making your card…</p>}
        </div>
        <div className="grid gap-2">
          {canShareFile && <button type="button" className="btn-primary" onClick={share}>Share</button>}
          <button type="button" className={canShareFile ? "btn-secondary" : "btn-primary"} disabled={!blob} onClick={download}>
            Download image
          </button>
          <button type="button" className="btn-ghost justify-center" onClick={copy}>Copy link</button>
        </div>
      </div>
    </Modal>
  );
}

export const shareTrack = (track) => mount((done) => <ShareDialog track={track} onDone={done} />);
