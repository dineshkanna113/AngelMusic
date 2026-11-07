import { useEffect, useState } from "react";
import { StickerLabel } from "./Stickers";
import { API_BASE } from "../lib/api";
import { billingApi } from "../lib/billing";
import { useLibrary } from "../lib/library";

const TONES = ["bg-sky", "bg-peach", "bg-accent"];
const COLS = { 1: "md:grid-cols-1", 2: "md:grid-cols-2", 3: "md:grid-cols-3" };

/** Admin-written promos for Free users. The server sends none to Premium listeners. Clearly labelled. */
export default function Promos({ className = "" }) {
  const { offlineMode } = useLibrary();
  const [promos, setPromos] = useState([]);
  useEffect(() => {
    if (offlineMode) return;
    billingApi.promos().then(setPromos).catch(() => setPromos([]));
  }, [offlineMode]);
  if (offlineMode || !promos.length) return null;
  return (
    <ul className={`relative z-10 grid gap-4 ${COLS[Math.min(promos.length, 3)]} ${className}`} aria-label="Promotions">
      {promos.map((p, i) => {
        const external = p.link?.startsWith("https://");
        const Tag = p.link ? "a" : "div";
        return (
          <li key={p.id}>
            <Tag {...(p.link ? { href: p.link, ...(external ? { target: "_blank", rel: "noopener noreferrer" } : {}) } : {})}
              className={`flex h-full items-center gap-4 rounded-lg border-[4px] border-white p-4 shadow-sticker ${TONES[i % TONES.length]}`}>
              {p.image_url && <img src={`${API_BASE}${p.image_url}`} alt="" className="h-16 w-16 shrink-0 rounded-md object-cover" loading="lazy" />}
              <span className="min-w-0">
                <StickerLabel tone="ink" tilt={-3} className="!px-2 !py-0 text-[11px]">promo</StickerLabel>
                <span className="mt-1 block truncate font-display text-lg font-bold text-ink">{p.title}</span>
                {p.body && <span className="block text-sm text-ink/80">{p.body}</span>}
              </span>
            </Tag>
          </li>
        );
      })}
    </ul>
  );
}
