import { useMemo } from "react";
import { useSession } from "./hooks";
import { isHiRes } from "./format";
import { useLibrary } from "./library";

// Personal mixes built on the device from the user's own plays and favorites. Every track
// already carries this user's play_count / last_played / favorite, so no extra API is needed
// and mixes keep working offline. Mixes are seeded per user per day: stable all day, fresh tomorrow.

const DAY = 86_400_000;
const MIX_SIZE = 30;
const MIN_TRACKS = 3;

// SQLite timestamps are UTC without a zone ("2026-10-24 12:00:00"); client-side ones are ISO.
function parseTime(value) {
  if (!value) return 0;
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return Date.parse(iso) || 0;
}

function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  return () => {
    // mulberry32
    h = (h + 0x6d2b79f5) | 0;
    let x = Math.imul(h ^ (h >>> 15), 1 | h);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, rand) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Reorder so the same artist rarely plays twice in a row, keeping the original order otherwise. */
function spreadArtists(list) {
  const pool = [...list];
  const out = [];
  while (pool.length) {
    const recent = out.slice(-2).map((t) => t.artist_id);
    const i = pool.findIndex((t) => !recent.includes(t.artist_id));
    out.push(pool.splice(i === -1 ? 0 : i, 1)[0]);
  }
  return out;
}

/** How much this user likes a track: plays, favorites, and plays in the last 90 days count double. */
function affinity(t, now) {
  const base = t.play_count + (t.favorite ? 5 : 0);
  if (!base) return 0;
  const age = (now - parseTime(t.last_played)) / DAY;
  return base * (1 + Math.max(0, 1 - age / 90));
}

const genreKey = (t) => (t.genre || "").split(/[;,/]/)[0].trim();
const artistName = (t) => t.artist || t.album_artist || "Unknown artist";

