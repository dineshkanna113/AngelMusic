"""Per-user data: favorites, playlists and listening history. No caps on any of them."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from typing import Literal

from pydantic import BaseModel, Field

from .. import queries
from ..security import current_user

router = APIRouter(prefix="/api", tags=["me"])

TRACK_ID = Field(min_length=1, max_length=64)


def _track_exists(conn, track_id: str) -> None:
    if conn.execute("SELECT 1 FROM tracks WHERE id = ?", (track_id,)).fetchone() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Track not found")


# ---- favorites ----------------------------------------------------------------------

@router.get("/favorites")
def list_favorites(request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        tracks = queries.tracks(conn, user["id"], "f.created_at IS NOT NULL", order="ORDER BY f.created_at DESC")
    return {"tracks": tracks}


@router.put("/favorites/{track_id}", status_code=status.HTTP_204_NO_CONTENT)
def add_favorite(track_id: str, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        _track_exists(conn, track_id)
        conn.execute("INSERT OR IGNORE INTO favorites (user_id, track_id) VALUES (?, ?)", (user["id"], track_id))


@router.delete("/favorites/{track_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_favorite(track_id: str, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        conn.execute("DELETE FROM favorites WHERE user_id = ? AND track_id = ?", (user["id"], track_id))


# ---- playlists ----------------------------------------------------------------------

class PlaylistBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    comment: str = Field(default="", max_length=2000)
    track_ids: list[str] | None = Field(default=None, max_length=20000)


class PlaylistPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    comment: str | None = Field(default=None, max_length=2000)
    track_ids: list[str] | None = Field(default=None, max_length=20000)
    visibility: Literal["private", "public"] | None = None
    collaborative: bool | None = None


class AddTracks(BaseModel):
    track_ids: list[str] = Field(min_length=1, max_length=20000)


def _playlist_row(conn, user_id: int, playlist_id: int):
    row = conn.execute("SELECT * FROM playlists WHERE id = ? AND user_id = ?", (playlist_id, user_id)).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Playlist not found")
    return row


def playlist_access(conn, user_id: int, playlist_id: int):
    """(row, role) for a playlist this user may see: owner, member (of a collaborative
    playlist) or viewer (of a public one). Anything else is 404, so private playlists
    don't reveal that they exist."""
    row = conn.execute("SELECT * FROM playlists WHERE id = ?", (playlist_id,)).fetchone()
    if row is not None:
        if row["user_id"] == user_id:
            return row, "owner"
        if row["collaborative"] and conn.execute(
                "SELECT 1 FROM playlist_members WHERE playlist_id = ? AND user_id = ?", (playlist_id, user_id)).fetchone():
            return row, "member"
        if row["visibility"] == "public":
            return row, "viewer"
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Playlist not found")


def _require(role: str, *allowed: str) -> None:
    if role not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the playlist's owner can do that"
                            if allowed == ("owner",) else "You can't edit this playlist")


def _playlist_ids(conn, playlist_id: int) -> list[str]:
    return [r["track_id"] for r in conn.execute(
        "SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position", (playlist_id,))]


def _set_tracks(conn, playlist_id: int, track_ids: list[str]) -> None:
    conn.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?", (playlist_id,))
    conn.executemany(
        "INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?, ?, ?)",
        [(playlist_id, i, tid) for i, tid in enumerate(track_ids)],
    )
    conn.execute("UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", (playlist_id,))


def playlist_summary(conn, row, role: str | None = None) -> dict:
    stats = conn.execute(
        """SELECT COUNT(t.id) AS n, COALESCE(SUM(t.duration), 0) AS dur,
                  (SELECT pt2.track_id FROM playlist_tracks pt2 JOIN tracks t2 ON t2.id = pt2.track_id
                   WHERE pt2.playlist_id = :p AND t2.has_cover ORDER BY pt2.position LIMIT 1) AS cover
           FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = :p""",
        {"p": row["id"]},
    ).fetchone()
    owner = conn.execute("SELECT username, display_name FROM users WHERE id = ?", (row["user_id"],)).fetchone()
    summary = {
        "id": row["id"], "name": row["name"], "comment": row["comment"], "created_at": row["created_at"],
        "updated_at": row["updated_at"], "track_count": stats["n"], "duration": stats["dur"],
        "cover_track_id": stats["cover"], "visibility": row["visibility"], "collaborative": bool(row["collaborative"]),
        "owner": {"username": owner["username"], "display_name": owner["display_name"] or owner["username"]},
    }
    if role:
        summary["role"] = role
    return summary


