"""Upload ingestion API: resumable transfers, review queue, scheduling and takedowns.

Transfers use a small tus-style protocol so multi-gigabyte masters survive flaky connections:
    POST /api/uploads                 {filename, size}        -> upload id
    PUT  /api/uploads/{id}/content    Upload-Offset: n, body  -> bytes received so far
    GET  /api/uploads/{id}                                    -> resume from `received`
A PUT at the wrong offset gets 409 with the server's `received`, so the client just continues
from there. When the last byte lands the file is validated in the background.
"""

import asyncio
import json
import logging
import secrets
import shutil
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field, field_validator
from starlette.concurrency import run_in_threadpool
from starlette.requests import ClientDisconnect

from .. import ingest
from ..library import MIME_BY_EXT, read_cover
from ..security import admin_user, stream_user, uploader_user

router = APIRouter(prefix="/api", tags=["uploads"])
log = logging.getLogger(__name__)

MAX_CHUNK = 64 * 1024 * 1024
CHUNK_SIZE = 8 * 1024 * 1024
MAX_OPEN_PER_UPLOADER = 500  # unreviewed uploads per non-admin, so one account can't fill the disk
_locks: dict[str, asyncio.Lock] = {}


class NewUpload(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    size: int = Field(gt=0)
    publish: bool = False  # admins only: publish straight away if validation passes


class MetadataEdit(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    artist: str | None = Field(default=None, max_length=300)
    album: str | None = Field(default=None, max_length=300)
    album_artist: str | None = Field(default=None, max_length=300)
    genre: str | None = Field(default=None, max_length=100)
    year: str | None = Field(default=None, pattern=r"^(\d{4})?$")
    track_no: int | None = Field(default=None, ge=0, le=999)
    disc_no: int | None = Field(default=None, ge=0, le=99)

    @field_validator("title")
    @classmethod
    def title_required(cls, v):
        if v is not None and not v.strip():
            raise ValueError("Title can't be empty")
        return v


class Approve(BaseModel):
    release_at: datetime | None = None  # future time = scheduled release; empty = publish now


class Decline(BaseModel):
    note: str = Field(default="", max_length=2000)


_SELECT = """
SELECT up.*, u.username AS uploader, r.username AS reviewer FROM uploads up
LEFT JOIN users u ON u.id = up.user_id LEFT JOIN users r ON r.id = up.reviewer_id
"""


def _public(conn, row) -> dict:
    meta = json.loads(row["meta"] or "null")
    technical = None
    if meta:
        technical = {k: meta.get(k) for k in ("codec", "mime", "sample_rate", "bit_depth", "channels", "duration",
                                              "bitrate", "lossless", "has_cover", "has_lyrics")}
    return {
        "id": row["id"], "filename": row["filename"], "size": row["size"], "received": row["received"],
        "status": row["status"], "uploader": row["uploader"], "user_id": row["user_id"],
        "sha256": row["sha256"], "technical": technical,
        "metadata": ingest.effective_metadata(row) if meta else None,
        "edited": sorted(json.loads(row["edits"] or "{}")),
        "issues": json.loads(row["issues"] or "[]") + ingest.live_issues(conn, row),
        "release_at": row["release_at"], "reviewer": row["reviewer"], "review_note": row["review_note"],
        "reviewed_at": row["reviewed_at"], "track_id": row["track_id"], "published_at": row["published_at"],
        "created_at": row["created_at"], "updated_at": row["updated_at"],
    }


def _get(conn, upload_id: str, user: dict):
    row = conn.execute(f"{_SELECT} WHERE up.id = ?", (upload_id,)).fetchone()
    # Uploaders only ever see their own uploads; a 404 doesn't reveal that others exist.
    if row is None or (not user["is_admin"] and row["user_id"] != user["id"]):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Upload not found")
    return row


@router.post("/uploads", status_code=status.HTTP_201_CREATED)
def create_upload(body: NewUpload, request: Request, user: dict = Depends(uploader_user)):
    settings = request.app.state.settings
    filename = ingest.safe_name(body.filename.replace("\\", "/").rsplit("/", 1)[-1], "")
    if not filename or not ingest.allowed_extension(filename):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Unsupported file type. Allowed: {', '.join(sorted(MIME_BY_EXT))}")
    if body.size > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Files are limited to {settings.max_upload_mb} MB")
    settings.staging_dir.mkdir(parents=True, exist_ok=True)
    free = shutil.disk_usage(settings.staging_dir).free
    if free - body.size < settings.min_free_mb * 1024 * 1024:
        raise HTTPException(status.HTTP_507_INSUFFICIENT_STORAGE, "The server is out of storage space")
    upload_id = secrets.token_hex(16)
    with request.app.state.db.connect() as conn:
        if not user["is_admin"]:
            open_count = conn.execute(
                f"SELECT COUNT(*) FROM uploads WHERE user_id = ? AND status IN ({', '.join('?' * len(ingest.ACTIVE))})",
                (user["id"], *ingest.ACTIVE)).fetchone()[0]
            if open_count >= MAX_OPEN_PER_UPLOADER:
                raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                                    "Too many uploads waiting for review; wait for some to be reviewed")
        conn.execute(
            "INSERT INTO uploads (id, user_id, filename, size, status, auto_publish) VALUES (?, ?, ?, ?, ?, ?)",
            (upload_id, user["id"], filename, body.size, ingest.UPLOADING, int(body.publish and user["is_admin"])),
        )
        upload = _public(conn, _get(conn, upload_id, user))
    log.info("User %s started upload %s (%s, %d bytes)", user["username"], upload_id, filename, body.size)
    return {**upload, "chunk_size": CHUNK_SIZE}


@router.put("/uploads/{upload_id}/content")
async def upload_content(
    upload_id: str, request: Request, background: BackgroundTasks,
    offset: int = Header(alias="Upload-Offset", ge=0), user: dict = Depends(uploader_user),
):
    lock = _locks.setdefault(upload_id, asyncio.Lock())
    if lock.locked():
        raise HTTPException(status.HTTP_409_CONFLICT, "Another chunk of this upload is still being received")
    async with lock:
        state = request.app.state
        with state.db.connect() as conn:
            row = _get(conn, upload_id, user)
        if row["status"] != ingest.UPLOADING:
            raise HTTPException(status.HTTP_409_CONFLICT, "This upload is already complete")
        if offset != row["received"]:
            return JSONResponse({"detail": "Offset mismatch; resume from received", "received": row["received"]},
                                status_code=status.HTTP_409_CONFLICT)
        part = ingest.staged_path(state.settings, row)
        written = 0
        try:
            with part.open("r+b" if part.exists() else "wb") as f:
                f.seek(offset)
                f.truncate()  # drop whatever a previous, interrupted chunk left behind
                async for chunk in request.stream():
                    written += len(chunk)
                    if written > MAX_CHUNK or offset + written > row["size"]:
                        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Chunk exceeds the declared size")
                    f.write(chunk)
        except ClientDisconnect:
            return Response(status_code=499)  # nothing recorded; the client resumes from `received`
        received = offset + written
        done = received == row["size"]
        if done:
            part.replace(ingest.staged_path(state.settings, {**dict(row), "status": ingest.PROCESSING}))
        with state.db.connect() as conn:
            conn.execute("UPDATE uploads SET received = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                         (received, ingest.PROCESSING if done else ingest.UPLOADING, upload_id))
    if done:
        _locks.pop(upload_id, None)
        background.add_task(ingest.validate, state, upload_id)
    return {"received": received, "status": ingest.PROCESSING if done else ingest.UPLOADING}


@router.get("/uploads")
def list_uploads(
    request: Request, status_filter: str | None = Query(None, alias="status"),
    scope: str = Query("mine", pattern="^(mine|all)$"), limit: int = Query(200, ge=1, le=1000),
    user: dict = Depends(uploader_user),
):
    where, params = [], []
    if scope == "mine" or not user["is_admin"]:
        where.append("up.user_id = ?")
        params.append(user["id"])
    if status_filter:
        where.append("up.status = ?")
        params.append(status_filter)
    sql = f"{_SELECT} {'WHERE ' + ' AND '.join(where) if where else ''} ORDER BY up.created_at DESC, up.rowid DESC LIMIT ?"
    with request.app.state.db.connect() as conn:
        rows = conn.execute(sql, (*params, limit)).fetchall()
        counts_sql = "SELECT status, COUNT(*) AS n FROM uploads"
        counts_params = []
        if scope == "mine" or not user["is_admin"]:
            counts_sql += " WHERE user_id = ?"
            counts_params.append(user["id"])
        counts = {r["status"]: r["n"] for r in conn.execute(f"{counts_sql} GROUP BY status", counts_params)}
        return {"uploads": [_public(conn, r) for r in rows], "counts": counts}


@router.get("/uploads/{upload_id}")
def get_upload(upload_id: str, request: Request, user: dict = Depends(uploader_user)):
    with request.app.state.db.connect() as conn:
        return _public(conn, _get(conn, upload_id, user))


@router.patch("/uploads/{upload_id}")
def edit_metadata(upload_id: str, body: MetadataEdit, request: Request, user: dict = Depends(uploader_user)):
    """Fix tags before release. Uploaders can edit their own until approved; admins until published."""
    editable = (ingest.PENDING, ingest.INVALID) + ((ingest.SCHEDULED,) if user["is_admin"] else ())
    with request.app.state.db.connect() as conn:
        row = _get(conn, upload_id, user)
        if row["status"] not in editable or not row["meta"]:
            raise HTTPException(status.HTTP_409_CONFLICT, "This upload's tags can't be edited now")
        edits = json.loads(row["edits"] or "{}")
        original = json.loads(row["meta"])
        for name, value in body.model_dump(exclude_unset=True).items():
            value = value.strip() if isinstance(value, str) else value
            if value == original.get(name) or (value in ("", None) and not original.get(name)):
                edits.pop(name, None)  # back to what the file already says
            else:
                edits[name] = value
        conn.execute("UPDATE uploads SET edits = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                     (json.dumps(edits), upload_id))
        return _public(conn, _get(conn, upload_id, user))


@router.post("/uploads/{upload_id}/approve")
async def approve(upload_id: str, body: Approve, request: Request, admin: dict = Depends(admin_user)):
    state = request.app.state
    with state.db.connect() as conn:
        row = _get(conn, upload_id, admin)
        if row["status"] not in (ingest.PENDING, ingest.SCHEDULED):
            raise HTTPException(status.HTTP_409_CONFLICT, f"Can't approve an upload that is {row['status']}")
        release = body.release_at
        if release is not None:
            release = (release if release.tzinfo else release.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)
        if release and release > datetime.now(timezone.utc):
            conn.execute(
                """UPDATE uploads SET status = ?, release_at = ?, reviewer_id = ?, reviewed_at = CURRENT_TIMESTAMP,
                       updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
                (ingest.SCHEDULED, release.strftime("%Y-%m-%d %H:%M:%S"), admin["id"], upload_id),
            )
            log.info("Upload %s scheduled for %s by %s", upload_id, release.isoformat(), admin["username"])
            return _public(conn, _get(conn, upload_id, admin))
        conn.execute("UPDATE uploads SET reviewer_id = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?",
                     (admin["id"], upload_id))
    try:
        await run_in_threadpool(ingest.publish, state, upload_id, admin["id"])
    except ValueError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    with state.db.connect() as conn:
        return _public(conn, _get(conn, upload_id, admin))


@router.post("/uploads/{upload_id}/decline")
def decline(upload_id: str, body: Decline, request: Request, admin: dict = Depends(admin_user)):
    with request.app.state.db.connect() as conn:
        row = _get(conn, upload_id, admin)
        if row["status"] not in (ingest.PENDING, ingest.SCHEDULED, ingest.INVALID):
            raise HTTPException(status.HTTP_409_CONFLICT, f"Can't decline an upload that is {row['status']}")
        conn.execute(
            """UPDATE uploads SET status = ?, review_note = ?, reviewer_id = ?, reviewed_at = CURRENT_TIMESTAMP,
                   release_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?""",
            (ingest.DECLINED, body.note.strip(), admin["id"], upload_id),
        )
        log.info("Upload %s declined by %s", upload_id, admin["username"])
        return _public(conn, _get(conn, upload_id, admin))


@router.delete("/uploads/{upload_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_upload(upload_id: str, request: Request, user: dict = Depends(uploader_user)):
    """Withdraw or discard an unpublished upload. Published tracks are taken down instead."""
    state = request.app.state
    with state.db.connect() as conn:
        row = _get(conn, upload_id, user)
        if row["status"] in (ingest.PUBLISHED, ingest.PROCESSING):
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "Published tracks are removed with a takedown" if row["status"] == ingest.PUBLISHED
                                else "Wait for validation to finish")
        conn.execute("DELETE FROM uploads WHERE id = ?", (upload_id,))
    ingest.discard_file(state.settings, row)
    _locks.pop(upload_id, None)


def _staged_file(request: Request, upload_id: str, user: dict):
    state = request.app.state
    with state.db.connect() as conn:
        row = _get(conn, upload_id, user)
    path = ingest.staged_path(state.settings, row)
    if row["status"] in (ingest.UPLOADING, ingest.PUBLISHED, ingest.REMOVED) or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No staged file to preview")
    return row, path


@router.get("/uploads/{upload_id}/audio")
def preview_audio(upload_id: str, request: Request, user: dict = Depends(stream_user)):
    """Reviewers listen to the exact staged file, with range requests for seeking."""
    _row, path = _staged_file(request, upload_id, user)
    return FileResponse(path, media_type=MIME_BY_EXT[path.suffix], headers={"Cache-Control": "private, no-store"})


@router.get("/uploads/{upload_id}/cover")
def preview_cover(upload_id: str, request: Request, user: dict = Depends(stream_user)):
    _row, path = _staged_file(request, upload_id, user)
    cover = read_cover(path)
    if cover is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No cover art")
    data, mime = cover
    return Response(data, media_type=mime, headers={"Cache-Control": "private, max-age=300"})


@router.delete("/tracks/{track_id}", status_code=status.HTTP_204_NO_CONTENT)
async def take_down(track_id: str, request: Request, admin: dict = Depends(admin_user)):
    """Takedown: the track disappears for everyone; the file is kept in REMOVED_DIR for recovery."""
    try:
        await run_in_threadpool(ingest.takedown, request.app.state, track_id, admin["id"])
    except LookupError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Track not found")
