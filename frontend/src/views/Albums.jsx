import { useEffect, useMemo, useState } from "react";
import { manageAccess } from "../components/AccessDialog";
import Avatar from "../components/Avatar";
import CollectionActions from "../components/CollectionActions";
import DropCard from "../components/DropCard";
import { growth } from "../lib/growth";
import FollowButton from "../components/FollowButton";
import Meta from "../components/Meta";
import Cover from "../components/Cover";
import { editBio } from "../components/BioDialog";
import { AlbumGrid, ArtistGrid, PageHeader, Section, Select } from "../components/Grid";
import { Artifact } from "../components/Stickers";
import TrackList from "../components/TrackList";
import { formatResolution, formatTime, headingSize, plural } from "../lib/format";
import { useSession, useStreamTokenValue } from "../lib/hooks";
import { useLibrary } from "../lib/library";
import { href } from "../lib/router";
import { api } from "../lib/api";
import { social } from "../lib/social";
import { toast, toastError } from "../lib/toast";

const ALBUM_SORTS = {
  artist: null,
  name: (a, b) => a.name.localeCompare(b.name),
  year: (a, b) => (b.year || "").localeCompare(a.year || ""),
  added: (a, b) => (b.added_at || "").localeCompare(a.added_at || ""),
  plays: (a, b) => b.play_count - a.play_count,
};

export function Albums() {
  const { albums } = useLibrary();
  const [sort, setSort] = useState("artist");
  const list = useMemo(() => (ALBUM_SORTS[sort] ? [...albums].sort(ALBUM_SORTS[sort]) : albums), [albums, sort]);
  return (
    <>
      <PageHeader title="Albums" subtitle={`${albums.length} albums`}>
        <Select label="Sort" value={sort} onChange={setSort}
          options={[["artist", "Artist"], ["name", "Title"], ["year", "Year"], ["added", "Recently added"], ["plays", "Most played"]]} />
      </PageHeader>
      <AlbumGrid albums={list} />
    </>
  );
}

export function Artists() {
  const { artists } = useLibrary();
  return (
    <>
      <PageHeader title="Artists" subtitle={`${artists.length} artists`} />
      <ArtistGrid artists={artists} />
    </>
  );
}

function qualitySummary(tracks) {
  const res = [...new Set(tracks.map(formatResolution))];
  const codecs = [...new Set(tracks.map((t) => t.codec.toUpperCase()))];
  return [codecs.join(" and "), res.length === 1 ? res[0] : "mixed resolution"];
}

export function AlbumView({ id }) {
  const { albums, tracks } = useLibrary();
  const token = useStreamTokenValue();
  const album = albums.find((a) => a.id === id);
  if (!album) return <p className="text-sm text-muted">{tracks === null ? "Loading…" : "Album not found."}</p>;
  const discs = new Set(album.tracks.map((t) => t.disc_no ?? 1));

  return (
    <>
      <div className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-end">
        <Cover track={album.cover} token={token} className="aspect-square w-48 sm:w-56" rounded="rounded-lg" eager />
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted">Album</p>
          <h1 className="font-display mt-1 text-3xl">{album.name}</h1>
          <Meta className="mt-2 text-sm text-muted" parts={[
            <a key="a" className="font-medium text-fg hover:underline" href={href("artist", album.artist_id)}>{album.artist}</a>,
            album.year, plural(album.tracks.length, "track"), formatTime(album.duration),
          ]} />
          <Meta className={`mt-1 text-xs tabular-nums ${album.hires ? "font-bold text-social-ink" : "text-fg-2"}`} parts={qualitySummary(album.tracks)} />
          <div className="mt-4"><CollectionActions tracks={album.tracks} /></div>
        </div>
      </div>
      {[...discs].sort().map((disc) => (
        <div key={disc}>
          {discs.size > 1 && <h3 className="mb-1 mt-4 px-2 text-xs font-medium text-muted">Disc {disc}</h3>}
          <TrackList tracks={album.tracks.filter((t) => (t.disc_no ?? 1) === disc)} numbering="track" showAlbum={false} showCover={false} />
        </div>
      ))}
    </>
  );
}

