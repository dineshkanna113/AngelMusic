import hashlib
import xml.etree.ElementTree as ET

from .conftest import auth_headers, login_headers, stream_token, tracks, write_wav


def test_favorites_roundtrip(client):
    h = auth_headers(client)
    tid = tracks(client, h)[0]["id"]
    assert client.put(f"/api/favorites/{tid}", headers=h).status_code == 204
    assert tracks(client, h)[0]["favorite"] is True
    assert [t["id"] for t in client.get("/api/favorites", headers=h).json()["tracks"]] == [tid]
    assert client.delete(f"/api/favorites/{tid}", headers=h).status_code == 204
    assert client.get("/api/favorites", headers=h).json()["tracks"] == []
    assert client.put("/api/favorites/nope", headers=h).status_code == 404


def test_playlists_crud_and_reorder(client, audio_dir):
    h = auth_headers(client)
    write_wav(audio_dir / "Second.wav")
    client.app.state.library.scan()
    a, b = [t["id"] for t in tracks(client, h)]
    pl = client.post("/api/playlists", json={"name": "Mix", "track_ids": [a]}, headers=h).json()
    assert pl["track_count"] == 1
    client.post(f"/api/playlists/{pl['id']}/tracks", json={"track_ids": [b]}, headers=h)
    got = client.get(f"/api/playlists/{pl['id']}", headers=h).json()
    assert [t["id"] for t in got["tracks"]] == [a, b]
    got = client.patch(f"/api/playlists/{pl['id']}", json={"name": "Renamed", "track_ids": [b, a]}, headers=h).json()
    assert got["name"] == "Renamed" and [t["id"] for t in got["tracks"]] == [b, a]
    assert len(client.get("/api/playlists", headers=h).json()["playlists"]) == 1
    assert client.delete(f"/api/playlists/{pl['id']}", headers=h).status_code == 204
    assert client.get(f"/api/playlists/{pl['id']}", headers=h).status_code == 404


def test_playlists_are_private(client):
    h1 = auth_headers(client)
    pl = client.post("/api/playlists", json={"name": "Mine"}, headers=h1).json()
    client.post("/api/users", json={"username": "other", "password": "other-pass-1"}, headers=h1)
    h2 = login_headers(client, "other", "other-pass-1")
    assert client.get(f"/api/playlists/{pl['id']}", headers=h2).status_code == 404


def test_history_and_play_counts(client):
    h = auth_headers(client)
    tid = tracks(client, h)[0]["id"]
    for _ in range(3):
        assert client.post("/api/history", json={"track_id": tid}, headers=h).status_code == 204
    assert tracks(client, h)[0]["play_count"] == 3
    assert [t["id"] for t in client.get("/api/history", headers=h).json()["tracks"]] == [tid]
    client.delete("/api/history", headers=h)
    assert client.get("/api/history", headers=h).json()["tracks"] == []


def test_albums_and_artists(client):
    h = auth_headers(client)
    albums = client.get("/api/albums", headers=h).json()["albums"]
    assert len(albums) == 1 and albums[0]["track_count"] == 1
    assert client.get("/api/artists", headers=h).json()["artists"][0]["name"] == "Artist Name"


def test_sidecar_lrc_lyrics(client, audio_dir):
    h = auth_headers(client)
    wav = next(audio_dir.rglob("*.wav"))
    wav.with_suffix(".lrc").write_text("[00:01.00]First line\n[00:02.50]Second line\n", encoding="utf-8")
    tid = tracks(client, h)[0]["id"]
    lyrics = client.get(f"/api/tracks/{tid}/lyrics", headers=h).json()
    assert lyrics["synced"] == [{"time": 1.0, "text": "First line"}, {"time": 2.5, "text": "Second line"}]


def test_password_change_revokes_old_tokens(client):
    h = auth_headers(client)
    res = client.post("/api/auth/password", json={"current_password": "correct-horse", "new_password": "new-horse-99"},
                      headers=h)
    assert res.status_code == 200
    assert client.get("/api/auth/me", headers=h).status_code == 401
    new = {"Authorization": f"Bearer {res.json()['access_token']}"}
    assert client.get("/api/auth/me", headers=new).status_code == 200
    wrong = client.post("/api/auth/password", json={"current_password": "wrong", "new_password": "x" * 10}, headers=new)
    assert wrong.status_code == 400


def test_logout_all_revokes_stream_tokens(client):
    h = auth_headers(client)
    tid = tracks(client, h)[0]["id"]
    token = stream_token(client, h)
    client.post("/api/auth/logout-all", headers=h)
    assert client.get(f"/api/stream/{tid}?t={token}").status_code == 401


def test_user_admin(client):
    h = auth_headers(client)
    uid = client.post("/api/users", json={"username": "bob", "password": "bob-pass-1"}, headers=h).json()["id"]
    assert client.post("/api/users", json={"username": "bob", "password": "bob-pass-1"}, headers=h).status_code == 409
    me = client.get("/api/auth/me", headers=h).json()
    assert client.patch(f"/api/users/{me['id']}", json={"is_admin": False}, headers=h).status_code == 400
    assert client.delete(f"/api/users/{me['id']}", headers=h).status_code == 400
    bob = login_headers(client, "bob", "bob-pass-1")
    assert client.get("/api/users", headers=bob).status_code == 403
    assert client.delete(f"/api/users/{uid}", headers=h).status_code == 204


