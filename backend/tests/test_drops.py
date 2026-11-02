from .conftest import login_headers
from .test_growth import studio  # noqa: F401  (fixture)
from .test_growth_helpers import png_bytes
from .test_uploads import upload, wav_bytes

FUTURE = "2999-01-01T00:00:00Z"


def make_drop(client, h, artist_id, title="Midnight Drop", release_at=FUTURE, **extra):
    return client.post("/api/drops", json={"artist_id": artist_id, "title": title, "release_at": release_at, **extra}, headers=h)


def test_create_drop_permissions_and_validation(client, studio):
    aid = studio["artist_id"]
    assert make_drop(client, studio["fan"], aid).status_code == 403
    assert make_drop(client, studio["artist"], "nope").status_code == 404
    assert make_drop(client, studio["artist"], aid, release_at="2000-01-01T00:00:00Z").status_code == 400
    assert make_drop(client, studio["artist"], aid, title="").status_code == 422
    res = make_drop(client, studio["artist"], aid, description="First single")
    assert res.status_code == 201, res.text
    drop = res.json()
    assert drop["status"] == "upcoming" and drop["artist"] == {"id": aid, "name": "Artist Name"}
    assert drop["share_url"] == f"/s/{drop['slug']}" and drop["presaves"] == 0 and drop["can_manage"] is True
    assert client.get(f"/api/drops/{drop['slug']}", headers=studio["fan"]).json()["can_manage"] is False


def test_listing_order_and_status(client, studio):
    aid = studio["artist_id"]
    later = make_drop(client, studio["artist"], aid, "Later", "2999-06-01T00:00:00Z").json()
    sooner = make_drop(client, studio["artist"], aid, "Sooner", "2998-06-01T00:00:00Z").json()
    assert [d["title"] for d in client.get("/api/drops", headers=studio["fan"]).json()["drops"]] == ["Sooner", "Later"]
    with client.app.state.db.connect() as conn:
        conn.execute("UPDATE drops SET release_at = '2000-01-01 00:00:00' WHERE id = ?", (sooner["id"],))
    drops = client.get(f"/api/drops?artist_id={aid}", headers=studio["fan"]).json()["drops"]
    assert [(d["title"], d["status"]) for d in drops] == [("Sooner", "dropping_soon"), ("Later", "upcoming")]
    assert later["status"] == "upcoming"
    assert client.get("/api/drops?artist_id=other", headers=studio["fan"]).json()["drops"] == []


def test_presave_is_idempotent_and_counted(client, studio):
    drop = make_drop(client, studio["artist"], studio["artist_id"]).json()
    pid = drop["id"]
    for _ in range(2):
        assert client.put(f"/api/drops/{pid}/presave", headers=studio["fan"]).status_code == 204
    assert client.put(f"/api/drops/{pid}/presave", headers=studio["ghost"]).status_code == 204
    seen = client.get(f"/api/drops/{drop['slug']}", headers=studio["fan"]).json()
    assert seen["presaves"] == 2 and seen["presaved"] is True
    for _ in range(2):
        assert client.delete(f"/api/drops/{pid}/presave", headers=studio["fan"]).status_code == 204
    assert client.get(f"/api/drops/{drop['slug']}", headers=studio["fan"]).json()["presaves"] == 1
    assert client.put("/api/drops/99999/presave", headers=studio["fan"]).status_code == 404


