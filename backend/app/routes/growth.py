"""Artist growth: access grants, stats and top fans (drops and smart links are added alongside)."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from .. import queries
from ..artists import artist_name, artist_row, require_manage, top_fans
from ..library import artist_key
from ..security import admin_user, current_user
from .social import _user

router = APIRouter(prefix="/api", tags=["growth"])


@router.put("/artists/{artist_id}/owners/{username}", status_code=status.HTTP_204_NO_CONTENT)
def grant_access(artist_id: str, username: str, request: Request, _admin: dict = Depends(admin_user)):
    """Let a user manage an artist: edit its bio, see its stats, create its drops."""
    with request.app.state.db.connect() as conn:
        artist_row(conn, artist_id)
        owner = _user(conn, username)
        conn.execute("INSERT OR IGNORE INTO artist_owners (artist_id, user_id) VALUES (?, ?)", (artist_id, owner["id"]))


@router.delete("/artists/{artist_id}/owners/{username}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_access(artist_id: str, username: str, request: Request, _admin: dict = Depends(admin_user)):
    with request.app.state.db.connect() as conn:
        artist_row(conn, artist_id)
        owner = _user(conn, username)
        conn.execute("DELETE FROM artist_owners WHERE artist_id = ? AND user_id = ?", (artist_id, owner["id"]))


@router.get("/studio")
def studio(request: Request, user: dict = Depends(current_user)):
    """The artists this user manages."""
    with request.app.state.db.connect() as conn:
        rows = conn.execute(
            """SELECT o.artist_id, MIN(t.album_artist) AS album_artist, MIN(t.artist) AS artist
               FROM artist_owners o JOIN tracks t ON t.artist_id = o.artist_id
               WHERE o.user_id = ? GROUP BY o.artist_id ORDER BY o.artist_id""",
            (user["id"],),
        ).fetchall()
        return {"artists": [{"id": r["artist_id"], "name": artist_key(r["album_artist"], r["artist"])} for r in rows]}


@router.get("/artists/{artist_id}/stats")
def stats(artist_id: str, request: Request, days: int = Query(30, ge=1, le=365), user: dict = Depends(current_user)):
    """Real counts for the last `days` days (today included). Location appears only when plays carried it."""
    since = f"-{days - 1} days"
    with request.app.state.db.connect() as conn:
        require_manage(conn, user, artist_id)
        window = "FROM plays p JOIN tracks t ON t.id = p.track_id WHERE t.artist_id = ? AND p.played_at >= date('now', ?)"
        args = (artist_id, since)
        total, listeners = conn.execute(f"SELECT COUNT(*), COUNT(DISTINCT p.user_id) {window}", args).fetchone()
        by_day = {r["d"]: r["n"] for r in conn.execute(
            f"SELECT strftime('%Y-%m-%d', p.played_at) AS d, COUNT(*) AS n {window} GROUP BY d", args)}
        today = datetime.now(timezone.utc).date()
        series = [{"date": (today - timedelta(days=i)).isoformat(), "plays": by_day.get((today - timedelta(days=i)).isoformat(), 0)}
                  for i in range(days - 1, -1, -1)]
        top = conn.execute(
            f"SELECT p.track_id, COUNT(*) AS plays, MAX(p.id) AS last {window} GROUP BY p.track_id ORDER BY plays DESC, last DESC LIMIT 5", args,
        ).fetchall()
        plays = {r["track_id"]: r["plays"] for r in top}
        top_tracks = [{**t, "plays": plays[t["id"]]} for t in queries.tracks_by_ids(conn, user["id"], list(plays))]

        def where(column: str, normalize: str) -> list[dict]:
            rows = conn.execute(
                f"SELECT {normalize} AS name, COUNT(*) AS plays {window} AND p.{column} IS NOT NULL AND p.{column} != '' "
                f"GROUP BY name ORDER BY plays DESC, name LIMIT 10", args).fetchall()
            return [{"name": r["name"], "plays": r["plays"]} for r in rows]

        return {
            "days": days, "artist": artist_name(conn, artist_id), "plays": total, "listeners": listeners,
            "followers": conn.execute("SELECT COUNT(*) FROM artist_follows WHERE artist_id = ?", (artist_id,)).fetchone()[0],
            "series": series, "top_tracks": top_tracks,
            "top_fans": top_fans(conn, artist_id, user["id"], 10, anonymous_ok=True),
            "countries": where("country", "upper(p.country)"), "cities": where("city", "p.city"),
        }
