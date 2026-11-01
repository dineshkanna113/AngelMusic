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
    assert me["share_activity"] is False
    assert "share_activity" not in client.get("/api/people/asha", headers=people["bala"]).json()


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


# ---- presence and activity -------------------------------------------------------------

def activity(client, h):
    return {f["person"]["username"]: f for f in client.get("/api/activity", headers=h).json()["friends"]}


def test_activity_live_and_last_played(client, people):
    tid = tracks(client, people["bala"])[0]["id"]
    follow(client, people["asha"], "bala")
    follow(client, people["asha"], "chitra")
    assert client.post("/api/presence", json={"track_id": tid}, headers=people["bala"]).status_code == 204
    client.post("/api/history", json={"track_id": tid}, headers=people["chitra"])
    feed = activity(client, people["asha"])
    assert feed["bala"]["live"] is True and feed["bala"]["track"]["id"] == tid
    assert feed["chitra"]["live"] is False and feed["chitra"]["track"]["id"] == tid
    assert list(feed)[0] == "bala"  # live first

    # Presence older than two minutes is no longer live.
    with client.app.state.db.connect() as conn:
        conn.execute("UPDATE presence SET updated_at = datetime('now', '-10 minutes')")
    assert activity(client, people["asha"])["bala"]["live"] is False
    # Pausing clears it too.
    client.post("/api/presence", json={"track_id": tid}, headers=people["bala"])
    client.post("/api/presence", json={"track_id": None}, headers=people["bala"])
    assert activity(client, people["asha"])["bala"]["live"] is False


def test_activity_respects_privacy_and_follows(client, people):
    tid = tracks(client, people["bala"])[0]["id"]
    client.post("/api/presence", json={"track_id": tid}, headers=people["bala"])
    assert "bala" not in activity(client, people["asha"])  # not followed
    follow(client, people["asha"], "bala")
    client.patch("/api/me/profile", json={"share_activity": False}, headers=people["bala"])
    assert "bala" not in activity(client, people["asha"])
    client.patch("/api/me/profile", json={"share_activity": True, "is_private": True}, headers=people["bala"])
    assert "bala" not in activity(client, people["asha"])  # private, one-way
    follow(client, people["bala"], "asha")
    assert "bala" in activity(client, people["asha"])  # friends


def test_presence_unknown_track(client, people):
    assert client.post("/api/presence", json={"track_id": "nope"}, headers=people["asha"]).status_code == 404


# ---- public and collaborative playlists -------------------------------------------------

def make_playlist(client, h, name="Road trip"):
    ids = [t["id"] for t in tracks(client, h)]
    return client.post("/api/playlists", json={"name": name, "track_ids": ids}, headers=h).json()


def test_collaborator_can_edit_tracks_not_settings(client, people, audio_dir):
    from .conftest import write_wav
    write_wav(audio_dir / "Second.wav")
    client.app.state.library.scan()
    pl = make_playlist(client, people["asha"])
    pid = pl["id"]
    follow(client, people["bala"], "asha")
    assert client.post(f"/api/playlists/{pid}/members", json={"username": "bala"}, headers=people["asha"]).status_code == 409
    client.patch(f"/api/playlists/{pid}", json={"collaborative": True}, headers=people["asha"])
    assert client.post(f"/api/playlists/{pid}/members", json={"username": "bala"}, headers=people["asha"]).status_code == 204
    # Only people connected to the owner can be added.
    assert client.post(f"/api/playlists/{pid}/members", json={"username": "chitra"}, headers=people["asha"]).status_code == 400

    mine = client.get("/api/playlists", headers=people["bala"]).json()["playlists"]
    assert [(p["id"], p["role"]) for p in mine] == [(pid, "member")]
    ids = [t["id"] for t in client.get(f"/api/playlists/{pid}", headers=people["bala"]).json()["tracks"]]
    reordered = client.patch(f"/api/playlists/{pid}", json={"track_ids": ids[::-1]}, headers=people["bala"])
    assert reordered.status_code == 200 and [t["id"] for t in reordered.json()["tracks"]] == ids[::-1]
    assert client.post(f"/api/playlists/{pid}/tracks", json={"track_ids": ids[:1]}, headers=people["bala"]).status_code == 200
    assert client.patch(f"/api/playlists/{pid}", json={"name": "Mine now"}, headers=people["bala"]).status_code == 403
    assert client.delete(f"/api/playlists/{pid}", headers=people["bala"]).status_code == 403
    members = client.get(f"/api/playlists/{pid}/members", headers=people["bala"]).json()["people"]
    assert [m["username"] for m in members] == ["bala"]

    assert client.delete(f"/api/playlists/{pid}/members/bala", headers=people["asha"]).status_code == 204
    assert client.get(f"/api/playlists/{pid}", headers=people["bala"]).status_code == 404


def test_public_playlist_is_read_only_for_others(client, people):
    pl = make_playlist(client, people["asha"])
    pid = pl["id"]
    assert client.get(f"/api/playlists/{pid}", headers=people["chitra"]).status_code == 404
    client.patch(f"/api/playlists/{pid}", json={"visibility": "public"}, headers=people["asha"])
    seen = client.get(f"/api/playlists/{pid}", headers=people["chitra"]).json()
    assert seen["role"] == "viewer" and seen["owner"]["username"] == "asha" and seen["visibility"] == "public"
    assert client.patch(f"/api/playlists/{pid}", json={"track_ids": []}, headers=people["chitra"]).status_code == 403
    assert client.patch(f"/api/playlists/{pid}", json={"visibility": "nope"}, headers=people["asha"]).status_code == 422
    assert [p["id"] for p in client.get("/api/people/asha", headers=people["chitra"]).json()["playlists"]] == [pid]
    # The owner's view is unchanged.
    own = client.get(f"/api/playlists/{pid}", headers=people["asha"]).json()
    assert own["role"] == "owner" and own["collaborative"] is False
