import time

import pytest

from .conftest import stream_token, tracks
from .test_billing import event, paid, sub_object  # noqa: F401  (paid is a fixture)
from .test_growth_helpers import png_bytes


def first_track(client, h):
    return tracks(client, h)[0]["id"]


# ---- offline downloads --------------------------------------------------------------------------

def test_free_users_cannot_download_but_can_stream(client, paid):
    h = paid["pat"]
    tid, tok = first_track(client, h), stream_token(client, h)
    res = client.get(f"/api/download/{tid}", params={"t": tok})
    assert res.status_code == 402
    assert res.json() == {"detail": "Offline listening is a Premium feature", "code": "premium_required"}
    assert client.get(f"/api/stream/{tid}", params={"t": tok}).status_code == 200  # listening is never blocked


def test_subscribers_and_comped_users_can_download(client, paid):
    h = paid["pat"]
    tid, tok = first_track(client, h), stream_token(client, h)
    event(client, "customer.subscription.created", sub_object(paid["pat_id"]))
    assert client.get(f"/api/download/{tid}", params={"t": tok}).status_code == 200
    event(client, "customer.subscription.deleted", sub_object(paid["pat_id"], status="canceled"), "e2", 2000)
    assert client.get(f"/api/download/{tid}", params={"t": tok}).status_code == 402
    client.put(f"/api/users/{paid['pat_id']}/premium", json={"until": "2999-01-01"}, headers=paid["admin"])
    assert client.get(f"/api/download/{tid}", params={"t": tok}).status_code == 200


def test_billing_off_leaves_downloads_open(client):
    from .conftest import auth_headers

    h = auth_headers(client)
    assert client.get(f"/api/download/{first_track(client, h)}", params={"t": stream_token(client, h)}).status_code == 200


def test_subsonic_downloads_follow_the_same_rule(client, paid):
    h = paid["pat"]
    tid = first_track(client, h)
    pw = client.post("/api/auth/app-password", headers=h).json()["app_password"]
    params = {"u": "pat", "p": "enc:" + pw.encode().hex(), "f": "json", "id": tid}
    denied = client.get("/rest/download", params=params).json()["subsonic-response"]
    assert denied["status"] == "failed" and denied["error"]["code"] == 50
    assert client.get("/rest/stream", params=params).status_code == 200
    client.put(f"/api/users/{paid['pat_id']}/premium", json={"until": "2999-01-01"}, headers=paid["admin"])
    assert client.get("/rest/download", params=params).status_code == 200


# ---- promos -----------------------------------------------------------------------------------------

def make(client, h, **kw):
    body = {"title": "New drop", "body": "Out Friday", "link": "https://example.com/x", **kw}
    return client.post("/api/promos", json=body, headers=h)


def test_only_admins_manage_promos(client, paid):
    assert make(client, paid["pat"]).status_code == 403
    assert client.get("/api/promos/all", headers=paid["pat"]).status_code == 403
    res = make(client, paid["admin"])
    assert res.status_code == 201 and res.json()["title"] == "New drop" and res.json()["active"] is True
    pid = res.json()["id"]
    assert client.patch(f"/api/promos/{pid}", json={"title": "x"}, headers=paid["pat"]).status_code == 403
    assert client.delete(f"/api/promos/{pid}", headers=paid["pat"]).status_code == 403


def test_promo_validation(client, paid):
    a = paid["admin"]
    assert make(client, a, title="").status_code == 422
    assert make(client, a, title="x" * 81).status_code == 422
    assert make(client, a, body="x" * 201).status_code == 422
    for bad in ("javascript:alert(1)", "http://insecure.example", "//evil.example", "data:text/html,hi", "ftp://x"):
        assert make(client, a, link=bad).status_code == 422, bad
    assert make(client, a, link="#/browse").status_code == 201  # a route inside the app
    assert make(client, a, link=None).status_code == 201
    assert make(client, a, starts_at="2030-01-02", ends_at="2030-01-01").status_code == 422
    assert make(client, a, starts_at="garbage").status_code == 422


def test_free_users_see_only_live_promos(client, paid):
    a, pat = paid["admin"], paid["pat"]
    make(client, a, title="Live")
    make(client, a, title="Paused", active=False)
    make(client, a, title="Later", starts_at="2999-01-01")
    make(client, a, title="Over", ends_at="2000-01-01")
    assert [p["title"] for p in client.get("/api/promos", headers=pat).json()["promos"]] == ["Live"]
    everything = client.get("/api/promos/all", headers=a).json()["promos"]
    assert {p["title"] for p in everything} == {"Live", "Paused", "Later", "Over"}


def test_at_most_three_promos_and_none_for_premium_or_billing_off(client, paid):
    a, pat = paid["admin"], paid["pat"]
    for n in range(5):
        make(client, a, title=f"P{n}")
    assert len(client.get("/api/promos", headers=pat).json()["promos"]) == 3
    event(client, "customer.subscription.created", sub_object(paid["pat_id"]))
    assert client.get("/api/promos", headers=pat).json()["promos"] == []
    assert client.get("/api/promos", headers=a).json()["promos"] != []  # the admin is on the free plan here


def test_no_promos_when_billing_is_off(client):
    from .conftest import auth_headers

    h = auth_headers(client)
    make(client, h)
    assert client.get("/api/promos", headers=h).json()["promos"] == []


def test_edit_pause_and_delete(client, paid):
    a = paid["admin"]
    pid = make(client, a).json()["id"]
    edited = client.patch(f"/api/promos/{pid}", json={"title": "Renamed", "active": False}, headers=a).json()
    assert edited["title"] == "Renamed" and edited["active"] is False
    assert client.patch(f"/api/promos/{pid}", json={"link": "http://bad.example"}, headers=a).status_code == 422
    assert client.patch("/api/promos/9999", json={"title": "x"}, headers=a).status_code == 404
    assert client.delete(f"/api/promos/{pid}", headers=a).status_code == 204
    assert client.get("/api/promos/all", headers=a).json()["promos"] == []


def test_promo_images(client, paid):
    a = paid["admin"]
    pid = make(client, a).json()["id"]
    png = {"file": ("p.png", png_bytes(), "image/png")}
    assert client.post(f"/api/promos/{pid}/image", files=png, headers=paid["pat"]).status_code == 403
    assert client.post(f"/api/promos/{pid}/image", files={"file": ("x.png", b"MZ nope", "image/png")}, headers=a).status_code == 400
    big = {"file": ("b.png", png_bytes() + b"0" * (2 * 1024 * 1024), "image/png")}
    assert client.post(f"/api/promos/{pid}/image", files=big, headers=a).status_code == 413
    url = client.post(f"/api/promos/{pid}/image", files=png, headers=a).json()["image_url"]
    assert client.get(url).status_code == 200
    assert client.get("/api/promo-art/not-real.png").status_code == 404
    client.delete(f"/api/promos/{pid}", headers=a)
    assert client.get(url).status_code == 404  # the file goes with the promo
