"""Admin-only user management."""

import sqlite3
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from ..security import admin_user, hash_password
from .auth import PASSWORD, USERNAME

router = APIRouter(prefix="/api/users", tags=["users"])


class NewUser(BaseModel):
    username: str = USERNAME
    password: str = PASSWORD
    is_admin: bool = False
    can_upload: bool = False


class UserPatch(BaseModel):
    password: str | None = Field(default=None, min_length=8, max_length=128)
    is_admin: bool | None = None
    can_upload: bool | None = None  # uploader role: may submit music for review


def _public(row) -> dict:
    return {"id": row["id"], "username": row["username"], "is_admin": bool(row["is_admin"]),
            "can_upload": bool(row["is_admin"] or row["can_upload"]), "created_at": row["created_at"],
            "comp_until": row["comp_until"]}


class PremiumGrant(BaseModel):
    until: str | None = None  # a date or ISO time; null removes the grant


@router.put("/{user_id}/premium")
def grant_premium(user_id: int, body: PremiumGrant, request: Request, _admin: dict = Depends(admin_user)):
    """Give a user Premium without Stripe (beta testers, artists, press) until a date, or clear it."""
    until = None
    if body.until is not None:
        try:
            parsed = datetime.fromisoformat(body.until.replace("Z", "+00:00")) if "T" in body.until else datetime.combine(date.fromisoformat(body.until), datetime.min.time())
        except ValueError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Use a date like 2027-01-31")
        until = (parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed).strftime("%Y-%m-%d %H:%M:%S")
    with request.app.state.db.connect() as conn:
        if conn.execute("UPDATE users SET comp_until = ? WHERE id = ?", (until, user_id)).rowcount == 0:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
        return _public(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())


def _admin_count(conn) -> int:
    return conn.execute("SELECT COUNT(*) FROM users WHERE is_admin").fetchone()[0]


@router.get("")
def list_users(request: Request, _admin: dict = Depends(admin_user)):
    with request.app.state.db.connect() as conn:
        return {"users": [_public(r) for r in conn.execute("SELECT * FROM users ORDER BY username COLLATE NOCASE")]}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_user(body: NewUser, request: Request, _admin: dict = Depends(admin_user)):
    with request.app.state.db.connect() as conn:
        try:
            cur = conn.execute("INSERT INTO users (username, password_hash, is_admin, can_upload) VALUES (?, ?, ?, ?)",
                               (body.username, hash_password(body.password), int(body.is_admin), int(body.can_upload)))
        except sqlite3.IntegrityError:
            raise HTTPException(status.HTTP_409_CONFLICT, "Username already taken")
        return _public(conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone())


@router.patch("/{user_id}")
def update_user(user_id: int, body: UserPatch, request: Request, admin: dict = Depends(admin_user)):
    with request.app.state.db.connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
        if body.is_admin is False and row["is_admin"] and _admin_count(conn) <= 1:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Can't remove the last admin")
        if body.is_admin is not None:
            conn.execute("UPDATE users SET is_admin = ? WHERE id = ?", (int(body.is_admin), user_id))
        if body.can_upload is not None:
            conn.execute("UPDATE users SET can_upload = ? WHERE id = ?", (int(body.can_upload), user_id))
        if body.password is not None:
            # Resetting a password signs that user out everywhere.
            conn.execute("UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?",
                         (hash_password(body.password), user_id))
            conn.execute("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL",
                         (user_id,))
        return _public(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: int, request: Request, admin: dict = Depends(admin_user)):
    if user_id == admin["id"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can't delete your own account here")
    with request.app.state.db.connect() as conn:
        if conn.execute("DELETE FROM users WHERE id = ?", (user_id,)).rowcount == 0:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
