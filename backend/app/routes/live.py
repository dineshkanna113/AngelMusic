"""Live features built on listening history: Rewind (a recap of your listening) and Blend
(a playlist made from two friends' tastes). Everything is counted from real plays and favorites."""

import calendar
import re
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from .. import queries
from ..library import artist_key
from ..security import current_user
from .me import _playlist_row, _set_tracks, playlist_detail
from .social import _user, are_friends

router = APIRouter(prefix="/api", tags=["live"])

BLEND_LIMIT = 30
BLEND_WINDOW_DAYS = 90


# ---- Rewind -----------------------------------------------------------------------------

def _period(value: str, today: date) -> tuple[date, date, str]:
    """(first day, last day, label) for 'month', 'year', 'YYYY-MM' or 'YYYY'."""
    if value == "month":
        y, m = today.year, today.month
    elif value == "year":
        return date(today.year, 1, 1), date(today.year, 12, 31), str(today.year)
    elif re.fullmatch(r"\d{4}", value):
        y = int(value)
        if not 1970 <= y <= 9999:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Pick a year from 1970")
        return date(y, 1, 1), date(y, 12, 31), value
    else:
        match = re.fullmatch(r"(\d{4})-(\d{2})", value)
        if not match or not 1 <= int(match[2]) <= 12 or int(match[1]) < 1970:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Use month, year, YYYY or YYYY-MM")
        y, m = int(match[1]), int(match[2])
    last = calendar.monthrange(y, m)[1]
    return date(y, m, 1), date(y, m, last), f"{calendar.month_name[m]} {y}"


@router.get("/rewind")
def rewind(request: Request, period: str = Query("month"), user: dict = Depends(current_user)):
    """Your listening in a period: plays, time, top tracks and artists, favourite genre, busiest day."""
    first, last, label = _period(period, date.today())
    start, end = first.isoformat(), (last + timedelta(days=1)).isoformat()
    window = ("FROM plays p JOIN tracks t ON t.id = p.track_id "
              "WHERE p.user_id = ? AND p.played_at >= ? AND p.played_at < ?")
    args = (user["id"], start, end)
    with request.app.state.db.connect() as conn:
        plays, seconds = conn.execute(f"SELECT COUNT(*), COALESCE(SUM(t.duration), 0) {window}", args).fetchone()
        days = conn.execute(
            f"SELECT strftime('%Y-%m-%d', p.played_at) AS d, COUNT(*) AS n {window} GROUP BY d ORDER BY n DESC, d DESC", args,
        ).fetchall()
        top = conn.execute(
            f"SELECT p.track_id, COUNT(*) AS plays, MAX(p.id) AS last {window} GROUP BY p.track_id ORDER BY plays DESC, last DESC LIMIT 5",
            args,
        ).fetchall()
        counts = {r["track_id"]: r["plays"] for r in top}
        top_tracks = [{**t, "plays": counts[t["id"]]} for t in queries.tracks_by_ids(conn, user["id"], list(counts))]
        artists = conn.execute(
            f"""SELECT t.artist_id AS id, MIN(t.album_artist) AS album_artist, MIN(t.artist) AS artist,
                       COUNT(*) AS plays, MAX(p.id) AS last {window} GROUP BY t.artist_id
                ORDER BY plays DESC, last DESC LIMIT 5""", args,
        ).fetchall()
        genre = conn.execute(
            f"SELECT t.genre AS genre, COUNT(*) AS n {window} AND t.genre != '' GROUP BY t.genre ORDER BY n DESC, t.genre LIMIT 1", args,
        ).fetchone()
    return {
        "period": period, "label": label, "start": first.isoformat(), "end": last.isoformat(),
        "plays": plays, "seconds": int(seconds), "minutes": round(seconds / 60), "active_days": len(days),
        "top_tracks": top_tracks,
        "top_artists": [{"id": a["id"], "name": artist_key(a["album_artist"], a["artist"]), "plays": a["plays"]} for a in artists],
        "top_genre": genre["genre"] if genre else None,
        "busiest_day": {"date": days[0]["d"], "plays": days[0]["n"]} if days else None,
    }


