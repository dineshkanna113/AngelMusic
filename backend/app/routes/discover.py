"""Discovery: charts, artist pages and editorial playlists.

Everything here is real aggregate data: chart counts are plays across all users (never who
played what), follower counts are rows in artist_follows, and top tracks are all-time plays.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from .. import queries
from ..library import artist_key
from ..security import admin_user, current_user
from .me import playlist_summary

router = APIRouter(prefix="/api", tags=["discover"])


class BioBody(BaseModel):
    bio: str = Field(max_length=1000)


@router.get("/charts")
def charts(
    request: Request, days: int = Query(7, ge=1, le=365), limit: int = Query(50, ge=1, le=100),
    user: dict = Depends(current_user),
):
    """The most played tracks across all listeners in the last `days` days."""
    with request.app.state.db.connect() as conn:
        rows = conn.execute(
            """SELECT track_id, COUNT(*) AS plays, MAX(id) AS last FROM plays
               WHERE played_at >= datetime('now', ?) GROUP BY track_id ORDER BY plays DESC, last DESC LIMIT ?""",
            (f"-{days} days", limit),
        ).fetchall()
        found = {t["id"]: t for t in queries.tracks_by_ids(conn, user["id"], [r["track_id"] for r in rows])}
    ranked = []
    for r in rows:
        if r["track_id"] in found:  # a removed track drops out of the chart
            ranked.append({**found[r["track_id"]], "rank": len(ranked) + 1, "plays": r["plays"]})
    return {"days": days, "tracks": ranked}


def _artist_row(conn, artist_id: str):
    row = conn.execute("SELECT album_artist, artist FROM tracks WHERE artist_id = ? LIMIT 1", (artist_id,)).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Artist not found")
    return row


def _artist_page(conn, user_id: int, artist_id: str) -> dict:
    row = _artist_row(conn, artist_id)
    info = conn.execute("SELECT bio FROM artist_info WHERE artist_id = ?", (artist_id,)).fetchone()
    top = conn.execute(
        """SELECT p.track_id, COUNT(*) AS plays, MAX(p.id) AS last FROM plays p JOIN tracks t ON t.id = p.track_id
           WHERE t.artist_id = ? GROUP BY p.track_id ORDER BY plays DESC, last DESC LIMIT 5""",
        (artist_id,),
    ).fetchall()
    plays = {r["track_id"]: r["plays"] for r in top}
    top_tracks = [{**t, "plays": plays[t["id"]]} for t in queries.tracks_by_ids(conn, user_id, list(plays))]
    albums = queries.albums(queries.tracks(conn, user_id, "t.artist_id = :a", {"a": artist_id}))
    return {
        "id": artist_id,
        "name": artist_key(row["album_artist"], row["artist"]),
        "bio": info["bio"] if info else "",
        "followers": conn.execute("SELECT COUNT(*) FROM artist_follows WHERE artist_id = ?", (artist_id,)).fetchone()[0],
        "following": conn.execute("SELECT 1 FROM artist_follows WHERE artist_id = ? AND user_id = ?",
                                  (artist_id, user_id)).fetchone() is not None,
        "top_tracks": top_tracks,
        "albums": albums,
    }


@router.get("/artists/{artist_id}")
def artist_page(artist_id: str, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        return _artist_page(conn, user["id"], artist_id)


@router.put("/artists/{artist_id}/bio")
def set_bio(artist_id: str, body: BioBody, request: Request, admin: dict = Depends(admin_user)):
    """Editorial bio for an artist page; an empty bio clears it."""
    bio = body.bio.strip()
    with request.app.state.db.connect() as conn:
        _artist_row(conn, artist_id)
        if bio:
            conn.execute(
                """INSERT INTO artist_info (artist_id, bio, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
                   ON CONFLICT(artist_id) DO UPDATE SET bio = excluded.bio, updated_at = excluded.updated_at""",
                (artist_id, bio),
            )
        else:
            conn.execute("DELETE FROM artist_info WHERE artist_id = ?", (artist_id,))
        return _artist_page(conn, admin["id"], artist_id)


@router.get("/editorial")
def editorial(request: Request, _user: dict = Depends(current_user)):
    """Playlists an admin has featured on Browse, newest first."""
    with request.app.state.db.connect() as conn:
        rows = conn.execute("SELECT * FROM playlists WHERE featured ORDER BY updated_at DESC").fetchall()
        return {"playlists": [playlist_summary(conn, r) for r in rows]}
