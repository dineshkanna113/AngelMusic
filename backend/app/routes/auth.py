import secrets
import sqlite3
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from .. import ingest

from ..security import (
    ACCESS,
    STREAM,
    create_token,
    current_user,
    decrypt_app_password,
    encrypt_app_password,
    hash_password,
    hash_secret,
    new_app_password,
    public_user,
    throttle,
    user_dict,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# A real hash so unknown usernames take as long to reject as wrong passwords.
_DUMMY_HASH = hash_password("timing-equaliser")

USERNAME = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_.\-]+$")
PASSWORD = Field(min_length=8, max_length=128)


REFRESH_GRACE_SECONDS = 60
DEVICE = Field(default=None, max_length=120, description="Shown in the sessions list, e.g. 'Pixel 8 · AngelStream 1.2'")


class Credentials(BaseModel):
    username: str = USERNAME
    password: str = PASSWORD
    device: str | None = DEVICE


class LoginBody(BaseModel):
    username: str = Field(max_length=32)
    password: str = Field(max_length=128)
    device: str | None = DEVICE


class RefreshBody(BaseModel):
    refresh_token: str = Field(max_length=200)


class DeleteAccount(BaseModel):
    password: str = Field(max_length=128)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = PASSWORD


def _sql_time(delta_seconds: int = 0) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=delta_seconds)).strftime("%Y-%m-%d %H:%M:%S")


def _device(request: Request, device: str | None) -> str:
    return (device or request.headers.get("user-agent", ""))[:120]


def _tokens(request: Request, user: dict, sid: str, secret: str) -> dict:
    settings = request.app.state.settings
    return {
        "access_token": create_token(settings.secret_key, user, ACCESS, settings.access_token_ttl, sid),
        "token_type": "bearer",
        "expires_in": settings.access_token_ttl,
        "refresh_token": f"{sid}.{secret}",
        "refresh_expires_in": settings.refresh_token_ttl,
        "session_id": sid,
        "user": public_user(user),
    }


def _session(request: Request, user: dict, device: str | None = None) -> dict:
    """Start a device session: a short-lived access token plus a rotating refresh token."""
    sid, secret = secrets.token_urlsafe(12), secrets.token_urlsafe(32)
    with request.app.state.db.connect() as conn:
        conn.execute(
            "INSERT INTO sessions (id, user_id, secret_hash, device, expires_at) VALUES (?, ?, ?, ?, ?)",
            (sid, user["id"], hash_secret(secret), _device(request, device),
             _sql_time(request.app.state.settings.refresh_token_ttl)),
        )
    return _tokens(request, user, sid, secret)


def _user_row(conn, user_id: int):
    return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


@router.get("/status")
def auth_status(request: Request):
    with request.app.state.db.connect() as conn:
        has_users = conn.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None
    return {"has_users": has_users, "registration_open": registration_open(request.app.state.settings, has_users)}


def registration_open(settings, has_users: bool) -> bool:
    # On a public production server the first account (the admin) is created from the shell
    # with `python -m app.manage create-user --admin`, so a stranger can't claim it first.
    if not has_users:
        return not settings.is_production
    return settings.allow_registration


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(body: Credentials, request: Request):
    db = request.app.state.db
    with db.connect() as conn:
        has_users = conn.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None
        if not registration_open(request.app.state.settings, has_users):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Registration is closed")
        try:
            cur = conn.execute(
                "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)",
                (body.username, hash_password(body.password), int(not has_users)),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status.HTTP_409_CONFLICT, "Username already taken")
        row = _user_row(conn, cur.lastrowid)
    return _session(request, user_dict(row), body.device)


@router.post("/login")
def login(body: LoginBody, request: Request):
    key = f"{request.client.host if request.client else '?'}:{body.username.lower()}"
    throttle.check(key)
    with request.app.state.db.connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (body.username,)).fetchone()
    if not verify_password(body.password, row["password_hash"] if row else _DUMMY_HASH) or row is None:
        throttle.fail(key)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect username or password")
    throttle.reset(key)
    return _session(request, user_dict(row), body.device)


