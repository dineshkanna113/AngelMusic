import json
import time
from dataclasses import replace

import pytest

from .conftest import auth_headers, login_headers
from .fakes import FakeGateway, sign

DAY = 86400


@pytest.fixture
def paid(client):
    """Billing on with a fake Stripe; admin plus a regular user 'pat' (id 2)."""
    client.app.state.settings = replace(
        client.app.state.settings, stripe_secret_key="sk_test", stripe_webhook_secret="whsec_test",
        stripe_price_monthly="price_m", stripe_price_yearly="price_y", public_url="https://yaapu.test")
    gateway = FakeGateway()
    client.app.state.billing = gateway
    admin = auth_headers(client)
    pat = client.post("/api/users", json={"username": "pat", "password": "pat-pass-123"}, headers=admin).json()
    return {"admin": admin, "pat": login_headers(client, "pat", "pat-pass-123"), "pat_id": pat["id"], "gw": gateway}


def sub_object(user_id, status="active", cancel=False, ends=None, customer="cus_1", sub_id="sub_1", price="price_m", interval="month"):
    return {"id": sub_id, "customer": customer, "status": status, "cancel_at_period_end": cancel,
            "metadata": {"user_id": str(user_id)},
            "items": {"data": [{"price": {"id": price, "recurring": {"interval": interval}},
                                "current_period_end": ends if ends is not None else int(time.time()) + 10 * DAY}]}}


def event(client, type_, obj, id_="evt_1", created=1000, raw=None):
    payload, sig = sign({"id": id_, "type": type_, "created": created, "data": {"object": obj}})
    return client.post("/api/billing/webhook", content=raw or payload, headers={"stripe-signature": sig})


def plan(client, h):
    return client.get("/api/billing", headers=h).json()["plan"]


# ---- status ---------------------------------------------------------------------------------

def test_billing_off_reports_disabled_and_unlocked(client):
    h = auth_headers(client)
    body = client.get("/api/billing", headers=h).json()
    assert body["enabled"] is False and body["prices"] == []
    assert body["plan"]["premium"] is True and body["plan"]["source"] == "billing_off"
    assert client.post("/api/billing/checkout", json={"interval": "month"}, headers=h).status_code == 400


def test_free_user_sees_prices(client, paid):
    body = client.get("/api/billing", headers=paid["pat"]).json()
    assert body["enabled"] is True and body["plan"]["premium"] is False and body["plan"]["source"] == "free"
    assert [(p["interval"], p["amount"], p["currency"]) for p in body["prices"]] == [("month", 499, "usd"), ("year", 4900, "usd")]
    paid["gw"].fail = True
    again = client.get("/api/billing", headers=paid["pat"])
    assert again.status_code == 200  # cached; and a Stripe outage must not break the page


def test_prices_survive_a_stripe_outage_on_first_load(client, paid):
    paid["gw"].fail = True
    body = client.get("/api/billing", headers=paid["pat"]).json()
    assert body["prices"] == [] and body["plan"]["premium"] is False


def test_me_and_login_report_premium(client, paid):
    assert client.get("/api/auth/me", headers=paid["pat"]).json()["premium"] is False
    login = client.post("/api/auth/login", json={"username": "pat", "password": "pat-pass-123"}).json()
    assert login["user"]["premium"] is False
    event(client, "customer.subscription.created", sub_object(paid["pat_id"]))
    assert client.get("/api/auth/me", headers=paid["pat"]).json()["premium"] is True


# ---- checkout and portal ----------------------------------------------------------------------

def test_checkout_starts_a_hosted_session(client, paid):
    res = client.post("/api/billing/checkout", json={"interval": "month"}, headers=paid["pat"])
    assert res.status_code == 200 and res.json() == {"url": "https://checkout.test/price_m"}
    sent = paid["gw"].checkouts[0]
    assert sent["user_id"] == paid["pat_id"] and sent["customer_id"] is None and sent["price_id"] == "price_m"
    assert sent["success_url"] == "https://yaapu.test/#/premium?checkout=success"
    assert sent["cancel_url"] == "https://yaapu.test/#/premium"
    assert client.post("/api/billing/checkout", json={"interval": "year"}, headers=paid["pat"]).json()["url"].endswith("price_y")
    assert client.post("/api/billing/checkout", json={"interval": "week"}, headers=paid["pat"]).status_code == 422


def test_checkout_needs_a_configured_price(client, paid):
    client.app.state.settings = replace(client.app.state.settings, stripe_price_yearly="")
    assert client.post("/api/billing/checkout", json={"interval": "year"}, headers=paid["pat"]).status_code == 400


