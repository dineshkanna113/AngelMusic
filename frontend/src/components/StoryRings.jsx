import { player } from "../lib/player";
import { href } from "../lib/router";
import Avatar from "./Avatar";
import { canPlay } from "./TrackList";

/**
 * Friends as story rings (phones): live friends first with a bubblegum ring. Tap to play
 * what they're playing; if they have nothing playable, tap opens their profile.
 */
export default function StoryRings({ friends, className = "" }) {
  if (!friends?.length) return null;
  return (
    <ul className={`-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 ${className}`} aria-label="Friends listening">
      {friends.map(({ person, track, live }) => {
        const playable = track && canPlay(track.mime);
        const open = () => (playable ? player.playQueue([track], 0) : (window.location.hash = href("u", person.username).slice(1)));
        return (
          <li key={person.username} className="w-16 shrink-0 text-center">
            <button type="button" onClick={open} className="group block w-full"
              aria-label={playable ? `Play ${track.title}, ${person.display_name} is ${live ? "listening to it" : "last played it"}` : `${person.display_name}’s profile`}>
              <span className={`relative mx-auto block h-16 w-16 rounded-[22px] p-[3px] ${live ? "bg-social" : "bg-white"} shadow-sticker`}>
                <Avatar person={person} ring={false} sticker={false} className="h-full w-full rounded-[19px] text-lg" />
              </span>
              <span className="mt-1.5 block truncate text-xs font-semibold">{person.display_name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
