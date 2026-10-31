import io
import wave

import mutagen
import pytest

from .conftest import auth_headers, login_headers, stream_token, tracks


def wav_bytes(seconds=2, rate=44100, fill=0):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes([fill]) * 4 * rate * seconds)
    return buf.getvalue()


def start(client, h, filename, data, **extra):
    res = client.post("/api/uploads", json={"filename": filename, "size": len(data), **extra}, headers=h)
    assert res.status_code == 201, res.text
    return res.json()["id"]


def send(client, h, upload_id, data, chunk=64 * 1024):
    offset = 0
    while offset < len(data):
        res = client.put(f"/api/uploads/{upload_id}/content", content=data[offset:offset + chunk],
                         headers={**h, "Upload-Offset": str(offset)})
        assert res.status_code == 200, res.text
        offset = res.json()["received"]
    return client.get(f"/api/uploads/{upload_id}", headers=h).json()


def upload(client, h, filename, data, **extra):
    return send(client, h, start(client, h, filename, data, **extra), data)


@pytest.fixture
def roles(client):
    admin = auth_headers(client)
    client.post("/api/users", json={"username": "artist", "password": "artist-pass-1", "can_upload": True}, headers=admin)
    client.post("/api/users", json={"username": "listener", "password": "listener-pass-1"}, headers=admin)
    return admin, login_headers(client, "artist", "artist-pass-1"), login_headers(client, "listener", "listener-pass-1")


def test_upload_review_publish_flow(client, roles, audio_dir):
    admin, artist, listener = roles
    assert client.get("/api/auth/me", headers=artist).json()["can_upload"] is True
    up = upload(client, artist, "../../02 - Someone - First Song.wav", wav_bytes())
    assert up["status"] == "pending" and up["filename"] == "02 - Someone - First Song.wav"
    assert up["technical"]["codec"] == "wav" and up["technical"]["lossless"] is True
    assert up["metadata"]["title"] == "First Song" and up["metadata"]["artist"] == "Someone"
    codes = {i["code"] for i in up["issues"]}
    assert {"missing_album", "no_artwork"} <= codes and not any(i["level"] == "error" for i in up["issues"])

    # Nobody can stream it until it's approved.
    assert len(tracks(client, listener)) == 1
    tok = stream_token(client, artist)
    assert client.get(f"/api/uploads/{up['id']}/audio?t={tok}").status_code == 200

    edited = client.patch(f"/api/uploads/{up['id']}", headers=artist,
                          json={"title": "First Song (Remaster)", "album": "Debut", "year": "2024", "track_no": 2}).json()
    assert edited["metadata"]["album"] == "Debut" and "album" in edited["edited"]
    assert "missing_album" not in {i["code"] for i in edited["issues"]}

    assert client.post(f"/api/uploads/{up['id']}/approve", json={}, headers=artist).status_code == 403
    done = client.post(f"/api/uploads/{up['id']}/approve", json={}, headers=admin).json()
    assert done["status"] == "published" and done["reviewer"] == "admin"

    path = audio_dir / "Uploads" / "Someone" / "Debut" / "02 First Song (Remaster).wav"
    assert path.is_file()
    tags = mutagen.File(path).tags
    assert str(tags["TIT2"]) == "First Song (Remaster)" and str(tags["TALB"]) == "Debut"
    new = [t for t in tracks(client, listener) if t["id"] == done["track_id"]]
    assert new and new[0]["title"] == "First Song (Remaster)" and new[0]["year"] == "2024"
    assert not list((client.app.state.settings.staging_dir).iterdir())


def test_resume_after_interrupted_chunk(client, roles):
    _admin, artist, _ = roles
    data = wav_bytes()
    uid = start(client, artist, "song.wav", data)
    client.put(f"/api/uploads/{uid}/content", content=data[:1000], headers={**artist, "Upload-Offset": "0"})
    # Client thinks it sent more than it did: the server says where to resume.
    res = client.put(f"/api/uploads/{uid}/content", content=data[5000:], headers={**artist, "Upload-Offset": "5000"})
    assert res.status_code == 409 and res.json()["received"] == 1000
    assert client.get(f"/api/uploads/{uid}", headers=artist).json()["received"] == 1000
    res = client.put(f"/api/uploads/{uid}/content", content=data[1000:] + b"extra",
                     headers={**artist, "Upload-Offset": "1000"})
    assert res.status_code == 413
    res = client.put(f"/api/uploads/{uid}/content", content=data[1000:], headers={**artist, "Upload-Offset": "1000"})
    assert res.json() == {"received": len(data), "status": "processing"}
    assert client.get(f"/api/uploads/{uid}", headers=artist).json()["status"] == "pending"


