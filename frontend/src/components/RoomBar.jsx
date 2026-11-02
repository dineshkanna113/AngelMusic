import { useRoom } from "../lib/rooms";
import { plural } from "../lib/format";
import { href, useRoute } from "../lib/router";
import { StickerLabel } from "./Stickers";

/** A strip above the player while you are in a room, so you can get back to it from anywhere. */
export default function RoomBar() {
  const room = useRoom();
  const { section } = useRoute();
  if (!["open", "connecting", "reconnecting"].includes(room.status) || section === "room") return null;
  return (
    <a href={href("room", room.code)} className="mx-3 mb-2 flex items-center justify-between gap-3 rounded-pill border-[3px] border-white bg-social px-4 py-2 text-sm text-ink shadow-sticker md:mx-auto md:max-w-2xl">
      <span className="flex min-w-0 items-center gap-2">
        <StickerLabel tone="ink" tilt={-3}>in a room</StickerLabel>
        <span className="truncate font-semibold">{room.room?.name ?? room.code}</span>
      </span>
      <span className="shrink-0 font-semibold tabular-nums">
        {room.status === "open" ? plural(room.members.length, "listener") : "Reconnecting…"}
      </span>
    </a>
  );
}
