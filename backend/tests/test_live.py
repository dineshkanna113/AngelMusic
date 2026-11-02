import pytest

from .conftest import auth_headers, login_headers, tracks, write_wav


@pytest.fixture
def live(client, audio_dir):
    """admin plus alice, bob, carol; four tracks by three artists."""
    for folder, name in (("Album", "04 - Artist Name - Second Song"), ("Other", "05 - Other Artist - Tune A"),
                         ("Third", "06 - Third Artist - Tune B")):
        (audio_dir / folder).mkdir(exist_ok=True)
        write_wav(audio_dir / folder / f"{name}.wav")
    client.app.state.library.scan()
    admin = auth_headers(client)
    for name in ("alice", "bob", "carol"):
        client.post("/api/users", json={"username": name, "password": f"{name}-pass-1"}, headers=admin)
    h = {n: login_headers(client, n, f"{n}-pass-1") for n in ("alice", "bob", "carol")}
    ids = {t["title"]: t["id"] for t in tracks(client, admin)}
    return {"admin": admin, **h, "ids": ids}


def play(client, h, ids, title, times=1):
    for _ in range(times):
        assert client.post("/api/history", json={"track_id": ids[title]}, headers=h).status_code == 204


def befriend(client, a, b, a_name, b_name):
    client.put(f"/api/people/{b_name}/follow", headers=a)
    client.put(f"/api/people/{a_name}/follow", headers=b)


def backdate(client, when, limit=1):
    with client.app.state.db.connect() as conn:
        conn.execute("UPDATE plays SET played_at = ? WHERE id IN (SELECT id FROM plays ORDER BY id DESC LIMIT ?)",
                     (when, limit))


# ---- Rewind -----------------------------------------------------------------------------

def test_rewind_with_no_plays_is_empty(client, live):
    r = client.get("/api/rewind", headers=live["alice"]).json()
    assert r["plays"] == 0 and r["seconds"] == 0 and r["top_tracks"] == [] and r["top_artists"] == []
    assert r["busiest_day"] is None and r["top_genre"] is None and r["active_days"] == 0


def test_rewind_counts_only_my_plays_this_month(client, live):
    ids = live["ids"]
    play(client, live["alice"], ids, "Song Title", 3)
    play(client, live["alice"], ids, "Tune A", 1)
    play(client, live["bob"], ids, "Tune B", 9)
    r = client.get("/api/rewind?period=month", headers=live["alice"]).json()
    assert (r["plays"], r["seconds"], r["active_days"]) == (4, 4, 1)
    assert [(t["title"], t["plays"]) for t in r["top_tracks"]] == [("Song Title", 3), ("Tune A", 1)]
    assert [(a["name"], a["plays"]) for a in r["top_artists"]] == [("Artist Name", 3), ("Other Artist", 1)]
    assert r["busiest_day"]["plays"] == 4 and len(r["start"]) == 10 and r["label"]


def test_rewind_periods(client, live):
    ids = live["ids"]
    play(client, live["alice"], ids, "Song Title", 2)
    backdate(client, "2020-01-15 10:00:00", 1)
    play(client, live["alice"], ids, "Tune A", 1)
    backdate(client, "2020-06-02 10:00:00", 1)
    assert client.get("/api/rewind?period=2020-01", headers=live["alice"]).json()["plays"] == 1
    year = client.get("/api/rewind?period=2020", headers=live["alice"]).json()
    assert year["plays"] == 2 and year["label"] == "2020"
    assert client.get("/api/rewind?period=month", headers=live["alice"]).json()["plays"] == 1
    assert client.get("/api/rewind?period=2020-13", headers=live["alice"]).status_code == 422
    assert client.get("/api/rewind?period=soon", headers=live["alice"]).status_code == 422


# ---- Blend ------------------------------------------------------------------------------

def blend(client, h, username):
    return client.post("/api/blends", json={"username": username}, headers=h)


def test_blend_needs_mutual_follow_and_shared_activity(client, live):
    h = live
    assert blend(client, h["alice"], "alice").status_code == 400
    assert blend(client, h["alice"], "nobody").status_code == 404
    assert blend(client, h["alice"], "bob").status_code == 403  # strangers
    client.put("/api/people/bob/follow", headers=h["alice"])
    assert blend(client, h["alice"], "bob").status_code == 403  # one-way follow
    client.put("/api/people/alice/follow", headers=h["bob"])
    client.patch("/api/me/profile", json={"share_activity": False}, headers=h["bob"])
    assert blend(client, h["alice"], "bob").status_code == 403  # bob hides his listening


def test_blend_mixes_two_tastes(client, live):
    h, ids = live, live["ids"]
    befriend(client, h["alice"], h["bob"], "alice", "bob")
    play(client, h["alice"], ids, "Song Title", 3)
    play(client, h["alice"], ids, "Tune A", 1)
    play(client, h["bob"], ids, "Song Title", 2)
    play(client, h["bob"], ids, "Tune B", 2)
    res = blend(client, h["alice"], "bob")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["name"] == "alice + bob" and body["visibility"] == "private"
    assert [t["title"] for t in body["tracks"]] == ["Song Title", "Tune A", "Tune B"]  # shared first, then interleaved
    assert body["blend"] == {"match": 33, "shared_artists": ["Artist Name"]}
    assert client.get("/api/playlists", headers=h["alice"]).json()["playlists"][0]["name"] == "alice + bob"
    assert client.get("/api/playlists", headers=h["bob"]).json()["playlists"] == []  # a copy for the caller only


def test_blend_with_no_listening_history_says_so(client, live):
    befriend(client, live["alice"], live["bob"], "alice", "bob")
    res = blend(client, live["alice"], "bob")
    assert res.status_code == 400 and "listen" in res.json()["detail"].lower()
