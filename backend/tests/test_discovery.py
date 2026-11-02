import pytest
from mutagen.id3 import ID3, TLAN, TMOO
from mutagen.wave import WAVE

from app.library import normalize_language

from .conftest import auth_headers, tracks, write_wav


@pytest.mark.parametrize("raw, expected", [
    ("tam", "Tamil"), ("ta", "Tamil"), ("TAM", "Tamil"), ("Tamil", "Tamil"), ("eng", "English"), ("hin", "Hindi"),
    ("tam; eng", "Tamil"), ("xx", "xx"), ("  ", ""), ("", ""),
])
def test_normalize_language(raw, expected):
    assert normalize_language(raw) == expected


def tag_file(path, **frames):
    audio = WAVE(path)
    audio.add_tags()
    for frame in frames.values():
        audio.tags.add(frame)
    audio.save()


def test_scan_reads_mood_and_language(client, audio_dir):
    tagged = audio_dir / "Album" / "Tagged.wav"
    write_wav(tagged)
    tag_file(tagged, lang=TLAN(encoding=3, text=["tam"]), mood=TMOO(encoding=3, text=["Energetic"]))
    client.app.state.library.scan()
    h = auth_headers(client)
    by_title = {t["title"]: t for t in tracks(client, h)}
    assert by_title["Tagged"]["language"] == "Tamil" and by_title["Tagged"]["mood"] == "Energetic"
    untagged = by_title["Song Title"]
    assert untagged["language"] == "" and untagged["mood"] == ""


# ---- charts, artist pages, editorial ---------------------------------------------------

from .conftest import login_headers  # noqa: E402


@pytest.fixture
def listeners(client, audio_dir):
    write_wav(audio_dir / "Album" / "04 - Artist Name - Second Song.wav")
    client.app.state.library.scan()
    admin = auth_headers(client)
    client.post("/api/users", json={"username": "fan", "password": "fan-pass-1"}, headers=admin)
    return admin, login_headers(client, "fan", "fan-pass-1")


def play(client, h, title, times):
    tid = next(t["id"] for t in tracks(client, h) if t["title"] == title)
    for _ in range(times):
        client.post("/api/history", json={"track_id": tid}, headers=h)
    return tid


def test_chart_ranks_by_plays_across_users(client, listeners):
    admin, fan = listeners
    song = play(client, admin, "Song Title", 1)
    second = play(client, fan, "Second Song", 2)
    play(client, admin, "Second Song", 1)
    chart = client.get("/api/charts", headers=fan).json()
    assert [(t["id"], t["rank"], t["plays"]) for t in chart["tracks"]] == [(second, 1, 3), (song, 2, 1)]
    # Outside the window nothing counts.
    with client.app.state.db.connect() as conn:
        conn.execute("UPDATE plays SET played_at = datetime('now', '-30 days')")
    assert client.get("/api/charts?days=7", headers=fan).json()["tracks"] == []
    assert len(client.get("/api/charts?days=90", headers=fan).json()["tracks"]) == 2
    assert client.get("/api/charts?limit=0", headers=fan).status_code == 422


def test_chart_empty_and_limit(client, listeners):
    admin, fan = listeners
    assert client.get("/api/charts", headers=fan).json()["tracks"] == []
    play(client, admin, "Song Title", 2)
    play(client, admin, "Second Song", 1)
    assert len(client.get("/api/charts?limit=1", headers=fan).json()["tracks"]) == 1


def test_artist_page_bio_followers_top_tracks(client, listeners):
    admin, fan = listeners
    artist_id = client.get("/api/artists", headers=fan).json()["artists"][0]["id"]
    play(client, fan, "Second Song", 3)
    play(client, fan, "Song Title", 1)
    client.put(f"/api/artists/{artist_id}/follow", headers=fan)
    page = client.get(f"/api/artists/{artist_id}", headers=fan).json()
    assert page["name"] == "Artist Name" and page["bio"] == "" and page["followers"] == 1 and page["following"] is True
    assert [t["title"] for t in page["top_tracks"]] == ["Second Song", "Song Title"]
    assert page["top_tracks"][0]["plays"] == 3 and len(page["albums"]) >= 1
    assert client.get(f"/api/artists/{artist_id}", headers=admin).json()["following"] is False
    assert client.get("/api/artists/nope", headers=fan).status_code == 404


def test_artist_bio_is_admin_only(client, listeners):
    admin, fan = listeners
    artist_id = client.get("/api/artists", headers=fan).json()["artists"][0]["id"]
    assert client.put(f"/api/artists/{artist_id}/bio", json={"bio": "Hi"}, headers=fan).status_code == 403
    assert client.put(f"/api/artists/{artist_id}/bio", json={"bio": "  Chennai-born producer.  "}, headers=admin).json()["bio"] == "Chennai-born producer."
    assert client.get(f"/api/artists/{artist_id}", headers=fan).json()["bio"] == "Chennai-born producer."
    assert client.put(f"/api/artists/{artist_id}/bio", json={"bio": "x" * 1001}, headers=admin).status_code == 422
    assert client.put(f"/api/artists/{artist_id}/bio", json={"bio": ""}, headers=admin).json()["bio"] == ""
    assert client.put("/api/artists/nope/bio", json={"bio": "x"}, headers=admin).status_code == 404


def test_editorial_playlists(client, listeners):
    admin, fan = listeners
    ids = [t["id"] for t in tracks(client, admin)]
    pl = client.post("/api/playlists", json={"name": "Monsoon Mood", "track_ids": ids}, headers=admin).json()
    assert client.get("/api/editorial", headers=fan).json()["playlists"] == []
    assert client.patch(f"/api/playlists/{pl['id']}", json={"featured": True}, headers=fan).status_code == 404  # not theirs
    own = client.post("/api/playlists", json={"name": "Mine"}, headers=fan).json()
    assert client.patch(f"/api/playlists/{own['id']}", json={"featured": True}, headers=fan).status_code == 403
    done = client.patch(f"/api/playlists/{pl['id']}", json={"featured": True}, headers=admin).json()
    assert done["featured"] is True and done["visibility"] == "public"
    shown = client.get("/api/editorial", headers=fan).json()["playlists"]
    assert [p["name"] for p in shown] == ["Monsoon Mood"] and shown[0]["owner"]["username"] == "admin"
    assert client.get(f"/api/playlists/{pl['id']}", headers=fan).status_code == 200
    client.patch(f"/api/playlists/{pl['id']}", json={"featured": False}, headers=admin)
    assert client.get("/api/editorial", headers=fan).json()["playlists"] == []