def test_rejects_fake_and_duplicate_files(client, roles, audio_dir):
    _admin, artist, _ = roles
    assert client.post("/api/uploads", json={"filename": "x.exe", "size": 2}, headers=artist).status_code == 400
    fake = upload(client, artist, "virus.flac", b"MZ" + b"\0" * 4000)
    assert fake["status"] == "invalid" and fake["issues"][0]["code"] == "not_audio"
    junk = upload(client, artist, "noise.wav", b"\x01\x02" * 3000)
    assert junk["status"] == "invalid" and junk["issues"][0]["code"] == "unreadable"
    renamed = upload(client, artist, "really-a-wav.flac", wav_bytes(fill=1))
    assert renamed["status"] == "invalid" and renamed["issues"][0]["code"] == "type_mismatch"

    existing = (audio_dir / "Album" / "03 - Artist Name - Song Title.wav").read_bytes()
    dup = upload(client, artist, "copy.wav", existing)
    assert dup["status"] == "invalid" and "duplicate_track" in {i["code"] for i in dup["issues"]}

    first = upload(client, artist, "a.wav", wav_bytes(fill=3))
    again = upload(client, artist, "b.wav", wav_bytes(fill=3))
    assert first["status"] == "pending" and "duplicate_upload" in {i["code"] for i in again["issues"]}
    # An invalid upload can't be approved, only declined or deleted.
    assert client.delete(f"/api/uploads/{again['id']}", headers=artist).status_code == 204


def test_permissions(client, roles):
    admin, artist, listener = roles
    assert client.post("/api/uploads", json={"filename": "a.wav", "size": 10}, headers=listener).status_code == 403
    up = upload(client, admin, "admin.wav", wav_bytes(fill=5))
    assert client.get(f"/api/uploads/{up['id']}", headers=artist).status_code == 404
    assert client.get("/api/uploads?scope=all", headers=artist).json()["uploads"] == []
    assert len(client.get("/api/uploads?scope=all", headers=admin).json()["uploads"]) == 1
    assert client.delete(f"/api/tracks/{tracks(client, admin)[0]['id']}", headers=artist).status_code == 403


def test_scheduled_release(client, roles):
    admin, artist, listener = roles
    up = upload(client, artist, "Later.wav", wav_bytes(fill=7))
    res = client.post(f"/api/uploads/{up['id']}/approve", json={"release_at": "2999-01-01T00:00:00Z"}, headers=admin)
    assert res.json()["status"] == "scheduled" and res.json()["release_at"] == "2999-01-01 00:00:00"
    client.app.state.ingest.run_once()
    assert len(tracks(client, listener)) == 1
    with client.app.state.db.connect() as conn:
        conn.execute("UPDATE uploads SET release_at = '2000-01-01 00:00:00' WHERE id = ?", (up["id"],))
    client.app.state.ingest.run_once()
    assert client.get(f"/api/uploads/{up['id']}", headers=artist).json()["status"] == "published"
    assert len(tracks(client, listener)) == 2


def test_admin_auto_publish_and_takedown(client, roles):
    admin, artist, listener = roles
    # The uploader role can't skip review even if it asks to.
    held = upload(client, artist, "mine.wav", wav_bytes(fill=8), publish=True)
    assert held["status"] == "pending"
    up = upload(client, admin, "Direct.wav", wav_bytes(fill=9), publish=True)
    assert up["status"] == "published"
    tid = up["track_id"]
    assert any(t["id"] == tid for t in tracks(client, listener))
    assert client.delete(f"/api/tracks/{tid}", headers=admin).status_code == 204
    assert not any(t["id"] == tid for t in tracks(client, listener))
    assert client.get(f"/api/uploads/{up['id']}", headers=admin).json()["status"] == "removed"
    assert any((client.app.state.settings.removed_dir / tid).iterdir())


def test_decline_with_note(client, roles):
    admin, artist, _ = roles
    up = upload(client, artist, "Rough.wav", wav_bytes(fill=11))
    res = client.post(f"/api/uploads/{up['id']}/decline", json={"note": "Clipping in the chorus"}, headers=admin).json()
    assert res["status"] == "declined" and res["review_note"] == "Clipping in the chorus"
    assert client.post(f"/api/uploads/{up['id']}/approve", json={}, headers=admin).status_code == 409
    mine = client.get("/api/uploads", headers=artist).json()
    assert mine["counts"] == {"declined": 1} and mine["uploads"][0]["review_note"] == "Clipping in the chorus"
