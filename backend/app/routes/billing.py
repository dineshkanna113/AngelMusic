"""Billing: what the user has, how to buy it, and the Stripe webhook that is the only thing allowed to
grant or remove Premium. Card details never reach this server: Stripe's hosted Checkout and portal take them."""

import logging
import time
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .. import entitlements
from ..billing import GatewayError, InvalidSignature
from ..security import current_user

log = logging.getLogger("yaapu.billing")
router = APIRouter(prefix="/api", tags=["billing"])

MAX_WEBHOOK_BYTES = 256 * 1024
PRICE_CACHE_SECONDS = 600
_TIME = "%Y-%m-%d %H:%M:%S"
LIVE_STATUSES = ("active", "trialing", "past_due")


class CheckoutBody(BaseModel):
    interval: Literal["month", "year"]


def _gateway(request: Request):
    state = request.app.state
    if not state.settings.billing_enabled or state.billing is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Billing is not set up on this server")
    return state.billing


def _base_url(request: Request) -> str:
    return request.app.state.settings.public_url or str(request.base_url).rstrip("/")


def _prices(request: Request) -> list[dict]:
    """The configured prices, read from Stripe and cached. A Stripe outage gives an empty list, not an error."""
    state = request.app.state
    settings = state.settings
    cache = getattr(state, "price_cache", None)
    if cache and time.monotonic() - cache[0] < PRICE_CACHE_SECONDS and cache[2] == (settings.stripe_price_monthly, settings.stripe_price_yearly):
        return cache[1]
    found = []
    for price_id in (settings.stripe_price_monthly, settings.stripe_price_yearly):
        if not price_id:
            continue
        try:
            found.append(state.billing.get_price(price_id))
        except GatewayError:
            return cache[1] if cache else []
    state.price_cache = (time.monotonic(), found, (settings.stripe_price_monthly, settings.stripe_price_yearly))
    return found


@router.get("/billing")
def billing_status(request: Request, user: dict = Depends(current_user)):
    state = request.app.state
    with state.db.connect() as conn:
        plan = entitlements.plan(conn, state.settings, user["id"])
    enabled = state.settings.billing_enabled and state.billing is not None
    return {"enabled": enabled, "plan": plan, "prices": _prices(request) if enabled else []}


@router.post("/billing/checkout")
def checkout(body: CheckoutBody, request: Request, user: dict = Depends(current_user)):
    gateway = _gateway(request)
    settings = request.app.state.settings
    price_id = settings.stripe_price_monthly if body.interval == "month" else settings.stripe_price_yearly
    if not price_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"No {body.interval}ly price is set up")
    with request.app.state.db.connect() as conn:
        sub = conn.execute("SELECT * FROM subscriptions WHERE user_id = ?", (user["id"],)).fetchone()
    if sub and sub["status"] in LIVE_STATUSES:
        return JSONResponse({"detail": "You already have a subscription. Manage it from your billing page.", "portal": True},
                            status_code=status.HTTP_409_CONFLICT)
    base = _base_url(request)
    try:
        url = gateway.create_checkout(user_id=user["id"], customer_id=sub["stripe_customer_id"] if sub else None,
                                      price_id=price_id, success_url=f"{base}/#/premium?checkout=success",
                                      cancel_url=f"{base}/#/premium")
    except GatewayError as err:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(err))
    return {"url": url}


@router.post("/billing/portal")
def portal(request: Request, user: dict = Depends(current_user)):
    gateway = _gateway(request)
    with request.app.state.db.connect() as conn:
        sub = conn.execute("SELECT stripe_customer_id FROM subscriptions WHERE user_id = ?", (user["id"],)).fetchone()
    if not sub or not sub["stripe_customer_id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "You have no billing history yet")
    try:
        return {"url": gateway.create_portal(customer_id=sub["stripe_customer_id"], return_url=f"{_base_url(request)}/#/settings")}
    except GatewayError as err:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(err))


# ---- webhook -------------------------------------------------------------------------------------

def _stamp(epoch) -> str | None:
    return datetime.fromtimestamp(int(epoch), timezone.utc).strftime(_TIME) if epoch else None


def _user_for(conn, obj: dict):
    """The user an event is about: the id we put in the metadata, else the Stripe customer we linked earlier."""
    raw = (obj.get("metadata") or {}).get("user_id") or obj.get("client_reference_id")
    if raw and str(raw).isdigit():
        user = conn.execute("SELECT id FROM users WHERE id = ?", (int(raw),)).fetchone()
        if user:
            return user["id"]
        return None
    customer = obj.get("customer")
    if customer:
        row = conn.execute("SELECT user_id FROM subscriptions WHERE stripe_customer_id = ?", (customer,)).fetchone()
        if row:
            return row["user_id"]
    return None