def playlist_detail(conn, user_id: int, row, role: str = "owner") -> dict:
    return {**playlist_summary(conn, row, role),
            "tracks": queries.tracks_by_ids(conn, user_id, _playlist_ids(conn, row["id"]))}


@router.get("/playlists")
def list_playlists(request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        rows = conn.execute(
            """SELECT p.*, CASE WHEN p.user_id = :u THEN 'owner' ELSE 'member' END AS role FROM playlists p
               WHERE p.user_id = :u OR (p.collaborative AND EXISTS (
                   SELECT 1 FROM playlist_members m WHERE m.playlist_id = p.id AND m.user_id = :u))
               ORDER BY p.updated_at DESC""",
            {"u": user["id"]},
        ).fetchall()
        return {"playlists": [playlist_summary(conn, r, r["role"]) for r in rows]}


@router.post("/playlists", status_code=status.HTTP_201_CREATED)
def create_playlist(body: PlaylistBody, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        cur = conn.execute("INSERT INTO playlists (user_id, name, comment) VALUES (?, ?, ?)",
                           (user["id"], body.name.strip(), body.comment))
        if body.track_ids:
            _set_tracks(conn, cur.lastrowid, body.track_ids)
        return playlist_detail(conn, user["id"], _playlist_row(conn, user["id"], cur.lastrowid))


@router.get("/playlists/{playlist_id}")
def get_playlist(playlist_id: int, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        return playlist_detail(conn, user["id"], *playlist_access(conn, user["id"], playlist_id))


@router.patch("/playlists/{playlist_id}")
def update_playlist(playlist_id: int, body: PlaylistPatch, request: Request, user: dict = Depends(current_user)):
    """Rename, edit the comment, set visibility or collaboration (owner), or replace the
    full track order (owner and collaborators; used for reorder/remove)."""
    with request.app.state.db.connect() as conn:
        _row, role = playlist_access(conn, user["id"], playlist_id)
        if body.track_ids is not None:
            _require(role, "owner", "member")
        if {"name", "comment", "visibility", "collaborative"} & body.model_fields_set:
            _require(role, "owner")
        if body.visibility is not None:
            conn.execute("UPDATE playlists SET visibility = ? WHERE id = ?", (body.visibility, playlist_id))
        if body.collaborative is not None:
            conn.execute("UPDATE playlists SET collaborative = ? WHERE id = ?", (int(body.collaborative), playlist_id))
        if body.name is not None:
            conn.execute("UPDATE playlists SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                         (body.name.strip(), playlist_id))
        if body.comment is not None:
            conn.execute("UPDATE playlists SET comment = ? WHERE id = ?", (body.comment, playlist_id))
        if body.track_ids is not None:
            _set_tracks(conn, playlist_id, body.track_ids)
        return playlist_detail(conn, user["id"], *playlist_access(conn, user["id"], playlist_id))


@router.post("/playlists/{playlist_id}/tracks")
def append_tracks(playlist_id: int, body: AddTracks, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        _row, role = playlist_access(conn, user["id"], playlist_id)
        _require(role, "owner", "member")
        _set_tracks(conn, playlist_id, _playlist_ids(conn, playlist_id) + body.track_ids)
        return playlist_summary(conn, *playlist_access(conn, user["id"], playlist_id))


@router.delete("/playlists/{playlist_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_playlist(playlist_id: int, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        _row, role = playlist_access(conn, user["id"], playlist_id)
        _require(role, "owner")
        conn.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))


# ---- history ------------------------------------------------------------------------

class PlayBody(BaseModel):
    track_id: str = TRACK_ID


def record_play(conn, user_id: int, track_id: str) -> None:
    _track_exists(conn, track_id)
    conn.execute("INSERT INTO plays (user_id, track_id) VALUES (?, ?)", (user_id, track_id))


@router.post("/history", status_code=status.HTTP_204_NO_CONTENT)
def add_play(body: PlayBody, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        record_play(conn, user["id"], body.track_id)


@router.get("/history")
def recent(request: Request, limit: int = Query(50, ge=1, le=500), user: dict = Depends(current_user)):
    """Most recently played tracks, each listed once."""
    with request.app.state.db.connect() as conn:
        ids = [r["track_id"] for r in conn.execute(
            "SELECT track_id, MAX(id) AS last FROM plays WHERE user_id = ? GROUP BY track_id ORDER BY last DESC LIMIT ?",
            (user["id"], limit))]
        return {"tracks": queries.tracks_by_ids(conn, user["id"], ids)}


@router.delete("/history", status_code=status.HTTP_204_NO_CONTENT)
def clear_history(request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        conn.execute("DELETE FROM plays WHERE user_id = ?", (user["id"],))
