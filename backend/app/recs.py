"""Recommendations from listening data. No model and no personal data leaves the server:

1. Listeners like you: item-to-item collaborative filtering. A track you have not heard is scored by how
   often people who share your songs also play it (cosine over listeners). A track needs at least
   MIN_SUPPORT distinct co-listeners, so one person's taste is never exposed.
2. Taste: unheard tracks that share an artist, genre, mood or language with what you play.
3. Popular: only when you have no history yet; the most played tracks of the last 30 days.

Everything is computed from the `plays` and `favorites` tables. The whole engagement table is read into
memory, which is fine for a community-sized catalogue; at public scale this moves to a scheduled job."""

import math
from collections import Counter, defaultdict

MIN_SUPPORT = 2
FAVORITE_WEIGHT = 3.0
POPULAR_DAYS = 30


def _engagement(conn):
    """{user_id: {track_id: weight}} over existing tracks: plays (diminishing) plus favorites."""
    users: dict[int, dict[str, float]] = defaultdict(dict)
    for r in conn.execute(
        "SELECT p.user_id, p.track_id, COUNT(*) AS n FROM plays p JOIN tracks t ON t.id = p.track_id GROUP BY p.user_id, p.track_id"
    ):
        users[r["user_id"]][r["track_id"]] = 1.0 + 0.2 * min(r["n"] - 1, 4)
    for r in conn.execute("SELECT f.user_id, f.track_id FROM favorites f JOIN tracks t ON t.id = f.track_id"):
        users[r["user_id"]][r["track_id"]] = users[r["user_id"]].get(r["track_id"], 1.0) + FAVORITE_WEIGHT
    return users


def _listeners_like_you(me: dict[str, float], others: dict[int, dict[str, float]]):
    """[(track_id, score, seed_track_id)] best first. `seed` is the track of yours that contributed most."""
    listeners = Counter(t for tracks in others.values() for t in tracks)
    score: dict[str, float] = defaultdict(float)
    support: dict[str, int] = defaultdict(int)
    seeds: dict[str, Counter] = defaultdict(Counter)
    for tracks in others.values():
        overlap = [t for t in tracks if t in me]
        if not overlap:
            continue
        for j in tracks:
            if j in me:
                continue
            support[j] += 1
            for i in overlap:
                contribution = me[i] / math.sqrt(listeners[i] * listeners[j])
                score[j] += contribution
                seeds[j][i] += contribution
    ranked = [(j, s, seeds[j].most_common(1)[0][0]) for j, s in score.items() if support[j] >= MIN_SUPPORT]
    return sorted(ranked, key=lambda x: (-x[1], x[0]))


def _taste(conn, me: dict[str, float]):
    """[(track_id, score, label)] unheard tracks matching the artists, genres, moods and languages you play."""
    if not me:
        return []
    marks = ", ".join("?" * len(me))
    heard = conn.execute(
        f"SELECT id, artist_id, album_artist, artist, genre, mood, language FROM tracks WHERE id IN ({marks})", list(me)
    ).fetchall()
    weight = {"artist_id": Counter(), "genre": Counter(), "mood": Counter(), "language": Counter()}
    names = {}
    for t in heard:
        w = me[t["id"]]
        names[t["artist_id"]] = t["album_artist"] or t["artist"]
        for col in weight:
            if t[col]:
                weight[col][t[col]] += w
    total = sum(me.values()) or 1.0
    out = []
    for t in conn.execute("SELECT id, artist_id, genre, mood, language FROM tracks").fetchall():
        if t["id"] in me:
            continue
        best, label, score = 0.0, "", 0.0
        for col, factor in (("artist_id", 3.0), ("genre", 1.0), ("mood", 1.0), ("language", 1.0)):
            value = t[col]
            if value and value in weight[col]:
                part = factor * weight[col][value] / total
                score += part
                if part > best:
                    best, label = part, names[value] if col == "artist_id" else value
        if score > 0:
            out.append((t["id"], score, label))
    return sorted(out, key=lambda x: (-x[1], x[0]))


def _popular(conn, exclude: set[str]):
    rows = conn.execute(
        """SELECT p.track_id, COUNT(*) AS n, MAX(p.id) AS last FROM plays p JOIN tracks t ON t.id = p.track_id
           WHERE p.played_at >= datetime('now', ?) GROUP BY p.track_id ORDER BY n DESC, last DESC""",
        (f"-{POPULAR_DAYS} days",),
    ).fetchall()
    return [r["track_id"] for r in rows if r["track_id"] not in exclude]


def discover(conn, user_id: int, limit: int) -> list[tuple[str, dict]]:
    """[(track_id, reason)] of tracks the user has not played or favorited, best first."""
    engagement = _engagement(conn)
    me = engagement.pop(user_id, {})
    title = lambda tid: (conn.execute("SELECT title FROM tracks WHERE id = ?", (tid,)).fetchone() or {"title": ""})["title"]

    picks: list[tuple[str, dict]] = []
    seen = set(me)

    def add(track_id: str, reason: dict) -> None:
        if track_id not in seen and len(picks) < limit:
            seen.add(track_id)
            picks.append((track_id, reason))

    for track_id, _score, seed in _listeners_like_you(me, engagement):
        add(track_id, {"kind": "listeners", "because": title(seed)})
    for track_id, _score, label in _taste(conn, me):
        add(track_id, {"kind": "taste", "because": label})
    if not me:
        for track_id in _popular(conn, seen):
            add(track_id, {"kind": "popular", "because": ""})
    return picks