def _customer_ok(existing, customer) -> bool:
    """A user's row is tied to one Stripe customer; an event naming another customer is not applied."""
    return not existing or not customer or existing["stripe_customer_id"] in (None, customer)


def _apply_checkout(conn, obj: dict) -> None:
    """Remember which Stripe customer belongs to the user. This never grants Premium."""
    user_id = _user_for(conn, obj)
    if user_id is None or not obj.get("customer"):
        return
    existing = conn.execute("SELECT * FROM subscriptions WHERE user_id = ?", (user_id,)).fetchone()
    if not _customer_ok(existing, obj["customer"]):
        return log.warning("Ignoring a checkout for a different customer")
    if existing:
        conn.execute("UPDATE subscriptions SET stripe_customer_id = ?, stripe_subscription_id = COALESCE(?, stripe_subscription_id) WHERE user_id = ?",
                     (obj["customer"], obj.get("subscription"), user_id))
    else:
        conn.execute("INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status) VALUES (?, ?, ?, 'incomplete')",
                     (user_id, obj["customer"], obj.get("subscription")))


def _apply_subscription(conn, event, obj: dict) -> None:
    user_id = _user_for(conn, obj)
    if user_id is None:
        return log.info("Subscription event for an unknown user ignored")
    existing = conn.execute("SELECT * FROM subscriptions WHERE user_id = ?", (user_id,)).fetchone()
    if not _customer_ok(existing, obj.get("customer")):
        return log.warning("Ignoring a subscription event for a different customer")
    if existing and event.created < existing["last_event_created"]:
        return  # an older event that arrived late
    item = ((obj.get("items") or {}).get("data") or [{}])[0]
    price = item.get("price") or {}
    ends = _stamp(item.get("current_period_end") or obj.get("current_period_end"))
    status_ = "canceled" if event.type == "customer.subscription.deleted" else obj.get("status", "incomplete")
    values = (obj.get("customer"), obj.get("id"), status_, price.get("id"), (price.get("recurring") or {}).get("interval"),
              ends, int(bool(obj.get("cancel_at_period_end"))), event.created)
    if existing:
        conn.execute(
            """UPDATE subscriptions SET stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_subscription_id = COALESCE(?, stripe_subscription_id),
                   status = ?, price_id = COALESCE(?, price_id), interval = COALESCE(?, interval),
                   current_period_end = COALESCE(?, current_period_end), cancel_at_period_end = ?, last_event_created = ?,
                   updated_at = CURRENT_TIMESTAMP WHERE user_id = ?""", (*values, user_id))
    else:
        conn.execute(
            """INSERT INTO subscriptions (stripe_customer_id, stripe_subscription_id, status, price_id, interval,
                   current_period_end, cancel_at_period_end, last_event_created, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""", values + (user_id,))


def _apply_payment_failed(conn, event, obj: dict) -> None:
    user_id = _user_for(conn, obj)
    if user_id is None:
        return
    row = conn.execute("SELECT * FROM subscriptions WHERE user_id = ?", (user_id,)).fetchone()
    if row and row["status"] in ("active", "trialing") and event.created >= row["last_event_created"]:
        conn.execute("UPDATE subscriptions SET status = 'past_due', last_event_created = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
                     (event.created, user_id))


def _dispatch(conn, event) -> None:
    if event.type == "checkout.session.completed":
        _apply_checkout(conn, event.object)
    elif event.type in ("customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"):
        _apply_subscription(conn, event, event.object)
    elif event.type == "invoice.payment_failed":
        _apply_payment_failed(conn, event, event.object)


@router.post("/billing/webhook")
async def webhook(request: Request):
    """Stripe calls this. Nothing is trusted until the signature checks out; each event id is applied once."""
    state = request.app.state
    if not state.settings.billing_enabled or state.billing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_WEBHOOK_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Too large")
    body = b""
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_WEBHOOK_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Too large")
    signature = request.headers.get("stripe-signature")
    if not signature:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Missing signature")
    try:
        event = state.billing.parse_webhook(body, signature)
    except InvalidSignature:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid signature")
    # One transaction: if applying the event fails, the "seen" mark is rolled back too and Stripe's retry works.
    with state.db.connect() as conn:
        if conn.execute("INSERT OR IGNORE INTO webhook_events (id, type) VALUES (?, ?)", (event.id, event.type)).rowcount == 0:
            return {"received": True, "duplicate": True}
        _dispatch(conn, event)
    return {"received": True}
