"""Who gets Premium. Every gate (offline downloads, promos, the UI) asks `is_premium`, and nothing
else decides it. The `subscriptions` table is written only by verified Stripe webhooks."""

from datetime import datetime, timedelta, timezone

_TIME = "%Y-%m-%d %H:%M:%S"
LIVE = ("active", "trialing")


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.strptime(value[:19].replace("T", " "), _TIME).replace(tzinfo=timezone.utc)


def _subscription_premium(sub, grace: timedelta, now: datetime) -> bool:
    ends = _parse(sub["current_period_end"])
    if sub["status"] == "past_due":
        # Stripe is retrying the payment: keep Premium a little past the paid period.
        return ends is not None and now <= ends + grace
    if sub["status"] not in LIVE:
        return False
    if ends is None:
        return True  # a new subscription whose dates have not arrived yet
    if sub["cancel_at_period_end"]:
        return now <= ends  # they chose to leave: no grace
    return now <= ends + grace  # a renewal webhook may be a little late


def plan(conn, settings, user_id: int, now: datetime | None = None) -> dict:
    """{premium, source: billing_off | comp | subscription | free, status, current_period_end, cancel_at_period_end}"""
    now = now or datetime.now(timezone.utc)
    sub = conn.execute("SELECT * FROM subscriptions WHERE user_id = ?", (user_id,)).fetchone()
    info = {
        "status": sub["status"] if sub else None,
        "current_period_end": sub["current_period_end"] if sub else None,
        "cancel_at_period_end": bool(sub["cancel_at_period_end"]) if sub else False,
    }
    if not settings.billing_enabled:
        return {"premium": True, "source": "billing_off", **info}
    user = conn.execute("SELECT comp_until FROM users WHERE id = ?", (user_id,)).fetchone()
    comp = _parse(user["comp_until"]) if user else None
    if comp and comp > now:
        return {"premium": True, "source": "comp", **info}
    if sub and _subscription_premium(sub, timedelta(days=settings.billing_grace_days), now):
        return {"premium": True, "source": "subscription", **info}
    return {"premium": False, "source": "free", **info}


def is_premium(conn, settings, user_id: int, now: datetime | None = None) -> bool:
    return plan(conn, settings, user_id, now)["premium"]


PREMIUM_REQUIRED = {"detail": "Offline listening is a Premium feature", "code": "premium_required"}
