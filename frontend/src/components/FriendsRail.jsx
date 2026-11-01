import { useEffect, useState } from "react";
import { timeAgo } from "../lib/format";
import { useStreamTokenValue } from "../lib/hooks";
import { player } from "../lib/player";
import { href } from "../lib/router";
import { social } from "../lib/social";
import Avatar from "./Avatar";
import Cover from "./Cover";
import { canPlay } from "./TrackList";

const POLL_MS = 20_000;

/** Friends' listening, refreshed while the page is visible. Null until the first load. */
export function useActivity() {
  const [friends, setFriends] = useState(null);
  useEffect(() => {
    let timer;
    const load = () => {
      if (document.visibilityState === "visible") social.activity().then(setFriends).catch(() => {});
      timer = setTimeout(load, POLL_MS);
    };
    load();
    const onVisible = () => document.visibilityState === "visible" && social.activity().then(setFriends).catch(() => {});
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return friends;
}

/** Focus the search box; people show up in search results. */
export const findPeople = () => document.getElementById("global-search")?.focus();

export function FriendsList({ friends }) {
  const token = useStreamTokenValue();
  if (!friends) return <p className="px-1 py-4 text-sm text-muted">Loading…</p>;
  if (!friends.length) {
    return (
      <div className="px-1 py-4 text-sm text-muted">
        <p>Follow friends to see what they’re playing.</p>
        <button type="button" className="btn-social mt-4 h-9 px-4" onClick={findPeople}>Find people</button>
      </div>
    );
  }
  return (
    <ul className="grid gap-1">
      {friends.map(({ person, track, live, at }) => (
        <li key={person.username} className="flex items-center gap-3 rounded-md px-1 py-2 hover:bg-surface-2/60">
          <a href={href("u", person.username)} className="relative shrink-0" aria-label={`${person.display_name}’s profile`}>
            <Avatar person={person} className="h-11 w-11 text-sm" ring={false} />
            {live && <span className="live-dot absolute -bottom-0.5 -right-0.5" aria-hidden="true" />}
          </a>
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline justify-between gap-2">
              <a href={href("u", person.username)} className="truncate text-sm font-semibold hover:underline">{person.display_name}</a>
              <span className={`shrink-0 text-xs ${live ? "text-social" : "text-muted"}`}>{live ? "Listening" : at ? timeAgo(at) : ""}</span>
            </p>
            {track ? (
              <button type="button" disabled={!canPlay(track.mime)} onClick={() => player.playQueue([track], 0)}
                className="flex w-full min-w-0 items-center gap-2 text-left text-xs text-muted hover:text-fg"
                aria-label={`Play ${track.title} by ${track.artist}`}>
                <Cover track={track} token={token} className="h-6 w-6" rounded="rounded-sm" />
                <span className="truncate"><span className="text-fg-2">{track.title}</span>, {track.artist}</span>
              </button>
            ) : (
              <p className="text-xs text-muted">Nothing played yet</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Desktop right rail (wide screens only); phones use the Friends page. */
export default function FriendsRail() {
  const friends = useActivity();
  return (
    <aside aria-label="Friend activity" className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface-1 px-4 pb-4 pt-6 xl:flex">
      <h2 className="mb-4 px-1 text-xl">Friends</h2>
      <FriendsList friends={friends} />
    </aside>
  );
}
