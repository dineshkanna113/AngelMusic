"""The social layer: profiles, follows (mutual follows are friends) and followed artists.

Privacy: a private profile shows its activity, top artists and public playlists only to the
owner and to mutual friends. Everyone can still see the name, avatar and follower counts.
"""

import re
import secrets
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .. import queries
from ..library import artist_key
from ..security import current_user
from .me import playlist_summary

router = APIRouter(prefix="/api", tags=["social"])

MAX_AVATAR_BYTES = 2 * 1024 * 1024
_AVATAR_NAME = re.compile(r"^[0-9a-f]{32}\.(png|jpg|webp)$")
_SIGNATURES = (
    (lambda h: h[:8] == b"\x89PNG\r\n\x1a\n", ".png"),
    (lambda h: h[:3] == b"\xff\xd8\xff", ".jpg"),
    (lambda h: h[:4] == b"RIFF" and h[8:12] == b"WEBP", ".webp"),
)


LIVE_SECONDS = 120


class PresenceBody(BaseModel):
    track_id: str | None = Field(default=None, max_length=64)


class ProfilePatch(BaseModel):
    display_name: str | None = Field(default=None, max_length=40)
    bio: str | None = Field(default=None, max_length=160)
    is_private: bool | None = None
    share_activity: bool | None = None


def _avatar_dir(request: Request) -> Path:
    return request.app.state.settings.database_path.parent / "avatars"


def _user(conn, username: str):
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No one with that username")
    return row


def _follows(conn, follower_id: int, followee_id: int) -> bool:
    return conn.execute("SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?",
                        (follower_id, followee_id)).fetchone() is not None


def are_friends(conn, a: int, b: int) -> bool:
    return _follows(conn, a, b) and _follows(conn, b, a)


def can_see(conn, row, viewer_id: int) -> bool:
    """Whether the viewer may see this person's activity, top artists and playlists."""
    return row["id"] == viewer_id or not row["is_private"] or are_friends(conn, row["id"], viewer_id)


def person(conn, row, viewer_id: int) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"] or row["username"],
        "avatar_url": f"/api/avatars/{row['avatar']}" if row["avatar"] else None,
        "is_following": _follows(conn, viewer_id, row["id"]),
        "follows_you": _follows(conn, row["id"], viewer_id),
    }


def _top_artists(conn, user_id: int) -> list[dict]:
    rows = conn.execute(
        """SELECT t.artist_id, t.album_artist, t.artist, COUNT(*) AS plays FROM plays p
           JOIN tracks t ON t.id = p.track_id
           WHERE p.user_id = ? AND p.played_at >= datetime('now', '-30 days')
           GROUP BY t.artist_id ORDER BY plays DESC LIMIT 6""",
        (user_id,),
    ).fetchall()
    return [{"id": r["artist_id"], "name": artist_key(r["album_artist"], r["artist"]), "plays": r["plays"]} for r in rows]


def profile(conn, row, viewer_id: int) -> dict:
    visible = can_see(conn, row, viewer_id)
    count = lambda sql: conn.execute(sql, (row["id"],)).fetchone()[0]  # noqa: E731
    playlists = None
    if visible:
        playlists = [playlist_summary(conn, p) for p in conn.execute(
            "SELECT * FROM playlists WHERE user_id = ? AND visibility = 'public' ORDER BY updated_at DESC", (row["id"],))]
    return {
        **person(conn, row, viewer_id),
        "bio": row["bio"],
        "followers": count("SELECT COUNT(*) FROM follows WHERE followee_id = ?"),
        "following": count("SELECT COUNT(*) FROM follows WHERE follower_id = ?"),
        "is_private": bool(row["is_private"]),
        "is_self": row["id"] == viewer_id,
        "top_artists": _top_artists(conn, row["id"]) if visible else None,
        "playlists": playlists,
    }


# ---- people ---------------------------------------------------------------------------

