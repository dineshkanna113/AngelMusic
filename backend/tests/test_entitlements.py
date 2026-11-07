from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from app import entitlements

from .conftest import auth_headers

NOW = datetime(2030, 6, 15, 12, 0, tzinfo=timezone.utc)


def stamp(delta: timedelta) -> str:
    return (NOW + delta).strftime("%Y-%m-%d %H:%M:%S")


@pytest.fixture
def billed(client):
    """An app with billing on, one user, and helpers to set that user's subscription."""
    auth_headers(client)
    settings = replace(client.app.state.settings, stripe_secret_key="sk_test_x", stripe_webhook_secret="whsec_x",
                       stripe_price_monthly="price_m", billing_grace_days=3)
    db = client.app.state.db

    def subscribe(status="active", ends=timedelta(days=10), cancel=False, user_id=1):
        with db.connect() as conn:
            conn.execute("DELETE FROM subscriptions WHERE user_id = ?", (user_id,))
            conn.execute(
                """INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, price_id,
                       interval, current_period_end, cancel_at_period_end) VALUES (?, 'cus_1', 'sub_1', ?, 'price_m', 'month', ?, ?)""",
                (user_id, status, None if ends is None else stamp(ends), int(cancel)),
            )

    def check(**kw):
        with db.connect() as conn:
            return entitlements.plan(conn, settings, 1, NOW), entitlements.is_premium(conn, settings, 1, NOW)

    return settings, db, subscribe, check


def test_billing_is_enabled_only_when_fully_configured(client):
    base = client.app.state.settings
    assert base.billing_enabled is False
    assert replace(base, stripe_secret_key="sk").billing_enabled is False
    assert replace(base, stripe_secret_key="sk", stripe_webhook_secret="wh").billing_enabled is False  # no price
    assert replace(base, stripe_secret_key="sk", stripe_webhook_secret="wh", stripe_price_yearly="p").billing_enabled is True


def test_billing_off_unlocks_everything(client):
    auth_headers(client)
    with client.app.state.db.connect() as conn:
        p = entitlements.plan(conn, client.app.state.settings, 1, NOW)
    assert p["premium"] is True and p["source"] == "billing_off"


def test_no_subscription_is_free(billed):
    _, _, _, check = billed
    plan, premium = check()
    assert premium is False and plan["source"] == "free" and plan["status"] is None


@pytest.mark.parametrize("status", ["active", "trialing"])
def test_live_subscription_is_premium(billed, status):
    _, _, subscribe, check = billed
    subscribe(status)
    plan, premium = check()
    assert premium is True and plan["source"] == "subscription" and plan["status"] == status
    assert plan["current_period_end"].startswith("2030-06-25")


@pytest.mark.parametrize("status", ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"])
def test_dead_subscription_is_free(billed, status):
    _, _, subscribe, check = billed
    subscribe(status)
    assert check()[1] is False


def test_past_due_keeps_premium_through_the_grace_window(billed):
    _, _, subscribe, check = billed
    subscribe("past_due", ends=timedelta(days=-2))  # period ended 2 days ago, grace is 3
    assert check()[1] is True
    subscribe("past_due", ends=timedelta(days=-3, seconds=-1))
    assert check()[1] is False
    subscribe("past_due", ends=timedelta(days=5))
    assert check()[1] is True


def test_a_stale_active_row_stops_after_the_grace_window(billed):
    _, _, subscribe, check = billed
    subscribe("active", ends=timedelta(days=-2))
    assert check()[1] is True  # a renewal webhook may be a little late
    subscribe("active", ends=timedelta(days=-4))
    assert check()[1] is False
    subscribe("active", ends=None)  # no end date recorded yet
    assert check()[1] is True


def test_cancel_at_period_end_stays_premium_until_the_period_ends(billed):
    _, _, subscribe, check = billed
    subscribe("active", ends=timedelta(days=4), cancel=True)
    plan, premium = check()
    assert premium is True and plan["cancel_at_period_end"] is True
    subscribe("active", ends=timedelta(seconds=-1), cancel=True)
    assert check()[1] is False  # no grace for someone who chose to leave
    subscribe("active", ends=timedelta(0), cancel=True)
    assert check()[1] is True  # exactly at the end still counts


def test_comp_grant_unlocks_until_its_date(billed):
    _, db, _, check = billed
    with db.connect() as conn:
        conn.execute("UPDATE users SET comp_until = ? WHERE id = 1", (stamp(timedelta(days=1)),))
    plan, premium = check()
    assert premium is True and plan["source"] == "comp"
    with db.connect() as conn:
        conn.execute("UPDATE users SET comp_until = ? WHERE id = 1", (stamp(timedelta(seconds=-1)),))
    assert check()[1] is False


def test_comp_wins_over_a_dead_subscription_and_subscription_wins_over_expired_comp(billed):
    _, db, subscribe, check = billed
    subscribe("canceled")
    with db.connect() as conn:
        conn.execute("UPDATE users SET comp_until = ? WHERE id = 1", (stamp(timedelta(days=30)),))
    assert check()[0]["source"] == "comp"
    subscribe("active")
    with db.connect() as conn:
        conn.execute("UPDATE users SET comp_until = ? WHERE id = 1", (stamp(timedelta(days=-30)),))
    assert check()[0]["source"] == "subscription"


def test_deleting_a_user_removes_their_subscription(billed):
    _, db, subscribe, _ = billed
    subscribe("active")
    with db.connect() as conn:
        conn.execute("DELETE FROM users WHERE id = 1")
        assert conn.execute("SELECT COUNT(*) FROM subscriptions").fetchone()[0] == 0


def test_an_existing_database_gains_the_comp_column(tmp_path):
    import sqlite3

    from app.db import Database

    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)")
    old.commit()
    old.close()
    db = Database(path)
    with db.connect() as conn:
        assert "comp_until" in {r["name"] for r in conn.execute("PRAGMA table_info(users)")}
