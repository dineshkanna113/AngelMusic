"""The only place that talks to Stripe. Routes depend on the `BillingGateway` interface, so tests use a
fake and never touch the network. Card details never pass through here: Stripe's hosted Checkout takes
them, and the customer portal lets people manage or cancel."""

import json
import logging
from dataclasses import dataclass
from typing import Protocol

log = logging.getLogger("yaapu.billing")


class InvalidSignature(Exception):
    """The webhook body was not signed by Stripe with our secret."""


class GatewayError(Exception):
    """Stripe refused or could not be reached. The message is safe to show; it never holds secrets."""


@dataclass(frozen=True)
class Event:
    id: str
    type: str
    created: int
    object: dict  # event.data.object as a plain dict


class BillingGateway(Protocol):
    def create_checkout(self, *, user_id: int, customer_id: str | None, price_id: str,
                        success_url: str, cancel_url: str) -> str: ...
    def create_portal(self, *, customer_id: str, return_url: str) -> str: ...
    def cancel_subscription(self, subscription_id: str) -> None: ...
    def parse_webhook(self, payload: bytes, signature: str) -> Event: ...
    def get_price(self, price_id: str) -> dict: ...


class StripeGateway:
    def __init__(self, secret_key: str, webhook_secret: str):
        import stripe

        self._stripe = stripe
        self._client = stripe.StripeClient(secret_key)
        self._webhook_secret = webhook_secret

    def create_checkout(self, *, user_id, customer_id, price_id, success_url, cancel_url) -> str:
        params = {
            "mode": "subscription",
            "line_items": [{"price": price_id, "quantity": 1}],
            "success_url": success_url,
            "cancel_url": cancel_url,
            "client_reference_id": str(user_id),
            "metadata": {"user_id": str(user_id)},
            "subscription_data": {"metadata": {"user_id": str(user_id)}},
            "allow_promotion_codes": True,
        }
        if customer_id:
            params["customer"] = customer_id
        return self._call(lambda: self._client.checkout.sessions.create(params=params)).url

    def create_portal(self, *, customer_id, return_url) -> str:
        return self._call(lambda: self._client.billing_portal.sessions.create(
            params={"customer": customer_id, "return_url": return_url})).url

    def cancel_subscription(self, subscription_id: str) -> None:
        self._call(lambda: self._client.subscriptions.cancel(subscription_id))

    def parse_webhook(self, payload: bytes, signature: str) -> Event:
        try:
            self._stripe.Webhook.construct_event(payload, signature, self._webhook_secret)
            body = json.loads(payload)
        except (self._stripe.SignatureVerificationError, ValueError):
            raise InvalidSignature()
        return Event(id=body["id"], type=body["type"], created=int(body.get("created", 0)),
                     object=body.get("data", {}).get("object", {}))

    def get_price(self, price_id: str) -> dict:
        price = self._call(lambda: self._client.prices.retrieve(price_id))
        recurring = price.recurring
        return {"id": price.id, "interval": recurring.interval if recurring else None,
                "amount": price.unit_amount, "currency": price.currency}

    def _call(self, fn):
        try:
            return fn()
        except self._stripe.StripeError as err:
            log.warning("Stripe call failed: %s", type(err).__name__)  # never log the message or request
            raise GatewayError("The payment provider could not be reached. Try again in a moment.")


def make_gateway(settings) -> BillingGateway | None:
    return StripeGateway(settings.stripe_secret_key, settings.stripe_webhook_secret) if settings.billing_enabled else None