@router.get("/people")
def search_people(request: Request, q: str = Query(..., min_length=1, max_length=40), user: dict = Depends(current_user)):
    term = q.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    with request.app.state.db.connect() as conn:
        rows = conn.execute(
            r"""SELECT * FROM users WHERE id != ? AND (lower(username) LIKE ? ESCAPE '\'
                   OR lower(display_name) LIKE ? ESCAPE '\') ORDER BY username LIMIT 20""",
            (user["id"], f"{term}%", f"%{term}%"),
        ).fetchall()
        return {"people": [person(conn, r, user["id"]) for r in rows]}


@router.get("/people/{username}")
def get_profile(username: str, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        return profile(conn, _user(conn, username), user["id"])


@router.put("/people/{username}/follow", status_code=status.HTTP_204_NO_CONTENT)
def follow(username: str, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        row = _user(conn, username)
        if row["id"] == user["id"]:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can't follow yourself")
        conn.execute("INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)", (user["id"], row["id"]))


@router.delete("/people/{username}/follow", status_code=status.HTTP_204_NO_CONTENT)
def unfollow(username: str, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        row = _user(conn, username)
        conn.execute("DELETE FROM follows WHERE follower_id = ? AND followee_id = ?", (user["id"], row["id"]))


@router.get("/people/{username}/followers")
def followers(username: str, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        row = _user(conn, username)
        rows = conn.execute("""SELECT u.* FROM follows f JOIN users u ON u.id = f.follower_id
                               WHERE f.followee_id = ? ORDER BY f.created_at DESC""", (row["id"],)).fetchall()
        return {"people": [person(conn, r, user["id"]) for r in rows]}


@router.get("/people/{username}/following")
def following(username: str, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        row = _user(conn, username)
        rows = conn.execute("""SELECT u.* FROM follows f JOIN users u ON u.id = f.followee_id
                               WHERE f.follower_id = ? ORDER BY f.created_at DESC""", (row["id"],)).fetchall()
        return {"people": [person(conn, r, user["id"]) for r in rows]}


# ---- presence and friend activity --------------------------------------------------------

@router.post("/presence", status_code=status.HTTP_204_NO_CONTENT)
def set_presence(body: PresenceBody, request: Request, user: dict = Depends(current_user)):
    """Heartbeat from the player: the track now playing, or null when paused or stopped."""
    with request.app.state.db.connect() as conn:
        if body.track_id and conn.execute("SELECT 1 FROM tracks WHERE id = ?", (body.track_id,)).fetchone() is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Track not found")
        conn.execute(
            """INSERT INTO presence (user_id, track_id, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(user_id) DO UPDATE SET track_id = excluded.track_id, updated_at = excluded.updated_at""",
            (user["id"], body.track_id),
        )


@router.get("/activity")
def friend_activity(request: Request, user: dict = Depends(current_user)):
    """What the people I follow are playing now, or played last. Live first, then most recent."""
    with request.app.state.db.connect() as conn:
        rows = conn.execute(
            """SELECT u.*, p.track_id AS live_track, p.updated_at AS live_at,
                      p.track_id IS NOT NULL AND p.updated_at >= datetime('now', ?) AS is_live
               FROM follows f JOIN users u ON u.id = f.followee_id
               LEFT JOIN presence p ON p.user_id = u.id
               WHERE f.follower_id = ? AND u.share_activity""",
            (f"-{LIVE_SECONDS} seconds", user["id"]),
        ).fetchall()
        friends = []
        for row in rows:
            if not can_see(conn, row, user["id"]):
                continue
            if row["is_live"]:
                track_id, at = row["live_track"], row["live_at"]
            else:
                last = conn.execute("SELECT track_id, played_at FROM plays WHERE user_id = ? ORDER BY id DESC LIMIT 1",
                                    (row["id"],)).fetchone()
                track_id, at = (last["track_id"], last["played_at"]) if last else (None, None)
            friends.append({
                "person": person(conn, row, user["id"]),
                "track": queries.track(conn, user["id"], track_id) if track_id else None,
                "live": bool(row["is_live"]),
                "at": at,
            })
    friends.sort(key=lambda f: f["at"] or "", reverse=True)  # stable sorts: recency, then live first
    friends.sort(key=lambda f: not f["live"])
    return {"friends": friends}


# ---- my profile -----------------------------------------------------------------------

@router.patch("/me/profile")
def update_profile(body: ProfilePatch, request: Request, user: dict = Depends(current_user)):
    fields = body.model_dump(exclude_unset=True)
    with request.app.state.db.connect() as conn:
        for name, value in fields.items():
            value = value.strip() if isinstance(value, str) else int(value)
            conn.execute(f"UPDATE users SET {name} = ? WHERE id = ?", (value, user["id"]))  # names from the model
        return profile(conn, conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone(), user["id"])


@router.post("/me/avatar")
async def upload_avatar(request: Request, file: UploadFile = File(...), user: dict = Depends(current_user)):
    data = await file.read(MAX_AVATAR_BYTES + 1)
    if len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Pick an image under 2 MB")
    suffix = next((ext for test, ext in _SIGNATURES if test(data[:16])), None)
    if suffix is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Use a PNG, JPEG or WebP image")
    folder = _avatar_dir(request)
    folder.mkdir(parents=True, exist_ok=True)
    name = secrets.token_hex(16) + suffix
    (folder / name).write_bytes(data)
    with request.app.state.db.connect() as conn:
        old = conn.execute("SELECT avatar FROM users WHERE id = ?", (user["id"],)).fetchone()["avatar"]
        conn.execute("UPDATE users SET avatar = ? WHERE id = ?", (name, user["id"]))
    if old:
        (folder / old).unlink(missing_ok=True)
    return {"avatar_url": f"/api/avatars/{name}"}


@router.delete("/me/avatar", status_code=status.HTTP_204_NO_CONTENT)
def delete_avatar(request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        old = conn.execute("SELECT avatar FROM users WHERE id = ?", (user["id"],)).fetchone()["avatar"]
        conn.execute("UPDATE users SET avatar = NULL WHERE id = ?", (user["id"],))
    if old:
        (_avatar_dir(request) / old).unlink(missing_ok=True)


@router.get("/avatars/{name}")
def get_avatar(name: str, request: Request):
    """Avatars are public, like on any social network; names are random and never reused."""
    path = _avatar_dir(request) / name
    if not _AVATAR_NAME.match(name) or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such avatar")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})


# ---- artists --------------------------------------------------------------------------

def _artist_exists(conn, artist_id: str) -> None:
    if conn.execute("SELECT 1 FROM tracks WHERE artist_id = ? LIMIT 1", (artist_id,)).fetchone() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Artist not found")


@router.put("/artists/{artist_id}/follow", status_code=status.HTTP_204_NO_CONTENT)
def follow_artist(artist_id: str, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        _artist_exists(conn, artist_id)
        conn.execute("INSERT OR IGNORE INTO artist_follows (user_id, artist_id) VALUES (?, ?)", (user["id"], artist_id))


@router.delete("/artists/{artist_id}/follow", status_code=status.HTTP_204_NO_CONTENT)
def unfollow_artist(artist_id: str, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        conn.execute("DELETE FROM artist_follows WHERE user_id = ? AND artist_id = ?", (user["id"], artist_id))


@router.get("/me/artists")
def my_artists(request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        rows = conn.execute(
            """SELECT f.artist_id, MIN(t.album_artist) AS album_artist, MIN(t.artist) AS artist
               FROM artist_follows f JOIN tracks t ON t.artist_id = f.artist_id
               WHERE f.user_id = ? GROUP BY f.artist_id ORDER BY MAX(f.created_at) DESC""",
            (user["id"],),
        ).fetchall()
        return {"artists": [{"id": r["artist_id"], "name": artist_key(r["album_artist"], r["artist"])} for r in rows]}
