from dataclasses import replace

from fastapi.testclient import TestClient

from app.main import create_app
from app.manage import main as manage

from .conftest import register


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_refresh_rotates_and_detects_reuse(client):
    session = client.post("/api/auth/register", json={"username": "admin", "password": "correct-horse",
                                                      "device": "Pixel 8 · AngelMusic 1.0"}).json()
    assert session["refresh_token"] and session["expires_in"] == 3600
    first = session["refresh_token"]
    new = client.post("/api/auth/refresh", json={"refresh_token": first})
    assert new.status_code == 200
    second = new.json()["refresh_token"]
    assert second != first and client.get("/api/auth/me", headers=bearer(new.json()["access_token"])).status_code == 200
    # Two refreshes racing with the same token (seconds apart) both succeed.
    raced = client.post("/api/auth/refresh", json={"refresh_token": first})
    assert raced.status_code == 200
    second = raced.json()["refresh_token"]
    # Replaying a token rotated more than a minute ago means it was copied: the session is killed.
    with client.app.state.db.connect() as conn:
        conn.execute("UPDATE sessions SET rotated_at = '2000-01-01 00:00:00'")
    assert client.post("/api/auth/refresh", json={"refresh_token": first}).status_code == 401
    assert client.post("/api/auth/refresh", json={"refresh_token": second}).status_code == 401
    assert client.get("/api/auth/me", headers=bearer(new.json()["access_token"])).status_code == 401


def test_sessions_list_and_revoke(client):
    register(client)
    phone = client.post("/api/auth/login", json={"username": "admin", "password": "correct-horse", "device": "iPhone"}).json()
    laptop = client.post("/api/auth/login", json={"username": "admin", "password": "correct-horse", "device": "Laptop"}).json()
    sessions = client.get("/api/auth/sessions", headers=bearer(laptop["access_token"])).json()["sessions"]
    assert {s["device"] for s in sessions} >= {"iPhone", "Laptop"}
    assert [s["current"] for s in sessions if s["device"] == "Laptop"] == [True]
    # Signing the phone out from the laptop cuts its access token off immediately.
    phone_id = next(s["id"] for s in sessions if s["device"] == "iPhone")
    assert client.delete(f"/api/auth/sessions/{phone_id}", headers=bearer(laptop["access_token"])).status_code == 204
    assert client.get("/api/auth/me", headers=bearer(phone["access_token"])).status_code == 401
    assert client.post("/api/auth/refresh", json={"refresh_token": phone["refresh_token"]}).status_code == 401
    assert client.post("/api/auth/logout", headers=bearer(laptop["access_token"])).status_code == 204
    assert client.get("/api/auth/me", headers=bearer(laptop["access_token"])).status_code == 401


def test_delete_account(client):
    admin = register(client).json()
    client.post("/api/users", json={"username": "fan", "password": "fan-pass-1"}, headers=bearer(admin["access_token"]))
    fan = client.post("/api/auth/login", json={"username": "fan", "password": "fan-pass-1"}).json()
    h = bearer(fan["access_token"])
    assert client.request("DELETE", "/api/auth/account", json={"password": "wrong-pass"}, headers=h).status_code == 400
    assert client.request("DELETE", "/api/auth/account", json={"password": "fan-pass-1"}, headers=h).status_code == 204
    assert client.post("/api/auth/login", json={"username": "fan", "password": "fan-pass-1"}).status_code == 401
    # The only admin can't delete themselves and leave the server unmanageable.
    res = client.request("DELETE", "/api/auth/account", json={"password": "correct-horse"},
                         headers=bearer(admin["access_token"]))
    assert res.status_code == 400


def test_config_health_etag_and_request_id(client):
    cfg = client.get("/api/config").json()
    assert cfg["api_version"] == 1 and cfg["min_app_version"] and "uploads" in cfg["features"]
    health = client.get("/api/health")
    assert health.json()["status"] == "ok" and health.headers["x-request-id"]
    assert client.get("/api/health", headers={"X-Request-ID": "abc123"}).headers["x-request-id"] == "abc123"
    h = bearer(register(client).json()["access_token"])
    first = client.get("/api/tracks", headers=h)
    assert first.status_code == 200 and first.headers["etag"]
    again = client.get("/api/tracks", headers={**h, "If-None-Match": first.headers["etag"]})
    assert again.status_code == 304 and not again.content
    client.post("/api/history", json={"track_id": first.json()["tracks"][0]["id"]}, headers=h)
    assert client.get("/api/tracks", headers={**h, "If-None-Match": first.headers["etag"]}).status_code == 200


def test_production_first_admin_comes_from_cli(client, tmp_path, monkeypatch):
    settings = replace(client.app.state.settings, env="production", database_path=tmp_path / "prod.db")
    with TestClient(create_app(settings)) as prod:
        assert prod.get("/api/auth/status").json() == {"has_users": False, "registration_open": False}
        assert register(prod).status_code == 403
        monkeypatch.setattr("app.manage.load_settings", lambda: settings)
        monkeypatch.setattr("sys.stdin", __import__("io").StringIO("a-strong-password\n"))
        manage(["create-user", "owner", "--admin", "--password-stdin"])
        res = prod.post("/api/auth/login", json={"username": "owner", "password": "a-strong-password"})
        assert res.status_code == 200 and res.json()["user"]["is_admin"] is True


def test_cli_backup(client, tmp_path, monkeypatch):
    register(client)
    monkeypatch.setattr("app.manage.load_settings", lambda: client.app.state.settings)
    manage(["backup", str(tmp_path / "backups" / "copy.db")])
    import sqlite3
    with sqlite3.connect(tmp_path / "backups" / "copy.db") as conn:
        assert conn.execute("SELECT username FROM users").fetchall() == [("admin",)]
