import { avatarSrc } from "../lib/social";

const FILLS = ["bg-accent", "bg-sky", "bg-peach", "bg-social"];

/** A person's picture, or their initial on a sticker colour. `sticker` draws it as a tilted tile. */
export default function Avatar({ person, className = "h-10 w-10 text-sm", ring = true, sticker = false }) {
  const fill = FILLS[[...(person?.username ?? "")].reduce((n, c) => n + c.charCodeAt(0), 0) % FILLS.length];
  const src = avatarSrc(person?.avatar_url);
  const initial = (person?.display_name || person?.username || "?").trim()[0]?.toUpperCase();
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden font-display font-bold text-ink ${fill} ${
      sticker ? "-rotate-6 rounded-[14px] border-[3px] border-white shadow-sticker" : "rounded-full"} ${
      ring && !sticker ? "ring-4 ring-white" : ""} ${className}`}>
      {src ? <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" /> : initial}
    </span>
  );
}
