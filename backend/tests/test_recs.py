import pytest

from .conftest import auth_headers, login_headers, tracks, write_wav


@pytest.fixture
def recs(client, audio_dir):
    """Four tracks by four artists and four listeners: me, u1, u2, u3."""
    for folder, name in (("Album", "05 - Artist Name - Second Song"), ("B", "02 - Band B - Song B"), ("C", "03 - Band C - Song C"), ("D", "04 - Band D - Song D")):
        (audio_dir / folder).mkdir(exist_ok=True)
        write_wav(audio_dir / folder / f"{name}.wav")
    client.app.state.library.scan()
    admin = auth_headers(client)
    users = ("mia", "uma", "ugo", "uli")
    for n in users:
        client.post("/api/users", json={"username": n, "password": f"{n}-pass-1"}, headers=admin)
    h = {n: login_headers(client, n, f"{n}-pass-1") for n in users}
    ids = {t["title"]: t["id"] for t in tracks(client, admin)}
    return {"h": h, "ids": ids, "admin": admin}


def play(client, h, ids, *titles):
    for t in titles:
        assert client.post("/api/history", json={"track_id": ids[t]}, headers=h).status_code == 204


def discover(client, h, **params):
    q = "&".join(f"{k}={v}" for k, v in params.items())
    res = client.get(f"/api/recommendations/discover?{q}", headers=h)
    assert res.status_code == 200, res.text
    return res.json()


def test_listeners_like_you_need_two_co_listeners(client, recs):
    h, ids = recs["h"], recs["ids"]
    play(client, h["mia"], ids, "Song Title")
    play(client, h["uma"], ids, "Song Title", "Song B")
    play(client, h["ugo"], ids, "Song Title", "Song B", "Song C")
    play(client, h["uli"], ids, "Song C")  # no overlap with me
    body = discover(client, h["mia"])
    got = {t["title"]: t for t in body["tracks"]}
    assert got["Song B"]["reason"] == {"kind": "listeners", "because": "Song Title"}
    assert "Song C" not in got  # only one overlapping listener, and unheard by a lone stranger is not enough
    assert "Song Title" not in got  # never something I already play


def test_favorites_count_as_heard(client, recs):
    h, ids = recs["h"], recs["ids"]
    play(client, h["mia"], ids, "Song Title")
    client.put(f"/api/favorites/{ids['Song B']}", headers=h["mia"])
    play(client, h["uma"], ids, "Song Title", "Song B")
    play(client, h["ugo"], ids, "Song Title", "Song B")
    assert "Song B" not in {t["title"] for t in discover(client, h["mia"])["tracks"]}


def test_content_taste_fills_in_when_nobody_overlaps(client, recs):
    h, ids = recs["h"], recs["ids"]
    # Two tracks share the artist "Artist Name": I play one, the other is a taste match.
    play(client, h["mia"], ids, "Song Title", "Song Title")
    got = {t["title"]: t["reason"] for t in discover(client, h["mia"])["tracks"]}
    assert got["Second Song"] == {"kind": "taste", "because": "Artist Name"}


def test_cold_start_falls_back_to_popular(client, recs):
    h, ids = recs["h"], recs["ids"]
    play(client, h["uma"], ids, "Song B", "Song B", "Song C")
    got = discover(client, h["mia"])["tracks"]
    assert [t["title"] for t in got][:2] == ["Song B", "Song C"]
    assert all(t["reason"]["kind"] == "popular" for t in got)


def test_nothing_played_anywhere_is_empty(client, recs):
    assert discover(client, recs["h"]["mia"])["tracks"] == []


def test_limit_and_auth(client, recs):
    h, ids = recs["h"], recs["ids"]
    play(client, h["uma"], ids, "Song B", "Song C", "Song D")
    assert len(discover(client, h["mia"], limit=2)["tracks"]) == 2
    assert client.get("/api/recommendations/discover?limit=0", headers=h["mia"]).status_code == 422
    assert client.get("/api/recommendations/discover").status_code == 401


def test_results_never_name_other_listeners(client, recs):
    h, ids = recs["h"], recs["ids"]
    play(client, h["mia"], ids, "Song Title")
    play(client, h["uma"], ids, "Song Title", "Song B")
    play(client, h["ugo"], ids, "Song Title", "Song B")
    text = client.get("/api/recommendations/discover", headers=h["mia"]).text
    assert "uma" not in text and "ugo" not in text
