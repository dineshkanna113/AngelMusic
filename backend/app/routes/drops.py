"""Drops: announced releases with a countdown, pre-saves, artwork and a public smart link.

A drop is linked to an upload. When that upload is published (see ingest.release_drops) the drop goes
"out" and the track lands in every pre-saver's favorites."""

import html
import re
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field

from .. import ingest
from ..artists import artist_name, manages, require_manage
from ..security import current_user
from .social import _SIGNATURES, MAX_AVATAR_BYTES

router = APIRouter(prefix="/api", tags=["drops"])
public = APIRouter(tags=["drops"])  # unauthenticated pages, mounted at the site root

_ART_NAME = re.compile(r"^[0-9a-f]{32}\.(png|jpg|webp)$")
_DB_TIME = "%Y-%m-%d %H:%M:%S"


class DropBody(BaseModel):
    artist_id: str
    title: str = Field(min_length=1, max_length=120)
    description: str = Field("", max_length=500)
    release_at: str
    upload_id: str | None = None


class DropPatch(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=120)
    description: str | None = Field(None, max_length=500)
    release_at: str | None = None
    upload_id: str | None = None


def _art_dir(request: Request) -> Path:
    return request.app.state.settings.database_path.parent / "drop-art"


def _parse_time(value: str) -> datetime:
    """ISO time to UTC. A time without a zone is read as UTC. It must lie in the future."""
    try:
        when = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Release time must be an ISO date and time")
    when = when.replace(tzinfo=timezone.utc) if when.tzinfo is None else when.astimezone(timezone.utc)
    if when <= datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pick a release time in the future")
    return when


def _check_upload(conn, user: dict, upload_id: str | None) -> None:
    if upload_id is None:
        return
    row = conn.execute("SELECT user_id, status FROM uploads WHERE id = ?", (upload_id,)).fetchone()
    if row is None or row["user_id"] != user["id"] or row["status"] in (ingest.PUBLISHED, ingest.REMOVED):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Link one of your own uploads that is not published yet")


def _utc(db_time: str) -> datetime:
    return datetime.strptime(db_time[:19].replace("T", " "), _DB_TIME).replace(tzinfo=timezone.utc)


def _status(row) -> str:
    if row["released_at"]:
        return "out"
    return "dropping_soon" if _utc(row["release_at"]) <= datetime.now(timezone.utc) else "upcoming"


def _drop(conn, row, user: dict) -> dict:
    return {
        "id": row["id"], "slug": row["slug"],
        "artist": {"id": row["artist_id"], "name": artist_name(conn, row["artist_id"])},
        "title": row["title"], "description": row["description"],
        "release_at": _utc(row["release_at"]).isoformat().replace("+00:00", "Z"),
        "artwork_url": f"/api/drop-art/{row['artwork']}" if row["artwork"] else None,
        "status": _status(row),
        "presaves": conn.execute("SELECT COUNT(*) FROM presaves WHERE drop_id = ?", (row["id"],)).fetchone()[0],
        "presaved": conn.execute("SELECT 1 FROM presaves WHERE drop_id = ? AND user_id = ?",
                                 (row["id"], user["id"])).fetchone() is not None,
        "track_id": row["track_id"], "album_id": row["album_id"],
        "can_manage": manages(conn, user, row["artist_id"]),
        "share_url": f"/s/{row['slug']}",
    }


def _get_drop(conn, drop_id: int):
    row = conn.execute("SELECT * FROM drops WHERE id = ?", (drop_id,)).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Drop not found")
    return row


def _slug(title: str) -> str:
    words = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:30].strip("-")
    return f"{words}-{secrets.token_hex(3)}" if words else secrets.token_hex(4)