export function ArtistView({ id }) {
  const { artists, tracks } = useLibrary();
  const token = useStreamTokenValue();
  const isAdmin = useSession()?.user?.is_admin;
  const artist = artists.find((a) => a.id === id);
  // Bio, follower count and all-listener top tracks come from the server; the albums and
  // everything playable come from the library the app already holds, so offline still works.
  const [info, setInfo] = useState(null);
  useEffect(() => {
    setInfo(null);
    api(`/api/artists/${id}`).then(setInfo).catch(() => setInfo(null));
  }, [id]);
  const [nextDrop, setNextDrop] = useState(null);
  useEffect(() => {
    setNextDrop(null);
    growth.drops(id).then((list) => setNextDrop(list.find((d) => d.status !== "out") ?? null)).catch(() => setNextDrop(null));
  }, [id]);
  const all = useMemo(() => artist?.albums.flatMap((a) => a.tracks) ?? [], [artist]);
  const discography = useMemo(
    () => [...(artist?.albums ?? [])].sort((a, b) => (b.year || "").localeCompare(a.year || "") || a.name.localeCompare(b.name)),
    [artist],
  );
  if (!artist) return <p className="text-sm text-muted">{tracks === null ? "Loading…" : "Artist not found."}</p>;

  const popular = info?.top_tracks ?? [];
  const editBioClick = async () => {
    const bio = await editBio(artist.name, info?.bio ?? "");
    if (bio === null) return;
    try {
      setInfo(await api(`/api/artists/${id}/bio`, { method: "PUT", body: { bio } }));
      toast(bio ? "Bio saved" : "Bio removed");
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <div className="relative z-10">
      <header className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end">
        <div className="cover-sticker w-44 shrink-0 sm:w-56" style={{ "--tilt": "-3deg" }}>
          <Cover track={artist.cover} token={token} className="aspect-square w-full" rounded="" eager />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className={`chrome break-words pb-2 leading-[1.1] ${headingSize(artist.name)}`}>{artist.name}</h1>
          <Meta className="mt-1 text-sm text-muted" parts={[
            info && plural(info.followers, "follower"),
            plural(artist.albums.length, "album"),
            plural(artist.track_count, "track"),
          ]} />
          {info?.bio && <p className="mt-3 max-w-2xl whitespace-pre-line text-fg-2">{info.bio}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <CollectionActions tracks={all} />
            {info && (
              <FollowButton key={`${artist.id}-${info.following}`} following={info.following}
                onToggle={(on) => social.followArtist(artist.id, on)} className="h-9 px-4"
                onChange={(on) => setInfo((cur) => cur && { ...cur, following: on, followers: Math.max(0, cur.followers + (on ? 1 : -1)) })} />
            )}
            {info?.can_manage && (
              <button type="button" className="btn-ghost" onClick={editBioClick}>{info.bio ? "Edit bio" : "Add a bio"}</button>
            )}
            {info?.can_manage && <a className="btn-ghost" href={href("studio")}>Studio</a>}
            {isAdmin && info && (
              <button type="button" className="btn-ghost" onClick={() => manageAccess({ id: artist.id, name: artist.name })}>Manage access</button>
            )}
          </div>
        </div>
      </header>
      {nextDrop && (
        <Section title="Dropping soon" art={<Artifact kind="cassette" size={38} tilt={-8} />}>
          <div className="px-2"><DropCard drop={nextDrop} /></div>
        </Section>
      )}
      {popular.length > 0 && (
        <Section title="Popular" art={<Artifact kind="drum" size={38} tilt={10} />}>
          <TrackList tracks={popular} />
        </Section>
      )}
      {info?.top_fans?.length > 0 && (
        <Section title="Top fans" art={<Artifact kind="sparkle" size={34} tilt={-8} />}>
          <ul className="flex flex-wrap gap-4">
            {info.top_fans.map((f) => (
              <li key={f.person.id}>
                <a href={href("u", f.person.username)} className="flex items-center gap-3 rounded-pill bg-surface-1/80 py-1.5 pl-1.5 pr-4 shadow-sticker">
                  <Avatar person={f.person} className="h-9 w-9 text-sm" ring={false} />
                  <span className="text-sm"><span className="block font-semibold">{f.person.display_name}</span>
                    <span className="block text-xs text-muted">{plural(f.plays, "play")}</span></span>
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Discography" art={<Artifact kind="vinyl" size={40} tilt={-10} />}>
        <AlbumGrid albums={discography} />
      </Section>
    </div>
  );
}

export function Favorites() {
  const { tracks } = useLibrary();
  const favs = useMemo(
    () => (tracks ?? []).filter((t) => t.favorite).sort((a, b) => (b.starred_at || "").localeCompare(a.starred_at || "")),
    [tracks],
  );
  return (
    <>
      <PageHeader title="Favorites" subtitle={[plural(favs.length, "track"), "no limit"]} />
      <div className="mb-4"><CollectionActions tracks={favs} /></div>
      <TrackList tracks={favs} emptyText="Tap the heart on any track to save it here." />
    </>
  );
}