@router.post("/refresh")
def refresh(body: RefreshBody, request: Request):
    """Swap a refresh token for a new access token and a new refresh token.

    Refresh tokens are single-use. Presenting one that was already rotated means it was
    copied, so the whole device session is revoked and that device must sign in again.
    The one exception is the token rotated in the last minute: phones often fire two
    refreshes at once (app resume, parallel requests), and that race must not sign them out."""
    sid, _, secret = body.refresh_token.partition(".")
    presented = hash_secret(secret)
    with request.app.state.db.connect() as conn:
        row = conn.execute(
            """SELECT s.*, u.id AS uid, s.rotated_at > ? AS recent FROM sessions s JOIN users u ON u.id = s.user_id
               WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ?""",
            (_sql_time(-REFRESH_GRACE_SECONDS), sid, _sql_time()),
        ).fetchone()
        current = row is not None and secrets.compare_digest(row["secret_hash"], presented)
        racing = row is not None and bool(row["recent"]) and secrets.compare_digest(row["prev_hash"] or "", presented)
        reused = row is not None and not current and not racing
        if reused:
            conn.execute("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?", (sid,))
    # Raised outside the transaction so the revocation above is committed, not rolled back.
    if row is None or reused:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired, please sign in again")
    with request.app.state.db.connect() as conn:
        new_secret = secrets.token_urlsafe(32)
        conn.execute(
            """UPDATE sessions SET secret_hash = ?, prev_hash = ?, rotated_at = CURRENT_TIMESTAMP,
                   last_used_at = CURRENT_TIMESTAMP, expires_at = ? WHERE id = ?""",
            (hash_secret(new_secret), row["secret_hash"] if current else row["prev_hash"],
             _sql_time(request.app.state.settings.refresh_token_ttl), sid),
        )
        user = user_dict(_user_row(conn, row["uid"]))
    return _tokens(request, user, sid, new_secret)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, user: dict = Depends(current_user)):
    """Sign this device out: its refresh token and access tokens stop working."""
    if user.get("sid"):
        with request.app.state.db.connect() as conn:
            conn.execute("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?", (user["sid"],))


@router.get("/sessions")
def list_sessions(request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        rows = conn.execute(
            """SELECT id, device, created_at, last_used_at FROM sessions
               WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_used_at DESC""",
            (user["id"], _sql_time()),
        ).fetchall()
    return {"sessions": [{**dict(r), "current": r["id"] == user.get("sid")} for r in rows]}


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session(session_id: str, request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        cur = conn.execute(
            "UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
            (session_id, user["id"]),
        )
    if cur.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(body: DeleteAccount, request: Request, user: dict = Depends(current_user)):
    """Self-service account deletion (required by the App Store and Play Store).

    Favorites, playlists, history and sessions go with the account. Music the user uploaded
    that is already live stays in the shared library; their unpublished uploads are deleted."""
    state = request.app.state
    with state.db.connect() as conn:
        row = _user_row(conn, user["id"])
        if not verify_password(body.password, row["password_hash"]):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Password is incorrect")
        if row["is_admin"] and conn.execute("SELECT COUNT(*) FROM users WHERE is_admin").fetchone()[0] <= 1:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Make another user an admin before deleting the only admin")
        staged = conn.execute(
            f"SELECT * FROM uploads WHERE user_id = ? AND status IN ({', '.join('?' * len(ingest.ACTIVE))})",
            (user["id"], *ingest.ACTIVE),
        ).fetchall()
        conn.execute("DELETE FROM uploads WHERE user_id = ? AND status IN ({})".format(", ".join("?" * len(ingest.ACTIVE))),
                     (user["id"], *ingest.ACTIVE))
        conn.execute("DELETE FROM users WHERE id = ?", (user["id"],))
    for upload in staged:
        ingest.discard_file(state.settings, upload)


@router.get("/me")
def me(user: dict = Depends(current_user)):
    return public_user(user)


@router.post("/stream-token")
def stream_token(request: Request, user: dict = Depends(current_user)):
    settings = request.app.state.settings
    return {
        "token": create_token(settings.secret_key, user, STREAM, settings.stream_token_ttl, user.get("sid")),
        "expires_in": settings.stream_token_ttl,
    }


@router.post("/password")
def change_password(body: PasswordChange, request: Request, user: dict = Depends(current_user)):
    """Changing the password signs out every other session; a fresh one is returned."""
    with request.app.state.db.connect() as conn:
        row = _user_row(conn, user["id"])
        if not verify_password(body.current_password, row["password_hash"]):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
        conn.execute(
            "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?",
            (hash_password(body.new_password), user["id"]),
        )
        conn.execute("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL",
                     (user["id"],))
        row = _user_row(conn, user["id"])
    return _session(request, user_dict(row), _device(request, None))


@router.post("/logout-all")
def logout_all(request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        conn.execute("UPDATE users SET token_version = token_version + 1 WHERE id = ?", (user["id"],))
        conn.execute("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL",
                     (user["id"],))
    return {"status": "ok"}


@router.get("/app-password")
def get_app_password(request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        row = _user_row(conn, user["id"])
    return {"app_password": decrypt_app_password(request.app.state.settings.secret_key, row["app_password_enc"])}


@router.post("/app-password")
def regenerate_app_password(request: Request, user: dict = Depends(current_user)):
    password = new_app_password()
    with request.app.state.db.connect() as conn:
        conn.execute(
            "UPDATE users SET app_password_enc = ? WHERE id = ?",
            (encrypt_app_password(request.app.state.settings.secret_key, password), user["id"]),
        )
    return {"app_password": password}


@router.delete("/app-password", status_code=status.HTTP_204_NO_CONTENT)
def revoke_app_password(request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        conn.execute("UPDATE users SET app_password_enc = NULL WHERE id = ?", (user["id"],))