def test_release_adds_the_track_to_presavers_favorites(client, studio):
    admin = studio["admin"]
    up = upload(client, admin, "03 - Artist Name - Drop Song.wav", wav_bytes(fill=21))
    assert up["status"] == "pending"
    drop = make_drop(client, admin, studio["artist_id"], upload_id=up["id"]).json()
    pid = drop["id"]
    client.put(f"/api/drops/{pid}/presave", headers=studio["fan"])
    client.put(f"/api/drops/{pid}/presave", headers=studio["ghost"])
    leaver = client.post("/api/users", json={"username": "leaver", "password": "leaver-pass-1"}, headers=admin).json()
    client.put(f"/api/drops/{pid}/presave", headers=login_headers(client, "leaver", "leaver-pass-1"))
    client.delete(f"/api/users/{leaver['id']}", headers=admin)  # a pre-saver who leaves must not break the release

    assert client.get("/api/favorites", headers=studio["fan"]).json()["tracks"] == []
    done = client.post(f"/api/uploads/{up['id']}/approve", json={}, headers=admin).json()
    assert done["status"] == "published"
    out = client.get(f"/api/drops/{drop['slug']}", headers=studio["fan"]).json()
    assert out["status"] == "out" and out["track_id"] == done["track_id"] and out["album_id"]
    for who in ("fan", "ghost"):
        assert [t["id"] for t in client.get("/api/favorites", headers=studio[who]).json()["tracks"]] == [done["track_id"]]
    assert client.put(f"/api/drops/{pid}/presave", headers=studio["artist"]).status_code == 409  # too late to pre-save
    assert client.delete(f"/api/drops/{pid}/presave", headers=studio["fan"]).status_code == 204  # un-pre-saving keeps the favorite
    assert len(client.get("/api/favorites", headers=studio["fan"]).json()["tracks"]) == 1


def test_drop_upload_must_be_the_callers_unpublished_upload(client, studio):
    admin = studio["admin"]
    up = upload(client, admin, "05 - Artist Name - Other.wav", wav_bytes(fill=22))
    assert make_drop(client, studio["artist"], studio["artist_id"], upload_id=up["id"]).status_code == 400  # not theirs
    assert make_drop(client, admin, studio["artist_id"], upload_id="nope").status_code == 400
    client.post(f"/api/uploads/{up['id']}/approve", json={}, headers=admin)
    assert make_drop(client, admin, studio["artist_id"], upload_id=up["id"]).status_code == 400  # already published


def test_edit_and_delete_drop(client, studio):
    drop = make_drop(client, studio["artist"], studio["artist_id"]).json()
    pid = drop["id"]
    assert client.patch(f"/api/drops/{pid}", json={"title": "Hacked"}, headers=studio["fan"]).status_code == 403
    edited = client.patch(f"/api/drops/{pid}", json={"title": "Renamed", "description": "New"}, headers=studio["artist"]).json()
    assert edited["title"] == "Renamed" and edited["description"] == "New"
    assert client.patch(f"/api/drops/{pid}", json={"release_at": "2000-01-01T00:00:00Z"}, headers=studio["artist"]).status_code == 400
    assert client.delete(f"/api/drops/{pid}", headers=studio["fan"]).status_code == 403
    assert client.delete(f"/api/drops/{pid}", headers=studio["artist"]).status_code == 204
    assert client.get(f"/api/drops/{drop['slug']}", headers=studio["fan"]).status_code == 404


def test_artwork_upload_and_public_serving(client, studio):
    drop = make_drop(client, studio["artist"], studio["artist_id"]).json()
    pid = drop["id"]
    png = {"file": ("art.png", png_bytes(), "image/png")}
    assert client.post(f"/api/drops/{pid}/artwork", files=png, headers=studio["fan"]).status_code == 403
    bad = client.post(f"/api/drops/{pid}/artwork", files={"file": ("x.png", b"MZ nope", "image/png")}, headers=studio["artist"])
    assert bad.status_code == 400
    url = client.post(f"/api/drops/{pid}/artwork", files=png, headers=studio["artist"]).json()["artwork_url"]
    assert client.get(url).status_code == 200  # public, so link previews can load it
    assert client.get("/api/drop-art/not-a-real-name.png").status_code == 404


def test_smart_link_page(client, studio):
    drop = make_drop(client, studio["artist"], studio["artist_id"], title='Night <script>alert(1)</script> "Run"',
                     description="Out & about").json()
    client.post(f"/api/drops/{drop['id']}/artwork", files={"file": ("a.png", png_bytes(), "image/png")}, headers=studio["artist"])
    page = client.get(f"/s/{drop['slug']}")  # no login: link previews and strangers open it
    assert page.status_code == 200 and page.headers["content-type"].startswith("text/html")
    body = page.text
    assert "<script>alert(1)</script>" not in body and "&lt;script&gt;" in body
    assert 'property="og:title"' in body and "Artist Name" in body and "Out &amp; about" in body
    assert "/api/drop-art/" in body and f"/#/drop/{drop['slug']}" in body
    missing = client.get("/s/does-not-exist")
    assert missing.status_code == 404 and "does-not-exist" not in missing.text