@router.post("/drops", status_code=status.HTTP_201_CREATED)
def create_drop(body: DropBody, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        require_manage(conn, user, body.artist_id)
        when = _parse_time(body.release_at)
        _check_upload(conn, user, body.upload_id)
        cur = conn.execute(
            """INSERT INTO drops (slug, artist_id, user_id, title, description, release_at, upload_id)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (_slug(body.title), body.artist_id, user["id"], body.title.strip(), body.description.strip(),
             when.strftime(_DB_TIME), body.upload_id),
        )
        return _drop(conn, _get_drop(conn, cur.lastrowid), user)


@router.get("/drops")
def list_drops(request: Request, artist_id: str | None = None, user: dict = Depends(current_user)):
    """Upcoming and due drops first (soonest first), then what came out in the last 30 days."""
    where, args = ("WHERE artist_id = ?", (artist_id,)) if artist_id else ("", ())
    with request.app.state.db.connect() as conn:
        rows = conn.execute(f"SELECT * FROM drops {where}", args).fetchall()
        recent = (datetime.now(timezone.utc) - timedelta(days=30)).strftime(_DB_TIME)
        coming = sorted((r for r in rows if not r["released_at"]), key=lambda r: r["release_at"])
        out = sorted((r for r in rows if r["released_at"] and r["released_at"] >= recent),
                     key=lambda r: r["released_at"], reverse=True)
        return {"drops": [_drop(conn, r, user) for r in coming + out]}


@router.get("/drops/{slug}")
def get_drop(slug: str, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        row = conn.execute("SELECT * FROM drops WHERE slug = ?", (slug,)).fetchone()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Drop not found")
        return _drop(conn, row, user)


@router.patch("/drops/{drop_id}")
def edit_drop(drop_id: int, body: DropPatch, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        row = _get_drop(conn, drop_id)
        require_manage(conn, user, row["artist_id"])
        changes = body.model_dump(exclude_unset=True)
        if changes.get("release_at") is not None:
            changes["release_at"] = _parse_time(changes["release_at"]).strftime(_DB_TIME)
        else:
            changes.pop("release_at", None)
        if "upload_id" in changes:
            _check_upload(conn, user, changes["upload_id"])
        for key in ("title", "description"):
            if changes.get(key) is not None:
                changes[key] = changes[key].strip()
            else:
                changes.pop(key, None)
        if changes:
            cols = ", ".join(f"{k} = ?" for k in changes)
            conn.execute(f"UPDATE drops SET {cols} WHERE id = ?", (*changes.values(), drop_id))
        return _drop(conn, _get_drop(conn, drop_id), user)


@router.delete("/drops/{drop_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_drop(drop_id: int, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        row = _get_drop(conn, drop_id)
        require_manage(conn, user, row["artist_id"])
        conn.execute("DELETE FROM drops WHERE id = ?", (drop_id,))
    if row["artwork"]:
        (_art_dir(request) / row["artwork"]).unlink(missing_ok=True)


@router.put("/drops/{drop_id}/presave", status_code=status.HTTP_204_NO_CONTENT)
def presave(drop_id: int, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        if _get_drop(conn, drop_id)["released_at"]:
            raise HTTPException(status.HTTP_409_CONFLICT, "This drop is already out")
        conn.execute("INSERT OR IGNORE INTO presaves (drop_id, user_id) VALUES (?, ?)", (drop_id, user["id"]))


@router.delete("/drops/{drop_id}/presave", status_code=status.HTTP_204_NO_CONTENT)
def unpresave(drop_id: int, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        _get_drop(conn, drop_id)
        conn.execute("DELETE FROM presaves WHERE drop_id = ? AND user_id = ?", (drop_id, user["id"]))


@router.post("/drops/{drop_id}/artwork")
async def drop_artwork(drop_id: int, request: Request, file: UploadFile = File(...), user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        row = _get_drop(conn, drop_id)
        require_manage(conn, user, row["artist_id"])
    data = await file.read(MAX_AVATAR_BYTES + 1)
    if len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Pick an image under 2 MB")
    suffix = next((ext for test, ext in _SIGNATURES if test(data[:16])), None)
    if suffix is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Use a PNG, JPEG or WebP image")
    folder = _art_dir(request)
    folder.mkdir(parents=True, exist_ok=True)
    name = secrets.token_hex(16) + suffix
    (folder / name).write_bytes(data)
    with request.app.state.db.connect() as conn:
        conn.execute("UPDATE drops SET artwork = ? WHERE id = ?", (name, drop_id))
    if row["artwork"]:
        (folder / row["artwork"]).unlink(missing_ok=True)
    return {"artwork_url": f"/api/drop-art/{name}"}


@router.get("/drop-art/{name}")
def get_drop_art(name: str, request: Request):
    """Public, so link previews on other sites can load it. Names are random and never reused."""
    path = _art_dir(request) / name
    if not _ART_NAME.match(name) or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such artwork")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})


_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · {artist} · Yaapu</title>
<meta name="description" content="{blurb}">
<meta property="og:type" content="music.song"><meta property="og:site_name" content="Yaapu">
<meta property="og:title" content="{title} · {artist}"><meta property="og:description" content="{blurb}">
<meta property="og:url" content="{url}">{image}
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url={app}">
<style>body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#F7F2FF;color:#19161F;font:16px/1.5 system-ui,sans-serif}}
main{{max-width:28rem;padding:24px;text-align:center}}img{{width:100%;border-radius:24px;border:3px solid #19161F}}
a{{display:inline-block;margin-top:16px;padding:12px 22px;border-radius:999px;background:#C6FF3D;color:#19161F;font-weight:700;text-decoration:none;border:2px solid #19161F}}</style>
</head><body><main>{img_tag}<h1>{title}</h1><p>{artist} · {when}</p><a href="{app}">Open in Yaapu</a></main></body></html>"""


@public.get("/s/{slug}", response_class=HTMLResponse)
def smart_link(slug: str, request: Request):
    """Public page for one release: carries the link-preview tags, then sends people into the app."""
    with request.app.state.db.connect() as conn:
        row = conn.execute("SELECT * FROM drops WHERE slug = ?", (slug,)).fetchone()
        if row is None:
            return HTMLResponse("<!doctype html><title>Not found</title><p>This link does not lead anywhere.</p>",
                                status_code=404)
        artist = artist_name(conn, row["artist_id"])

    def esc(value) -> str:
        return html.escape(str(value), quote=True)

    base = str(request.base_url).rstrip("/")
    art = f"{base}/api/drop-art/{row['artwork']}" if row["artwork"] else ""
    when = "Out now" if row["released_at"] else _utc(row["release_at"]).strftime("%d %b %Y, %H:%M UTC")
    return HTMLResponse(_PAGE.format(
        title=esc(row["title"]), artist=esc(artist), blurb=esc(row["description"] or f"{artist} · {when}"),
        when=esc(when), url=esc(f"{base}/s/{row['slug']}"), app=esc(f"/#/drop/{row['slug']}"),
        image=f'<meta property="og:image" content="{esc(art)}">' if art else "",
        img_tag=f'<img src="{esc(art)}" alt="">' if art else "",
    ))