def test_checkout_sends_a_subscriber_to_the_portal_instead(client, paid):
    event(client, "customer.subscription.created", sub_object(paid["pat_id"]))
    res = client.post("/api/billing/checkout", json={"interval": "month"}, headers=paid["pat"])
    assert res.status_code == 409 and res.json()["portal"] is True and paid["gw"].checkouts == []


def test_a_lapsed_customer_reuses_their_stripe_customer(client, paid):
    event(client, "customer.subscription.created", sub_object(paid["pat_id"]), "e1", 100)
    event(client, "customer.subscription.deleted", sub_object(paid["pat_id"], status="canceled"), "e2", 200)
    client.post("/api/billing/checkout", json={"interval": "month"}, headers=paid["pat"])
    assert paid["gw"].checkouts[0]["customer_id"] == "cus_1"


def test_checkout_failure_is_a_clean_502(client, paid):
    paid["gw"].fail = True
    res = client.post("/api/billing/checkout", json={"interval": "month"}, headers=paid["pat"])
    assert res.status_code == 502 and "payment provider" in res.json()["detail"]


def test_portal(client, paid):
    assert client.post("/api/billing/portal", headers=paid["pat"]).status_code == 404
    event(client, "customer.subscription.created", sub_object(paid["pat_id"]))
    res = client.post("/api/billing/portal", headers=paid["pat"])
    assert res.json() == {"url": "https://portal.test/cus_1"}
    assert paid["gw"].portals[0]["return_url"] == "https://yaapu.test/#/settings"


# ---- webhook: trust --------------------------------------------------------------------------

def test_bad_signature_changes_nothing(client, paid):
    payload, _ = sign({"id": "evt_x", "type": "customer.subscription.created", "created": 5,
                       "data": {"object": sub_object(paid["pat_id"])}})
    assert client.post("/api/billing/webhook", content=payload, headers={"stripe-signature": "forged"}).status_code == 400
    assert client.post("/api/billing/webhook", content=payload).status_code == 400  # no header at all
    assert plan(client, paid["pat"])["premium"] is False
    with client.app.state.db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM webhook_events").fetchone()[0] == 0


def test_oversized_body_is_refused(client, paid):
    res = client.post("/api/billing/webhook", content=b"x" * (256 * 1024 + 1), headers={"stripe-signature": "s"})
    assert res.status_code == 413


def test_webhook_when_billing_is_off(client):
    assert client.post("/api/billing/webhook", content=b"{}", headers={"stripe-signature": "s"}).status_code == 404


# ---- webhook: state --------------------------------------------------------------------------

def test_subscription_created_grants_premium(client, paid):
    ends = int(time.time()) + 30 * DAY
    assert event(client, "customer.subscription.created", sub_object(paid["pat_id"], ends=ends, price="price_y", interval="year")).status_code == 200
    p = plan(client, paid["pat"])
    assert p["premium"] is True and p["source"] == "subscription" and p["status"] == "active"
    with client.app.state.db.connect() as conn:
        row = conn.execute("SELECT * FROM subscriptions WHERE user_id = ?", (paid["pat_id"],)).fetchone()
    assert (row["stripe_customer_id"], row["stripe_subscription_id"], row["price_id"], row["interval"]) == ("cus_1", "sub_1", "price_y", "year")


def test_older_stripe_api_shape_with_top_level_period_end(client, paid):
    obj = sub_object(paid["pat_id"])
    obj["items"]["data"][0].pop("current_period_end")
    obj["current_period_end"] = int(time.time()) + 5 * DAY
    event(client, "customer.subscription.created", obj)
    assert plan(client, paid["pat"])["premium"] is True


def test_redelivery_is_ignored(client, paid):
    event(client, "customer.subscription.created", sub_object(paid["pat_id"]), "evt_same", 100)
    with client.app.state.db.connect() as conn:
        conn.execute("UPDATE subscriptions SET status = 'canceled'")
    res = event(client, "customer.subscription.created", sub_object(paid["pat_id"]), "evt_same", 100)
    assert res.status_code == 200 and res.json()["duplicate"] is True
    assert plan(client, paid["pat"])["premium"] is False


def test_an_older_event_cannot_undo_a_newer_one(client, paid):
    event(client, "customer.subscription.updated", sub_object(paid["pat_id"], status="canceled"), "evt_new", 200)
    event(client, "customer.subscription.updated", sub_object(paid["pat_id"], status="active"), "evt_old", 100)
    assert plan(client, paid["pat"])["premium"] is False and plan(client, paid["pat"])["status"] == "canceled"


def test_cancel_at_period_end_and_deletion(client, paid):
    event(client, "customer.subscription.updated", sub_object(paid["pat_id"], cancel=True), "e1", 100)
    p = plan(client, paid["pat"])
    assert p["premium"] is True and p["cancel_at_period_end"] is True
    event(client, "customer.subscription.deleted", sub_object(paid["pat_id"], status="canceled"), "e2", 200)
    assert plan(client, paid["pat"])["premium"] is False


