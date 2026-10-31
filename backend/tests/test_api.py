from .conftest import auth_headers as _auth
from .conftest import register as _register
from .conftest import stream_token as _stream_token
from .conftest import write_wav as _write_wav


def test_first_user_is_admin_and_registration_then_closes(client):
    res = _register(client)
    assert res.status_code == 201
    assert res.json()["user"]["is_admin"] is True
    assert _register(client, "second").status_code == 403


def test_login_and_wrong_password(client):
    _register(client)
    assert client.post("/api/auth/login", json={"username": "admin", "password": "correct-horse"}).status_code == 200
    assert client.post("/api/auth/login", json={"username": "admin", "password": "nope-nope"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "ghost", "password": "nope-nope"}).status_code == 401


def test_login_throttled_after_repeated_failures(client):
    _register(client)
    codes = [
        client.post("/api/auth/login", json={"username": "admin", "password": "wrong-pass"}).status_code
        for _ in range(10)
    ]
    assert codes[-1] == 429


def test_tracks_require_auth(client):
    assert client.get("/api/tracks").status_code == 401


def test_scan_reads_files_and_parses_filename(client):
    tracks = client.get("/api/tracks", headers=_auth(client)).json()["tracks"]
    assert len(tracks) == 1
    t = tracks[0]
    assert t["title"] == "Song Title"
    assert t["artist"] == "Artist Name"
    assert t["codec"] == "wav" and t["lossless"] is True
    assert t["sample_rate"] == 44100 and t["bit_depth"] == 16 and t["channels"] == 2
    assert round(t["duration"]) == 1
    assert "rel_path" not in t


def test_stream_supports_range_and_rejects_access_token(client):
    headers = _auth(client)
    track = client.get("/api/tracks", headers=headers).json()["tracks"][0]

    access = headers["Authorization"].split()[1]
    assert client.get(f"/api/stream/{track['id']}?t={access}").status_code == 401

    token = _stream_token(client, headers)
    full = client.get(f"/api/stream/{track['id']}?t={token}")
    assert full.status_code == 200
    assert full.headers["accept-ranges"] == "bytes"
    assert full.headers["content-type"] == "audio/wav"
    assert len(full.content) == track["size"]

    part = client.get(f"/api/stream/{track['id']}?t={token}", headers={"Range": "bytes=100-199"})
    assert part.status_code == 206
    assert part.headers["content-range"] == f"bytes 100-199/{track['size']}"
    assert part.content == full.content[100:200]


def test_stream_unknown_track(client):
    token = _stream_token(client, _auth(client))
    assert client.get(f"/api/stream/..%2F..%2Fetc%2Fpasswd?t={token}").status_code == 404
    assert client.get(f"/api/stream/deadbeefdeadbeef?t={token}").status_code == 404


def test_rescan_picks_up_changes(client, audio_dir):
    headers = _auth(client)
    _write_wav(audio_dir / "New Track.wav")
    client.app.state.library.scan()
    titles = {t["title"] for t in client.get("/api/tracks", headers=headers).json()["tracks"]}
    assert titles == {"Song Title", "New Track"}

    (audio_dir / "New Track.wav").unlink()
    client.app.state.library.scan()
    assert len(client.get("/api/tracks", headers=headers).json()["tracks"]) == 1


def test_rescan_endpoint_is_admin_only(client):
    assert client.post("/api/library/rescan", headers=_auth(client)).status_code == 202


def test_missing_cover_is_404(client):
    headers = _auth(client)
    track = client.get("/api/tracks", headers=headers).json()["tracks"][0]
    token = _stream_token(client, headers)
    assert client.get(f"/api/tracks/{track['id']}/cover?t={token}").status_code == 404
