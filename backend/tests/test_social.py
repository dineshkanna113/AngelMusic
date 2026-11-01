import io
import struct
import zlib

import pytest

from .conftest import auth_headers, login_headers, tracks


def png_bytes():
    raw = b"\x00\xff\xb0\x20"  # one row: filter byte + one marigold pixel (RGB)
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


@pytest.fixture
def people(client):
    admin = auth_headers(client)
    for name in ("asha", "bala", "chitra"):
        client.post("/api/users", json={"username": name, "password": f"{name}-pass-1"}, headers=admin)
    return {"admin": admin, **{n: login_headers(client, n, f"{n}-pass-1") for n in ("asha", "bala", "chitra")}}


def follow(client, h, who, on=True):
    return client.request("PUT" if on else "DELETE", f"/api/people/{who}/follow", headers=h)


def test_follow_is_idempotent_and_counted(client, people):
    assert follow(client, people["asha"], "bala").status_code == 204
    assert follow(client, people["asha"], "bala").status_code == 204
    prof = client.get("/api/people/bala", headers=people["asha"]).json()
    assert prof["followers"] == 1 and prof["is_following"] is True and prof["follows_you"] is False
    assert follow(client, people["asha"], "bala", on=False).status_code == 204
    assert follow(client, people["asha"], "bala", on=False).status_code == 204
    assert client.get("/api/people/bala", headers=people["asha"]).json()["followers"] == 0


def test_cannot_follow_self_or_unknown(client, people):
    assert follow(client, people["asha"], "asha").status_code == 400
    assert follow(client, people["asha"], "nobody").status_code == 404
    assert client.get("/api/people/nobody", headers=people["asha"]).status_code == 404


def test_follows_you_and_lists(client, people):
    follow(client, people["bala"], "asha")
    prof = client.get("/api/people/bala", headers=people["asha"]).json()
    assert prof["follows_you"] is True and prof["is_following"] is False
    followers = client.get("/api/people/asha/followers", headers=people["chitra"]).json()["people"]
    assert [p["username"] for p in followers] == ["bala"]
    following = client.get("/api/people/bala/following", headers=people["chitra"]).json()["people"]
    assert [p["username"] for p in following] == ["asha"]


def test_search_people(client, people):
    found = client.get("/api/people", params={"q": "ch"}, headers=people["asha"]).json()["people"]
    assert [p["username"] for p in found] == ["chitra"]
    client.patch("/api/me/profile", json={"display_name": "Bala Murugan"}, headers=people["bala"])
    found = client.get("/api/people", params={"q": "mur"}, headers=people["asha"]).json()["people"]
    assert [p["username"] for p in found] == ["bala"]
    assert all(p["username"] != "asha" for p in client.get("/api/people", params={"q": "a"}, headers=people["asha"]).json()["people"])


def test_top_artists_and_privacy(client, people):
    tid = tracks(client, people["bala"])[0]["id"]
    for _ in range(3):
        client.post("/api/history", json={"track_id": tid}, headers=people["bala"])
    open_prof = client.get("/api/people/bala", headers=people["asha"]).json()
    assert open_prof["top_artists"][0]["plays"] == 3 and open_prof["top_artists"][0]["name"] == "Artist Name"

    client.patch("/api/me/profile", json={"is_private": True}, headers=people["bala"])
    follow(client, people["asha"], "bala")  # one-way follow
    hidden = client.get("/api/people/bala", headers=people["asha"]).json()
    assert hidden["is_private"] is True and hidden["top_artists"] is None and hidden["playlists"] is None
    follow(client, people["bala"], "asha")  # now mutual friends
    shown = client.get("/api/people/bala", headers=people["asha"]).json()
    assert shown["top_artists"] is not None
    assert client.get("/api/people/bala", headers=people["bala"]).json()["is_self"] is True


def test_profile_patch_validation(client, people):
    assert client.patch("/api/me/profile", json={"bio": "x" * 161}, headers=people["asha"]).status_code == 422
    assert client.patch("/api/me/profile", json={"display_name": "y" * 41}, headers=people["asha"]).status_code == 422
    me = client.patch("/api/me/profile", json={"bio": "Late-night playlists.", "share_activity": False},
                      headers=people["asha"]).json()
    assert me["bio"] == "Late-night playlists." and me["is_self"] is True


def test_avatar_upload(client, people):
    bad = client.post("/api/me/avatar", files={"file": ("x.png", b"MZ not an image", "image/png")}, headers=people["asha"])
    assert bad.status_code == 400
    ok = client.post("/api/me/avatar", files={"file": ("me.png", png_bytes(), "image/png")}, headers=people["asha"])
    assert ok.status_code == 200
    url = ok.json()["avatar_url"]
    assert client.get(url).status_code == 200  # avatars are public images
    assert client.get("/api/people/asha", headers=people["bala"]).json()["avatar_url"] == url
    assert client.delete("/api/me/avatar", headers=people["asha"]).status_code == 204
    assert client.get("/api/people/asha", headers=people["bala"]).json()["avatar_url"] is None


def test_follow_artists(client, people):
    artist_id = client.get("/api/artists", headers=people["asha"]).json()["artists"][0]["id"]
    assert client.put(f"/api/artists/{artist_id}/follow", headers=people["asha"]).status_code == 204
    assert client.put("/api/artists/nope/follow", headers=people["asha"]).status_code == 404
    assert client.get("/api/me/artists", headers=people["asha"]).json()["artists"][0]["id"] == artist_id
    assert client.get("/api/artists", headers=people["asha"]).json()["artists"][0]["following"] is True
    assert client.delete(f"/api/artists/{artist_id}/follow", headers=people["asha"]).status_code == 204
    assert client.get("/api/me/artists", headers=people["asha"]).json()["artists"] == []


def test_deleted_user_leaves_no_follow_rows(client, people):
    follow(client, people["asha"], "bala")
    bala_id = client.get("/api/people/bala", headers=people["asha"]).json()["id"]
    client.delete(f"/api/users/{bala_id}", headers=people["admin"])
    assert client.get("/api/people/asha/following", headers=people["asha"]).json()["people"] == []