def test_failed_payment_enters_the_grace_window(client, paid):
    event(client, "customer.subscription.created", sub_object(paid["pat_id"]), "e1", 100)
    event(client, "invoice.payment_failed", {"customer": "cus_1", "subscription": "sub_1"}, "e2", 200)
    p = plan(client, paid["pat"])
    assert p["status"] == "past_due" and p["premium"] is True


def test_checkout_completion_links_the_customer_but_does_not_grant(client, paid):
    res = event(client, "checkout.session.completed", {"customer": "cus_9", "subscription": "sub_9",
                                                       "client_reference_id": str(paid["pat_id"]), "metadata": {"user_id": str(paid["pat_id"])}})
    assert res.status_code == 200
    assert plan(client, paid["pat"])["premium"] is False  # only a subscription event can grant
    assert client.post("/api/billing/portal", headers=paid["pat"]).json()["url"].endswith("cus_9")


def test_unknown_events_users_and_customers_are_ignored(client, paid):
    assert event(client, "charge.refunded", {"id": "ch_1"}, "e1").status_code == 200
    assert event(client, "customer.subscription.created", sub_object(99999), "e2").status_code == 200  # no such user
    assert event(client, "customer.subscription.created", {**sub_object(paid["pat_id"]), "metadata": {}}, "e3").status_code == 200
    assert plan(client, paid["pat"])["premium"] is False
    event(client, "customer.subscription.created", sub_object(paid["pat_id"]), "e4", 100)
    # Someone else's Stripe customer id claiming this user must not take over the row.
    event(client, "customer.subscription.updated", sub_object(paid["pat_id"], status="canceled", customer="cus_EVIL"), "e5", 200)
    assert plan(client, paid["pat"])["status"] == "active"


def test_a_failing_handler_can_be_retried(client, paid, monkeypatch):
    from app.routes import billing as routes

    def boom(*a, **k):
        raise RuntimeError("db hiccup")

    monkeypatch.setattr(routes, "_apply_subscription", boom)
    safe = client.__class__(client.app, raise_server_exceptions=False)
    payload, sig = sign({"id": "evt_r", "type": "customer.subscription.created", "created": 5,
                         "data": {"object": sub_object(paid["pat_id"])}})
    assert safe.post("/api/billing/webhook", content=payload, headers={"stripe-signature": sig}).status_code == 500
    monkeypatch.undo()
    assert client.post("/api/billing/webhook", content=payload, headers={"stripe-signature": sig}).status_code == 200  # not marked as seen
    assert plan(client, paid["pat"])["premium"] is True


# ---- admin grants and account deletion ------------------------------------------------------------

def test_admin_grants_and_clears_premium(client, paid):
    uid = paid["pat_id"]
    assert client.put(f"/api/users/{uid}/premium", json={"until": "2999-01-01"}, headers=paid["pat"]).status_code == 403
    assert client.put(f"/api/users/{uid}/premium", json={"until": "not a date"}, headers=paid["admin"]).status_code == 422
    assert client.put("/api/users/99999/premium", json={"until": "2999-01-01"}, headers=paid["admin"]).status_code == 404
    res = client.put(f"/api/users/{uid}/premium", json={"until": "2999-01-01"}, headers=paid["admin"])
    assert res.status_code == 200 and res.json()["comp_until"].startswith("2999-01-01")
    p = plan(client, paid["pat"])
    assert p["premium"] is True and p["source"] == "comp"
    listed = {u["username"]: u for u in client.get("/api/users", headers=paid["admin"]).json()["users"]}
    assert listed["pat"]["comp_until"].startswith("2999-01-01")
    client.put(f"/api/users/{uid}/premium", json={"until": None}, headers=paid["admin"])
    assert plan(client, paid["pat"])["premium"] is False


def test_deleting_an_account_cancels_the_subscription(client, paid):
    event(client, "customer.subscription.created", sub_object(paid["pat_id"]))
    res = client.request("DELETE", "/api/auth/account", json={"password": "pat-pass-123"}, headers=paid["pat"])
    assert res.status_code == 204 and paid["gw"].cancelled == ["sub_1"]


def test_account_deletion_still_works_if_stripe_is_down(client, paid):
    event(client, "customer.subscription.created", sub_object(paid["pat_id"]))
    paid["gw"].fail = True
    res = client.request("DELETE", "/api/auth/account", json={"password": "pat-pass-123"}, headers=paid["pat"])
    assert res.status_code == 204
    assert json.dumps(client.get("/api/users", headers=paid["admin"]).json()).count("pat-pass") == 0
    with client.app.state.db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM users WHERE username = 'pat'").fetchone()[0] == 0
