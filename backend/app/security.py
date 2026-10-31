"""Password hashing, JWTs, app passwords and login throttling."""

import base64
import hashlib
import secrets
import threading
import time
from collections import defaultdict, deque

import bcrypt
import jwt
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

ALGORITHM = "HS256"
ACCESS = "access"
STREAM = "stream"

_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def create_token(secret: str, user: dict, kind: str, ttl: int, sid: str | None = None) -> str:
    now = int(time.time())
    payload = {
        "sub": str(user["id"]),
        "name": user["username"],
        "ver": user.get("token_version", 0),
        "typ": kind,
        "iat": now,
        "exp": now + ttl,
    }
    if sid:
        payload["sid"] = sid  # ties the token to a device session, so revoking the device revokes it
    return jwt.encode(payload, secret, algorithm=ALGORITHM)


def decode_token(secret: str, token: str, kind: str) -> dict:
    try:
        payload = jwt.decode(token, secret, algorithms=[ALGORITHM], options={"require": ["exp", "sub", "typ"]})
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    if payload.get("typ") != kind:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong token type")
    return payload


def user_dict(row) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "is_admin": bool(row["is_admin"]),
        "can_upload": bool(row["is_admin"] or row["can_upload"]),
        "token_version": row["token_version"],
    }


def public_user(user: dict) -> dict:
    return {k: user[k] for k in ("id", "username", "is_admin", "can_upload")}


def _load_user(request: Request, payload: dict) -> dict:
    with request.app.state.db.connect() as conn:
        row = conn.execute(
            "SELECT id, username, is_admin, can_upload, token_version FROM users WHERE id = ?", (int(payload["sub"]),)
        ).fetchone()
        sid = payload.get("sid")
        revoked = sid is not None and conn.execute(
            "SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL", (sid, row["id"] if row else 0)
        ).fetchone() is None
    # A bumped token_version (password change, "sign out everywhere") or a revoked device
    # session invalidates tokens immediately, not when they expire.
    if row is None or revoked or row["token_version"] != payload.get("ver", 0):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired, please sign in again")
    return {**user_dict(row), "sid": sid}


def current_user(
    request: Request, creds: HTTPAuthorizationCredentials | None = Depends(_bearer)
) -> dict:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated", {"WWW-Authenticate": "Bearer"})
    payload = decode_token(request.app.state.settings.secret_key, creds.credentials, ACCESS)
    return _load_user(request, payload)


def admin_user(user: dict = Depends(current_user)) -> dict:
    if not user["is_admin"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    return user


def uploader_user(user: dict = Depends(current_user)) -> dict:
    """Admins, plus users an admin has given the uploader role. Their uploads still go to review."""
    if not user["can_upload"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't have upload access")
    return user


def stream_user(request: Request, t: str = Query(..., description="Stream token")) -> dict:
    """Media elements (<audio>, <img>) can't send headers, so they authenticate with a
    short-lived, stream-only token in the query string. The long-lived access token
    never appears in URLs or server logs."""
    payload = decode_token(request.app.state.settings.secret_key, t, STREAM)
    return _load_user(request, payload)


# ---- app passwords (for Subsonic clients) ------------------------------------------
# The Subsonic token scheme sends md5(password + salt), so the server must be able to
# recover the password. Users get a separate random app password for that, stored
# encrypted; their real password stays bcrypt-only and never leaves the web app.

def _fernet(secret_key: str) -> Fernet:
    key = hashlib.sha256(f"app-password:{secret_key}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def new_app_password() -> str:
    return secrets.token_urlsafe(18)


def encrypt_app_password(secret_key: str, password: str) -> str:
    return _fernet(secret_key).encrypt(password.encode()).decode()


def decrypt_app_password(secret_key: str, token: str | None) -> str | None:
    if not token:
        return None
    try:
        return _fernet(secret_key).decrypt(token.encode()).decode()
    except InvalidToken:
        return None


class LoginThrottle:
    """Sliding-window limit on failed logins per client IP + username."""

    def __init__(self, max_failures: int = 8, window: int = 300):
        self.max_failures = max_failures
        self.window = window
        self._failures: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> deque:
        q = self._failures[key]
        while q and q[0] < now - self.window:
            q.popleft()
        return q

    def check(self, key: str) -> None:
        with self._lock:
            q = self._prune(key, time.monotonic())
            if len(q) >= self.max_failures:
                retry = int(q[0] + self.window - time.monotonic()) + 1
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    "Too many failed attempts, try again later",
                    {"Retry-After": str(retry)},
                )

    def is_blocked(self, key: str) -> bool:
        with self._lock:
            return len(self._prune(key, time.monotonic())) >= self.max_failures

    def fail(self, key: str) -> None:
        with self._lock:
            self._prune(key, time.monotonic()).append(time.monotonic())

    def reset(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)


throttle = LoginThrottle()
