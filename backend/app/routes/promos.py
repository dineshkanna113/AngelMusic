"""House promos: small admin-written cards shown to Free users on Home and Browse. Premium users and
servers with billing off never get any. There is no ad network and no audio ads."""

import re
import secrets
from datetime import date, datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .. import entitlements
from ..security import admin_user, current_user
from .social import _SIGNATURES, MAX_AVATAR_BYTES

router = APIRouter(prefix="/api", tags=["promos"])

MAX_SHOWN = 3
_ART_NAME = re.compile(r"^[0-9a-f]{32}\.(png|jpg|webp)$")
_TIME = "%Y-%m-%d %H:%M:%S"


class PromoBody(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    body: str = Field("", max_length=200)
    link: str | None = None
    active: bool = True
    starts_at: str | None = None
    ends_at: str | None = None


class PromoPatch(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=80)
    body: str | None = Field(None, max_length=200)
    link: str | None = None
    active: bool | None = None
    starts_at: str | None = None
    ends_at: str | None = None


def _art_dir(request: Request) -> Path:
    return request.app.state.settings.database_path.parent / "promo-art"


def _link(value: str | None) -> str | None:
    """Only https links or routes inside the app. Anything else (javascript:, data:, http:, //host) is refused."""
    if value is None or value == "":
        return None
    value = value.strip()
    if (value.startswith("https://") and len(value) > 8 and " " not in value) or re.fullmatch(r"#/[\w\-./%?=&]*", value):
        return value
    raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Use an https:// link or a route inside the app like #/browse")


def _time(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    try:
        parsed = (datetime.fromisoformat(value.replace("Z", "+00:00")) if "T" in value
                  else datetime.combine(date.fromisoformat(value), datetime.min.time()))
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Use a date like 2027-01-31")
    return (parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed).strftime(_TIME)


def _public(row) -> dict:
    return {"id": row["id"], "title": row["title"], "body": row["body"], "link": row["link"],
            "image_url": f"/api/promo-art/{row['image']}" if row["image"] else None, "active": bool(row["active"]),
            "starts_at": row["starts_at"], "ends_at": row["ends_at"]}


def _get(conn, promo_id: int):
    row = conn.execute("SELECT * FROM promos WHERE id = ?", (promo_id,)).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Promo not found")
    return row


def _check_window(starts, ends) -> None:
    if starts and ends and starts >= ends:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The end must come after the start")


@router.get("/promos")
def promos(request: Request, user: dict = Depends(current_user)):
    """Promos for this user: up to three live ones on the Free plan, none for Premium or when billing is off."""
    state = request.app.state
    with state.db.connect() as conn:
        if entitlements.is_premium(conn, state.settings, user["id"]):
            return {"promos": []}
        rows = conn.execute(
            """SELECT * FROM promos WHERE active = 1 AND (starts_at IS NULL OR starts_at <= datetime('now'))
               AND (ends_at IS NULL OR ends_at > datetime('now')) ORDER BY id DESC LIMIT ?""", (MAX_SHOWN,)).fetchall()
        return {"promos": [_public(r) for r in rows]}


@router.get("/promos/all")
def all_promos(request: Request, _admin: dict = Depends(admin_user)):
    with request.app.state.db.connect() as conn:
        return {"promos": [_public(r) for r in conn.execute("SELECT * FROM promos ORDER BY id DESC")]}


@router.post("/promos", status_code=status.HTTP_201_CREATED)
def create_promo(body: PromoBody, request: Request, _admin: dict = Depends(admin_user)):
    link, starts, ends = _link(body.link), _time(body.starts_at), _time(body.ends_at)
    _check_window(starts, ends)
    with request.app.state.db.connect() as conn:
        cur = conn.execute("INSERT INTO promos (title, body, link, active, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)",
                           (body.title.strip(), body.body.strip(), link, int(body.active), starts, ends))
        return _public(_get(conn, cur.lastrowid))


@router.patch("/promos/{promo_id}")
def edit_promo(promo_id: int, body: PromoPatch, request: Request, _admin: dict = Depends(admin_user)):
    changes = body.model_dump(exclude_unset=True)
    if "link" in changes:
        changes["link"] = _link(changes["link"])
    for key in ("starts_at", "ends_at"):
        if key in changes:
            changes[key] = _time(changes[key])
    for key in ("title", "body"):
        if key in changes and changes[key] is None:
            changes.pop(key)
        elif key in changes:
            changes[key] = changes[key].strip()
    if "active" in changes:
        changes["active"] = int(bool(changes["active"]))
    with request.app.state.db.connect() as conn:
        row = _get(conn, promo_id)
        _check_window(changes.get("starts_at", row["starts_at"]), changes.get("ends_at", row["ends_at"]))
        if changes:
            conn.execute(f"UPDATE promos SET {', '.join(f'{k} = ?' for k in changes)} WHERE id = ?", (*changes.values(), promo_id))
        return _public(_get(conn, promo_id))


@router.delete("/promos/{promo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_promo(promo_id: int, request: Request, _admin: dict = Depends(admin_user)):
    with request.app.state.db.connect() as conn:
        row = _get(conn, promo_id)
        conn.execute("DELETE FROM promos WHERE id = ?", (promo_id,))
    if row["image"]:
        (_art_dir(request) / row["image"]).unlink(missing_ok=True)


@router.post("/promos/{promo_id}/image")
async def promo_image(promo_id: int, request: Request, file: UploadFile = File(...), _admin: dict = Depends(admin_user)):
    with request.app.state.db.connect() as conn:
        row = _get(conn, promo_id)
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
        conn.execute("UPDATE promos SET image = ? WHERE id = ?", (name, promo_id))
    if row["image"]:
        (folder / row["image"]).unlink(missing_ok=True)
    return {"image_url": f"/api/promo-art/{name}"}


@router.get("/promo-art/{name}")
def promo_art(name: str, request: Request):
    path = _art_dir(request) / name
    if not _ART_NAME.match(name) or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such image")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})