def test_upload_adds_track(client, audio_dir, tmp_path):
    h = auth_headers(client)
    src = tmp_path / "up.wav"
    write_wav(src)
    res = client.post("/api/library/upload", headers=h,
                      files=[("files", ("../../evil name.wav", src.read_bytes(), "audio/wav"))])
    assert res.status_code == 201, res.text
    assert res.json()["saved"] == ["evil name.wav"]
    assert (audio_dir / "Uploads" / "evil name.wav").is_file()
    assert len(tracks(client, h)) == 2
    bad = client.post("/api/library/upload", headers=h, files=[("files", ("x.exe", b"MZ", "application/octet-stream"))])
    assert bad.status_code == 400


def test_download_sets_filename(client):
    h = auth_headers(client)
    tid = tracks(client, h)[0]["id"]
    res = client.get(f"/api/download/{tid}?t={stream_token(client, h)}")
    assert res.status_code == 200 and "attachment" in res.headers["content-disposition"]


# ---- Subsonic ------------------------------------------------------------------------

def _subsonic(client):
    h = auth_headers(client)
    app_pw = client.post("/api/auth/app-password", headers=h).json()["app_password"]
    salt = "s4lt"
    params = {"u": "admin", "t": hashlib.md5((app_pw + salt).encode()).hexdigest(), "s": salt, "v": "1.16.1",
              "c": "test", "f": "json"}
    return h, app_pw, params


def _ok(res):
    body = res.json()["subsonic-response"]
    assert body["status"] == "ok", body
    return body


def test_subsonic_auth(client):
    _, app_pw, auth = _subsonic(client)
    _ok(client.get("/rest/ping.view", params=auth))
    _ok(client.get("/rest/ping", params={"u": "admin", "p": "enc:" + app_pw.encode().hex(), "f": "json"}))
    bad = client.get("/rest/ping", params={**auth, "t": "0" * 32}).json()["subsonic-response"]
    assert bad["status"] == "failed" and bad["error"]["code"] == 40
    # The account password must not work for third-party clients.
    acct = client.get("/rest/ping", params={"u": "admin", "p": "correct-horse", "f": "json"}).json()
    assert acct["subsonic-response"]["status"] == "failed"


def test_subsonic_xml_default(client):
    _, _, auth = _subsonic(client)
    res = client.get("/rest/getMusicFolders", params={k: v for k, v in auth.items() if k != "f"})
    ns = "{http://subsonic.org/restapi}"
    root = ET.fromstring(res.content)
    assert root.tag == f"{ns}subsonic-response" and root.get("status") == "ok"
    assert root.find(f"{ns}musicFolders/{ns}musicFolder") is not None


def test_subsonic_browse_and_stream(client):
    _, _, auth = _subsonic(client)
    artists = _ok(client.get("/rest/getArtists", params=auth))["artists"]["index"]
    artist_id = artists[0]["artist"][0]["id"]
    album_id = _ok(client.get("/rest/getArtist", params={**auth, "id": artist_id}))["artist"]["album"][0]["id"]
    song = _ok(client.get("/rest/getAlbum", params={**auth, "id": album_id}))["album"]["song"][0]
    assert song["samplingRate"] == 44100 and song["bitDepth"] == 16 and song["suffix"] == "wav"
    listed = _ok(client.get("/rest/getAlbumList2", params={**auth, "type": "newest"}))["albumList2"]["album"]
    assert listed[0]["id"] == album_id
    everything = _ok(client.get("/rest/search3", params={**auth, "query": '""', "songCount": 500}))
    assert len(everything["searchResult3"]["song"]) == 1
    part = client.get("/rest/stream", params={**auth, "id": song["id"], "format": "mp3"}, headers={"Range": "bytes=0-9"})
    assert part.status_code == 206 and len(part.content) == 10 and part.headers["content-type"] == "audio/wav"


def test_subsonic_star_scrobble_playlists(client):
    h, _, auth = _subsonic(client)
    sid = tracks(client, h)[0]["id"]
    _ok(client.get("/rest/star", params={**auth, "id": sid}))
    assert _ok(client.get("/rest/getStarred2", params=auth))["starred2"]["song"][0]["id"] == sid
    _ok(client.get("/rest/scrobble", params={**auth, "id": sid}))
    assert tracks(client, h)[0]["play_count"] == 1
    pl = _ok(client.post("/rest/createPlaylist", data={**auth, "name": "Road", "songId": sid}))["playlist"]
    assert pl["songCount"] == 1 and pl["entry"][0]["id"] == sid
    _ok(client.get("/rest/updatePlaylist", params={**auth, "playlistId": pl["id"], "songIndexToRemove": "0"}))
    assert _ok(client.get("/rest/getPlaylist", params={**auth, "id": pl["id"]}))["playlist"]["songCount"] == 0
    assert client.get("/api/playlists", headers=h).json()["playlists"][0]["name"] == "Road"


def test_subsonic_unknown_method(client):
    _, _, auth = _subsonic(client)
    assert client.get("/rest/jukeboxControl", params=auth).json()["subsonic-response"]["status"] == "failed"
