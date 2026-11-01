import { useCallback, useEffect, useState } from "react";
import Avatar from "../components/Avatar";
import Cover from "../components/Cover";
import FollowButton from "../components/FollowButton";
import Meta from "../components/Meta";
import { formatTime, plural } from "../lib/format";
import { useStreamTokenValue } from "../lib/hooks";
import { useLibrary } from "../lib/library";
import { href } from "../lib/router";
import { social } from "../lib/social";

/** A row of people with follow buttons (followers, following, search results). */
export function PeopleList({ people, empty = "No one here yet." }) {
  if (!people?.length) return <p className="py-6 text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {people.map((p) => (
        <li key={p.username} className="flex items-center gap-3 py-3">
          <a href={href("u", p.username)} className="flex min-w-0 flex-1 items-center gap-3">
            <Avatar person={p} className="h-11 w-11 text-sm" />
            <span className="min-w-0">
              <span className="block truncate font-semibold">{p.display_name}</span>
              <span className="block truncate text-sm text-muted">
                @{p.username}{p.follows_you ? <span className="ml-2 text-social">Follows you</span> : null}
              </span>
            </span>
          </a>
          <FollowButton following={p.is_following} onToggle={(on) => social.follow(p.username, on)} className="h-9 px-4" />
        </li>
      ))}
    </ul>
  );
}

function PlaylistGrid({ playlists }) {
  const { byId } = useLibrary();
  const token = useStreamTokenValue();
  if (!playlists.length) return <p className="py-6 text-sm text-muted">No public playlists yet.</p>;
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {playlists.map((pl) => (
        <li key={pl.id} className="min-w-0">
          <a href={href("playlist", pl.id)} className="block">
            <Cover track={pl.cover_track_id ? byId.get(pl.cover_track_id) : null} token={token}
              className="aspect-square w-full" rounded="rounded-md" />
            <p className="mt-2 truncate text-sm font-semibold">{pl.name}</p>
            <Meta className="text-xs text-muted" parts={[plural(pl.track_count, "track"), formatTime(pl.duration)]} />
          </a>
        </li>
      ))}
    </ul>
  );
}

const TABS = [["playlists", "Playlists"], ["followers", "Followers"], ["following", "Following"]];

export default function Profile({ username }) {
  const [prof, setProf] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("playlists");
  const [people, setPeople] = useState(null);

  const load = useCallback(() => {
    setError("");
    social.profile(username).then(setProf).catch((err) => setError(err.message));
  }, [username]);
  useEffect(() => {
    load();
    setTab("playlists");
  }, [load]);
  useEffect(() => {
    setPeople(null);
    if (tab === "followers") social.followers(username).then(setPeople).catch(() => setPeople([]));
    if (tab === "following") social.following(username).then(setPeople).catch(() => setPeople([]));
  }, [tab, username]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!prof) return <p className="text-sm text-muted">Loading…</p>;
  const hidden = prof.top_artists === null;

  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-col gap-6 border-b border-line pb-8 sm:flex-row sm:items-end">
        <Avatar person={prof} className="h-32 w-32 text-5xl sm:h-40 sm:w-40" />
        <div className="min-w-0 flex-1">
          <h1 className="title-display text-[clamp(2.5rem,7vw,4.5rem)] leading-none">{prof.display_name}</h1>
          <p className="mt-2 text-muted">
            @{prof.username}{prof.follows_you && <span className="ml-3 text-social">Follows you</span>}
          </p>
          {prof.bio && <p className="mt-3 max-w-xl text-fg-2">{prof.bio}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-5 text-sm">
            <button type="button" className="hover:underline" onClick={() => setTab("followers")}>
              <span className="font-semibold tabular-nums text-fg">{prof.followers}</span> <span className="text-muted">followers</span>
            </button>
            <button type="button" className="hover:underline" onClick={() => setTab("following")}>
              <span className="font-semibold tabular-nums text-fg">{prof.following}</span> <span className="text-muted">following</span>
            </button>
          </div>
        </div>
        <div className="shrink-0">
          {prof.is_self
            ? <a className="btn-secondary" href={href("settings")}>Edit profile</a>
            : <FollowButton following={prof.is_following} onToggle={(on) => social.follow(prof.username, on)} onChange={load} />}
        </div>
      </header>

      {hidden ? (
        <p className="py-10 text-center text-muted">
          {prof.display_name}’s listening is private. Once you follow each other, you’ll see it here.
        </p>
      ) : (
        prof.top_artists.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-xl">On repeat this month</h2>
            <ul className="flex flex-wrap gap-2">
              {prof.top_artists.map((a) => (
                <li key={a.id}>
                  <a href={href("artist", a.id)} className="btn-secondary h-9 px-4">{a.name}</a>
                </li>
              ))}
            </ul>
          </section>
        )
      )}

      <div role="tablist" className="mt-10 flex gap-1 border-b border-line">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold ${
              tab === key ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="pt-6">
        {tab === "playlists" && (hidden ? <p className="py-6 text-sm text-muted">Playlists are private.</p> : <PlaylistGrid playlists={prof.playlists} />)}
        {tab !== "playlists" && (people ? <PeopleList people={people} /> : <p className="py-6 text-sm text-muted">Loading…</p>)}
      </div>
    </div>
  );
}
