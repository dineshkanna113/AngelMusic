import { useEffect, useState } from "react";
import { coverUrl } from "../lib/api";
import { offline } from "../lib/offline";
import { DiscIcon } from "./Icons";

/** Cover art for a track; falls back to the offline copy when the network fails. */
export default function Cover({ track, token, className = "h-10 w-10", eager = false, rounded = "rounded" }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    setSrc(track?.has_cover && token ? coverUrl(track.id, token) : null);
  }, [track?.id, track?.has_cover, token]);

  useEffect(() => {
    if (src || !track?.has_cover || !offline.has(track.id)) return;
    let url;
    offline.objectUrl(track.id, "cover").then((u) => {
      url = u;
      if (u) setSrc(u);
    });
    return () => url && URL.revokeObjectURL(url);
  }, [src, track?.id, track?.has_cover]);

  const onError = async () => {
    const local = !src?.startsWith("blob:") && track && (await offline.objectUrl(track.id, "cover").catch(() => null));
    if (local) setSrc(local);
    else setFailed(true);
  };

  return (
    <div className={`${className} ${rounded} grid shrink-0 place-items-center overflow-hidden bg-surface-2`}>
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          className="h-full w-full object-cover"
          onError={onError}
        />
      ) : (
        <DiscIcon className="h-1/2 w-1/2 text-muted" />
      )}
    </div>
  );
}