# ---- Blend ------------------------------------------------------------------------------

class BlendBody(BaseModel):
    username: str


def _taste(conn, user_id: int) -> list[dict]:
    """A person's tracks, most played first (recent plays), then their favorites. Removed tracks are skipped."""
    rows = conn.execute(
        """SELECT p.track_id, t.artist_id, MIN(t.album_artist) AS album_artist, MIN(t.artist) AS artist,
                  COUNT(*) AS n, MAX(p.id) AS last
           FROM plays p JOIN tracks t ON t.id = p.track_id
           WHERE p.user_id = ? AND p.played_at >= datetime('now', ?)
           GROUP BY p.track_id ORDER BY n DESC, last DESC""",
        (user_id, f"-{BLEND_WINDOW_DAYS} days"),
    ).fetchall()
    seen = {r["track_id"] for r in rows}
    favs = conn.execute(
        """SELECT f.track_id, t.artist_id, t.album_artist, t.artist FROM favorites f JOIN tracks t ON t.id = f.track_id
           WHERE f.user_id = ? ORDER BY f.created_at DESC""", (user_id,),
    ).fetchall()
    return [dict(r) for r in rows] + [dict(r) for r in favs if r["track_id"] not in seen]


@router.post("/blends", status_code=status.HTTP_201_CREATED)
def make_blend(body: BlendBody, request: Request, user: dict = Depends(current_user)):
    """A private playlist from your taste and a friend's: songs you both play first, then the two
    of you taking turns. The match is the share of artists you both listen to."""
    with request.app.state.db.connect() as conn:
        other = _user(conn, body.username)
        if other["id"] == user["id"]:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Blend with a friend, not yourself")
        if not are_friends(conn, user["id"], other["id"]) or not other["share_activity"]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You can blend with friends who share their listening")
        mine, theirs = _taste(conn, user["id"]), _taste(conn, other["id"])
        if not mine or not theirs:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "You both need some listening history first")

        my_ids, their_ids = [t["track_id"] for t in mine], [t["track_id"] for t in theirs]
        shared = [t for t in my_ids if t in set(their_ids)]
        mine_only = [t for t in my_ids if t not in set(shared)]
        theirs_only = [t for t in their_ids if t not in set(shared)]
        mixed = list(shared)
        for a, b in zip(mine_only + [None] * len(theirs_only), theirs_only + [None] * len(mine_only)):
            mixed.extend(t for t in (a, b) if t)
        mixed = list(dict.fromkeys(mixed))[:BLEND_LIMIT]

        names = {}
        for t in mine + theirs:
            names[t["artist_id"]] = artist_key(t["album_artist"], t["artist"])
        a_mine, a_theirs = {t["artist_id"] for t in mine}, {t["artist_id"] for t in theirs}
        both, either = a_mine & a_theirs, a_mine | a_theirs
        match = round(100 * len(both) / len(either)) if either else 0

        me = conn.execute("SELECT username, display_name FROM users WHERE id = ?", (user["id"],)).fetchone()
        mine_name = me["display_name"] or me["username"]
        their_name = other["display_name"] or other["username"]
        cur = conn.execute(
            "INSERT INTO playlists (user_id, name, comment) VALUES (?, ?, ?)",
            (user["id"], f"{mine_name} + {their_name}"[:100], f"A blend of {mine_name} and {their_name}. {match}% match."),
        )
        _set_tracks(conn, cur.lastrowid, mixed)
        detail = playlist_detail(conn, user["id"], _playlist_row(conn, user["id"], cur.lastrowid))
        detail["blend"] = {"match": match, "shared_artists": sorted(names[a] for a in both)}
        return detail
