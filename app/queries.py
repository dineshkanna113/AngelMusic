"""Track/album/artist queries shared by the web API and the Subsonic API."""

from .library import COLUMNS, artist_key, is_lossless

PUBLIC_FIELDS = [c for c in COLUMNS if c not in ("rel_path", "mtime_ns")] + ["added_at"]

TRACK_ORDER = (
    "ORDER BY t.album_artist COLLATE NOCASE, t.album COLLATE NOCASE, t.disc_no, t.track_no, t.title COLLATE NOCASE"
)

_ANNOTATED = """
SELECT t.*, f.created_at AS starred_at, COALESCE(pc.cnt, 0) AS play_count, pc.last AS last_played
FROM tracks t
LEFT JOIN favorites f ON f.track_id = t.id AND f.user_id = :uid
LEFT JOIN (
    SELECT track_id, COUNT(*) AS cnt, MAX(played_at) AS last FROM plays WHERE user_id = :uid GROUP BY track_id
) pc ON pc.track_id = t.id
"""


def public_track(row) -> dict:
    track = {k: row[k] for k in PUBLIC_FIELDS}
    track["has_cover"] = bool(track["has_cover"])
    track["has_lyrics"] = bool(track["has_lyrics"])
    track["lossless"] = is_lossless(track["codec"])
    keys = row.keys()
    track["favorite"] = bool(row["starred_at"]) if "starred_at" in keys else False
    track["starred_at"] = row["starred_at"] if "starred_at" in keys else None
    track["play_count"] = row["play_count"] if "play_count" in keys else 0
    track["last_played"] = row["last_played"] if "last_played" in keys else None
    return track


def tracks(conn, user_id: int, where: str = "", params: dict | None = None, order: str = TRACK_ORDER,
           limit: int | None = None) -> list[dict]:
    sql = f"{_ANNOTATED} {('WHERE ' + where) if where else ''} {order}"
    if limit:
        sql += f" LIMIT {int(limit)}"
    return [public_track(r) for r in conn.execute(sql, {"uid": user_id, **(params or {})}).fetchall()]


def track(conn, user_id: int, track_id: str) -> dict | None:
    rows = tracks(conn, user_id, "t.id = :id", {"id": track_id})
    return rows[0] if rows else None


def tracks_by_ids(conn, user_id: int, ids: list[str]) -> list[dict]:
    """Tracks in the given order; ids no longer in the library are skipped."""
    if not ids:
        return []
    marks = ", ".join(f":i{n}" for n in range(len(ids)))
    found = {t["id"]: t for t in tracks(conn, user_id, f"t.id IN ({marks})",
                                        {f"i{n}": i for n, i in enumerate(ids)}, order="")}
    return [found[i] for i in ids if i in found]


def albums(track_list: list[dict]) -> list[dict]:
    by_id: dict[str, dict] = {}
    for t in track_list:
        a = by_id.get(t["album_id"])
        if a is None:
            a = by_id[t["album_id"]] = {
                "id": t["album_id"],
                "name": t["album"] or "Unknown album",
                "artist": artist_key(t["album_artist"], t["artist"]),
                "artist_id": t["artist_id"],
                "year": t["year"],
                "genre": t["genre"],
                "track_count": 0,
                "duration": 0.0,
                "cover_track_id": None,
                "added_at": t["added_at"],
                "play_count": 0,
                "max_sample_rate": 0,
                "max_bit_depth": 0,
                "lossless": True,
                "favorite_count": 0,
            }
        a["track_count"] += 1
        a["duration"] += t["duration"]
        a["play_count"] += t["play_count"]
        a["favorite_count"] += int(t["favorite"])
        a["year"] = a["year"] or t["year"]
        a["genre"] = a["genre"] or t["genre"]
        a["added_at"] = max(a["added_at"], t["added_at"])
        a["max_sample_rate"] = max(a["max_sample_rate"], t["sample_rate"] or 0)
        a["max_bit_depth"] = max(a["max_bit_depth"], t["bit_depth"] or 0)
        a["lossless"] = a["lossless"] and t["lossless"]
        if a["cover_track_id"] is None and t["has_cover"]:
            a["cover_track_id"] = t["id"]
    return sorted(by_id.values(), key=lambda a: (a["artist"].lower(), a["name"].lower()))


def artists(album_list: list[dict]) -> list[dict]:
    by_id: dict[str, dict] = {}
    for a in album_list:
        ar = by_id.setdefault(a["artist_id"], {
            "id": a["artist_id"], "name": a["artist"], "album_count": 0, "track_count": 0, "cover_track_id": None,
        })
        ar["album_count"] += 1
        ar["track_count"] += a["track_count"]
        ar["cover_track_id"] = ar["cover_track_id"] or a["cover_track_id"]
    return sorted(by_id.values(), key=lambda a: a["name"].lower())
