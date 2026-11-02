from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

from .conftest import auth_headers, login_headers, tracks, write_wav


@pytest.fixture
def studio(client, audio_dir):
    """admin, an artist-owner ('artist'), and a plain fan; two tracks by 'Artist Name'."""
    write_wav(audio_dir / "Album" / "04 - Artist Name - Second Song.wav")
    client.app.state.library.scan()
    admin = auth_headers(client)
    for name in ("artist", "fan", "ghost"):
        client.post("/api/users", json={"username": name, "password": f"{name}-pass-1"}, headers=admin)
    h = {n: login_headers(client, n, f"{n}-pass-1") for n in ("artist", "fan", "ghost")}
    artist_id = client.get("/api/artists", headers=admin).json()["artists"][0]["id"]
    assert client.put(f"/api/artists/{artist_id}/owners/artist", headers=admin).status_code == 204
    return {"admin": admin, **h, "artist_id": artist_id}


def play(client, h, title, times=1, headers=None):
    tid = next(t["id"] for t in tracks(client, h) if t["title"] == title)
    for _ in range(times):
        client.post("/api/history", json={"track_id": tid}, headers={**h, **(headers or {})})
    return tid


def test_owner_grants_are_admin_only_and_idempotent(client, studio):
    aid = studio["artist_id"]
    assert client.put(f"/api/artists/{aid}/owners/fan", headers=studio["artist"]).status_code == 403
    assert client.put(f"/api/artists/{aid}/owners/fan", headers=studio["admin"]).status_code == 204
    assert client.put(f"/api/artists/{aid}/owners/fan", headers=studio["admin"]).status_code == 204
    assert client.put(f"/api/artists/{aid}/owners/nobody", headers=studio["admin"]).status_code == 404
    assert client.put("/api/artists/nope/owners/fan", headers=studio["admin"]).status_code == 404
    assert client.delete(f"/api/artists/{aid}/owners/fan", headers=studio["admin"]).status_code == 204
    assert client.delete(f"/api/artists/{aid}/owners/fan", headers=studio["admin"]).status_code == 204


def test_studio_lists_managed_artists_and_can_manage(client, studio):
    aid = studio["artist_id"]
    assert [a["id"] for a in client.get("/api/studio", headers=studio["artist"]).json()["artists"]] == [aid]
    assert client.get("/api/studio", headers=studio["fan"]).json()["artists"] == []
    assert client.get(f"/api/artists/{aid}", headers=studio["artist"]).json()["can_manage"] is True
    assert client.get(f"/api/artists/{aid}", headers=studio["admin"]).json()["can_manage"] is True
    assert client.get(f"/api/artists/{aid}", headers=studio["fan"]).json()["can_manage"] is False


def test_owner_can_edit_bio_stranger_cannot(client, studio):
    aid = studio["artist_id"]
    assert client.put(f"/api/artists/{aid}/bio", json={"bio": "mine"}, headers=studio["fan"]).status_code == 403
    assert client.put(f"/api/artists/{aid}/bio", json={"bio": "Hello"}, headers=studio["artist"]).json()["bio"] == "Hello"


def test_stats_permissions(client, studio):
    aid = studio["artist_id"]
    assert client.get(f"/api/artists/{aid}/stats", headers=studio["fan"]).status_code == 403
    assert client.get("/api/artists/nope/stats", headers=studio["fan"]).status_code == 404
    assert client.get(f"/api/artists/{aid}/stats", headers=studio["artist"]).status_code == 200
    assert client.get(f"/api/artists/{aid}/stats", headers=studio["admin"]).status_code == 200


def test_stats_counts_listeners_series_and_tracks(client, studio):
    aid = studio["artist_id"]
    play(client, studio["fan"], "Second Song", 3)
    play(client, studio["ghost"], "Second Song", 1)
    play(client, studio["fan"], "Song Title", 1)
    client.put(f"/api/artists/{aid}/follow", headers=studio["fan"])
    s = client.get(f"/api/artists/{aid}/stats?days=7", headers=studio["artist"]).json()
    assert (s["plays"], s["listeners"], s["followers"], s["days"]) == (5, 2, 1, 7)
    assert len(s["series"]) == 7 and s["series"][-1]["plays"] == 5 and sum(d["plays"] for d in s["series"]) == 5
    assert [(t["title"], t["plays"]) for t in s["top_tracks"]] == [("Second Song", 4), ("Song Title", 1)]
    with client.app.state.db.connect() as conn:  # plays outside the window don't count
        conn.execute("UPDATE plays SET played_at = datetime('now', '-40 days') WHERE id = 1")
    assert client.get(f"/api/artists/{aid}/stats?days=30", headers=studio["artist"]).json()["plays"] == 4
    assert client.get(f"/api/artists/{aid}/stats?days=0", headers=studio["artist"]).status_code == 422


def test_top_fans_respect_privacy(client, studio):
    aid = studio["artist_id"]
    play(client, studio["fan"], "Second Song", 3)
    play(client, studio["ghost"], "Second Song", 2)
    client.patch("/api/me/profile", json={"share_activity": False}, headers=studio["ghost"])
    stats = client.get(f"/api/artists/{aid}/stats", headers=studio["artist"]).json()["top_fans"]
    assert [(f["person"] and f["person"]["username"], f["plays"]) for f in stats] == [("fan", 3), (None, 2)]
    public = client.get(f"/api/artists/{aid}", headers=studio["fan"]).json()["top_fans"]
    assert [(f["person"]["username"], f["plays"]) for f in public] == [("fan", 3)]  # anonymous fans are not listed publicly
    client.patch("/api/me/profile", json={"is_private": True}, headers=studio["fan"])
    assert client.get(f"/api/artists/{aid}", headers=studio["ghost"]).json()["top_fans"] == []


def test_location_only_from_trusted_headers(client, studio, tmp_path):
    aid = studio["artist_id"]
    geo = {"CloudFront-Viewer-Country": "IN", "CloudFront-Viewer-City": "Chennai"}
    play(client, studio["fan"], "Second Song", 2, headers=geo)  # headers ignored: not trusted
    s = client.get(f"/api/artists/{aid}/stats", headers=studio["artist"]).json()
    assert s["countries"] == [] and s["cities"] == []

    trusted = replace(client.app.state.settings, trust_geo_headers=True, database_path=client.app.state.settings.database_path)
    with TestClient(create_app(trusted)) as c2:
        admin = login_headers(c2, "admin", "correct-horse")
        fan = login_headers(c2, "fan", "fan-pass-1")
        play(c2, fan, "Second Song", 2, headers=geo)
        play(c2, fan, "Second Song", 1, headers={"CloudFront-Viewer-Country": "us"})
        s = c2.get(f"/api/artists/{aid}/stats", headers=admin).json()
        assert s["countries"] == [{"name": "IN", "plays": 2}, {"name": "US", "plays": 1}]
        assert s["cities"] == [{"name": "Chennai", "plays": 2}]
