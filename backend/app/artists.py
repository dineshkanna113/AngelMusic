"""Artist lookups shared by the discovery and growth routes. Artists come from file tags, not accounts;
access to manage one is an explicit grant in artist_owners."""

from fastapi import HTTPException, status

from .library import artist_key
from .routes.social import can_see, person


def artist_row(conn, artist_id: str):
    row = conn.execute("SELECT album_artist, artist FROM tracks WHERE artist_id = ? LIMIT 1", (artist_id,)).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Artist not found")
    return row


def artist_name(conn, artist_id: str) -> str:
    row = artist_row(conn, artist_id)
    return artist_key(row["album_artist"], row["artist"])


def manages(conn, user: dict, artist_id: str) -> bool:
    """Admins manage every artist; owners manage the artists an admin granted them."""
    if user["is_admin"]:
        return True
    return conn.execute("SELECT 1 FROM artist_owners WHERE artist_id = ? AND user_id = ?",
                        (artist_id, user["id"])).fetchone() is not None


def require_manage(conn, user: dict, artist_id: str) -> None:
    artist_row(conn, artist_id)  # 404 first, so a missing artist never looks like a permissions problem
    if not manages(conn, user, artist_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't manage this artist")


def fan_rows(conn, artist_id: str, limit: int) -> list:
    return conn.execute(
        """SELECT p.user_id, COUNT(*) AS plays, MAX(p.id) AS last FROM plays p JOIN tracks t ON t.id = p.track_id
           WHERE t.artist_id = ? GROUP BY p.user_id ORDER BY plays DESC, last DESC LIMIT ?""",
        (artist_id, limit),
    ).fetchall()


def top_fans(conn, artist_id: str, viewer_id: int, limit: int, *, anonymous_ok: bool) -> list[dict]:
    """Fans ranked by plays. A fan is named only if they share activity and their profile is visible to the
    viewer. Anonymous fans appear as `person: None` when `anonymous_ok` (the artist's own view) and are left
    out otherwise (the public list)."""
    fans = []
    for r in fan_rows(conn, artist_id, limit * 3 if not anonymous_ok else limit):
        user = conn.execute("SELECT * FROM users WHERE id = ?", (r["user_id"],)).fetchone()
        named = user is not None and user["share_activity"] and (
            can_see(conn, user, viewer_id) if not anonymous_ok else not user["is_private"])
        if named:
            fans.append({"person": person(conn, user, viewer_id), "plays": r["plays"]})
        elif anonymous_ok:
            fans.append({"person": None, "plays": r["plays"]})
        if len(fans) == limit:
            break
    return fans