function describe(tracks) {
  const counts = new Map();
  for (const t of tracks) counts.set(artistName(t), (counts.get(artistName(t)) ?? 0) + 1);
  const names = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${names.slice(0, 3).join(", ")} and more`;
}

/** Mostly tracks the user already likes, topped up with unplayed ones from the same pool. */
function blend(pool, scores, rand, size = MIX_SIZE) {
  const known = pool.filter((t) => scores.get(t.id) > 0)
    .map((t) => [t, scores.get(t.id) * (0.5 + rand())])
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);
  const fresh = shuffled(pool.filter((t) => !scores.get(t.id)), rand);
  const knownTake = Math.min(known.length, Math.max(Math.round(size * 0.6), size - fresh.length));
  const picked = [...known.slice(0, knownTake), ...fresh.slice(0, size - knownTake)];
  return spreadArtists(shuffled(picked, rand));
}

function mix(key, title, tracks, extra = {}) {
  return { key, title, subtitle: describe(tracks), tracks, ...extra };
}

/**
 * Build the user's mixes. `seed` should identify the user; the date is mixed in here.
 * Returns only mixes with enough tracks to be worth playing.
 */
export function buildMixes(tracks, seed, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const rand = rng(`${seed}|${day}`);
  const scores = new Map(tracks.map((t) => [t.id, affinity(t, now)]));
  const listened = tracks.some((t) => scores.get(t.id) > 0);
  const mixes = [];

  // Daily Mixes: one per taste cluster (genre, or artist when a track has no genre),
  // ranked by how much the user listens to that cluster — or by size for a new user.
  const clusters = new Map();
  for (const t of tracks) {
    const k = genreKey(t) ? `g:${genreKey(t).toLowerCase()}` : `a:${t.artist_id}`;
    const c = clusters.get(k) ?? { tracks: [], score: 0 };
    c.tracks.push(t);
    c.score += scores.get(t.id);
    clusters.set(k, c);
  }
  const minCluster = Math.max(MIN_TRACKS, Math.min(8, Math.floor(tracks.length / 10)));
  const ranked = [...clusters.values()]
    .filter((c) => c.tracks.length >= minCluster && (!listened || c.score > 0))
    .sort((a, b) => (listened ? b.score - a.score : b.tracks.length - a.tracks.length))
    .slice(0, 6);
  ranked.forEach((c, i) => {
    const list = blend(c.tracks, scores, rand);
    const genre = genreKey(c.tracks[0]);
    mixes.push(mix(`daily-${i + 1}`, `Daily Mix ${i + 1}`, list, { tag: genre || null, kind: "daily" }));
  });

  // On Repeat: what the user has played most in the last 30 days.
  const month = now - 30 * DAY;
  const onRepeat = tracks.filter((t) => t.play_count > 0 && parseTime(t.last_played) >= month)
    .sort((a, b) => b.play_count - a.play_count || parseTime(b.last_played) - parseTime(a.last_played))
    .slice(0, MIX_SIZE);
  mixes.push(mix("on-repeat", "On Repeat", onRepeat, { kind: "repeat", blurb: "Your most-played tracks this month" }));

  // Rediscover: favorites and former regulars that haven't been played for two months.
  const stale = now - 60 * DAY;
  const rediscover = shuffled(
    tracks.filter((t) => (t.favorite || t.play_count >= 3) && parseTime(t.last_played) < stale),
    rand,
  ).slice(0, MIX_SIZE);
  mixes.push(mix("rediscover", "Rediscover", spreadArtists(rediscover), {
    kind: "rediscover", blurb: "Favorites you haven't played in a while",
  }));

  // Discover: never-played tracks, leaning towards artists and genres the user already likes,
  // with recently added music nudged up.
  const artistScore = new Map();
  const genreScore = new Map();
  for (const t of tracks) {
    artistScore.set(t.artist_id, (artistScore.get(t.artist_id) ?? 0) + scores.get(t.id));
    const g = genreKey(t).toLowerCase();
    if (g) genreScore.set(g, (genreScore.get(g) ?? 0) + scores.get(t.id));
  }
  const newest = Math.max(0, ...tracks.map((t) => parseTime(t.added_at)));
  const discover = tracks.filter((t) => !t.play_count)
    .map((t) => {
      const fit = (artistScore.get(t.artist_id) ?? 0) * 2 + (genreScore.get(genreKey(t).toLowerCase()) ?? 0);
      const fresh = newest - parseTime(t.added_at) < 14 * DAY ? 1 : 0;
      return [t, Math.log1p(fit) + fresh + rand() * 1.5];
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, MIX_SIZE)
    .map(([t]) => t);
  mixes.push(mix("discover", "Discover", spreadArtists(discover), {
    kind: "discover", blurb: "Unplayed music picked for your taste",
  }));

  // Hi-Res: the best-sounding files in the library, weighted towards what the user likes.
  const hires = tracks.filter(isHiRes);
  mixes.push(mix("hi-res", "Hi-Res Mix", blend(hires, scores, rand), {
    kind: "hires", blurb: "24-bit and high sample rate masters",
  }));

  // Decade mix for the era the user listens to most.
  const decades = new Map();
  for (const t of tracks) {
    const y = parseInt(t.year, 10);
    if (y >= 1900 && y <= 2100) {
      const d = Math.floor(y / 10) * 10;
      const entry = decades.get(d) ?? { tracks: [], score: 0 };
      entry.tracks.push(t);
      entry.score += scores.get(t.id) + 0.01;
      decades.set(d, entry);
    }
  }
  const [topDecade] = [...decades.entries()].sort((a, b) => b[1].score - a[1].score);
  if (topDecade && decades.size > 1) {
    const [d, entry] = topDecade;
    mixes.push(mix(`decade-${d}`, `Your ${d}s`, blend(entry.tracks, scores, rand), { kind: "decade" }));
  }

  return mixes.filter((m) => m.tracks.length >= MIN_TRACKS);
}

/**
 * Track radio: an endless-feeling queue seeded from one track — same artist, same genre,
 * similar era — with the user's favorites in those pools nudged up. Seed track plays first.
 */
export function buildRadio(seedTrack, allTracks, size = 50) {
  const now = Date.now();
  const rand = Math.random;
  const g = genreKey(seedTrack).toLowerCase();
  const year = parseInt(seedTrack.year, 10);
  const candidates = allTracks
    .filter((t) => t.id !== seedTrack.id)
    .map((t) => {
      let s = 0;
      if (t.artist_id === seedTrack.artist_id) s += 3;
      if (g && genreKey(t).toLowerCase() === g) s += 2;
      const y = parseInt(t.year, 10);
      if (year && y && Math.abs(y - year) <= 5) s += 1;
      if (t.album_id === seedTrack.album_id) s -= 1; // don't turn radio into the album
      return [t, s + Math.log1p(affinity(t, now)) * 0.5 + rand() * 1.5];
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, size - 1)
    .map(([t]) => t);
  return [seedTrack, ...spreadArtists(shuffled(candidates, rand))];
}

const NONE = [];
let cache = { key: "", mixes: NONE };

/**
 * The signed-in user's mixes. Rebuilt when the day, the user or the library size changes —
 * not on every play, so a mix doesn't reshuffle under you while it's playing.
 */
export function useMixes() {
  const { tracks, byId } = useLibrary();
  const session = useSession();
  const key = `${session?.user?.id}|${new Date().toISOString().slice(0, 10)}|${tracks?.length ?? 0}`;
  if (tracks?.length && cache.key !== key) {
    cache = {
      key,
      mixes: buildMixes(tracks, String(session?.user?.id)).map(({ tracks: list, ...m }) => ({ ...m, ids: list.map((t) => t.id) })),
    };
  }
  const mixes = tracks?.length ? cache.mixes : NONE;
  // Resolve ids against the live library so favorite hearts etc. stay current.
  return useMemo(
    () => mixes.map((m) => ({ ...m, tracks: m.ids.map((id) => byId.get(id)).filter(Boolean) })),
    [mixes, byId],
  );
}
