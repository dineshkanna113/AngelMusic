// Browse helpers: genres, moods and languages are computed from the tracks the app already
// holds (the library list), so they work offline and need no extra requests.

const SPLIT = /[;,/]/;

/**
 * Group tracks by a tag field. Multi-value tags ("Rock; Pop") count under their first value;
 * grouping ignores case and the group's label is its most common spelling. Untagged tracks
 * are skipped. Biggest groups first, ties alphabetical.
 */
export function groupBy(tracks, field) {
  const groups = new Map();
  for (const t of tracks) {
    const raw = (t[field] ?? "").split(SPLIT)[0].trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    let g = groups.get(key);
    if (!g) {
      g = { key, count: 0, cover: null, tracks: [], spellings: new Map() };
      groups.set(key, g);
    }
    g.tracks.push(t);
    g.count += 1;
    g.cover ??= t.has_cover ? t : null;
    g.spellings.set(raw, (g.spellings.get(raw) ?? 0) + 1);
  }
  return [...groups.values()]
    .map(({ spellings, ...g }) => ({
      ...g,
      label: [...spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** The most recently added albums first; the input is left untouched. */
export const newReleases = (albums, n = 10) =>
  [...albums].sort((a, b) => (b.added_at || "").localeCompare(a.added_at || "")).slice(0, n);
