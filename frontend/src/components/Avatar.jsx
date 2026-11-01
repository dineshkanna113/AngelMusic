import { avatarSrc } from "../lib/social";

/** A person's picture, or their initial on dusk. The kingfisher ring marks people. */
export default function Avatar({ person, className = "h-10 w-10 text-sm", ring = true }) {
  const src = avatarSrc(person?.avatar_url);
  const initial = (person?.display_name || person?.username || "?").trim()[0]?.toUpperCase();
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-surface-2 font-semibold ${
      ring ? "ring-2 ring-social/70" : ""} ${className}`}>
      {src ? <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" /> : initial}
    </span>
  );
}
