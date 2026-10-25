import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from ..security import (
    ACCESS,
    STREAM,
    create_token,
    current_user,
    decrypt_app_password,
    encrypt_app_password,
    hash_password,
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


class Credentials(BaseModel):
    username: str = USERNAME
    password: str = PASSWORD


class LoginBody(BaseModel):
    username: str = Field(max_length=32)
    password: str = Field(max_length=128)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = PASSWORD


def _session(request: Request, user: dict) -> dict:
    settings = request.app.state.settings
    return {
        "access_token": create_token(settings.secret_key, user, ACCESS, settings.access_token_ttl),
        "token_type": "bearer",
        "expires_in": settings.access_token_ttl,
        "user": public_user(user),
    }


def _user_row(conn, user_id: int):
    return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


@router.get("/status")
def auth_status(request: Request):
    with request.app.state.db.connect() as conn:
        has_users = conn.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None
    return {"has_users": has_users, "registration_open": request.app.state.settings.allow_registration or not has_users}


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(body: Credentials, request: Request):
    db = request.app.state.db
    with db.connect() as conn:
        has_users = conn.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None
        if has_users and not request.app.state.settings.allow_registration:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Registration is closed")
        try:
            cur = conn.execute(
                "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)",
                (body.username, hash_password(body.password), int(not has_users)),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status.HTTP_409_CONFLICT, "Username already taken")
        row = _user_row(conn, cur.lastrowid)
    return _session(request, user_dict(row))


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
    return _session(request, user_dict(row))


@router.get("/me")
def me(user: dict = Depends(current_user)):
    return public_user(user)


@router.post("/stream-token")
def stream_token(request: Request, user: dict = Depends(current_user)):
    settings = request.app.state.settings
    return {
        "token": create_token(settings.secret_key, user, STREAM, settings.stream_token_ttl),
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
        row = _user_row(conn, user["id"])
    return _session(request, user_dict(row))


@router.post("/logout-all")
def logout_all(request: Request, user: dict = Depends(current_user)):
    with request.app.state.db.connect() as conn:
        conn.execute("UPDATE users SET token_version = token_version + 1 WHERE id = ?", (user["id"],))
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
