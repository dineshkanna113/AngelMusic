"""A stand-in for Stripe in tests. Webhooks are "signed" by prefixing the body with the secret."""

import json

from app.billing import Event, GatewayError, InvalidSignature

SECRET = "whsec_test"


def sign(body: dict) -> tuple[bytes, str]:
    payload = json.dumps(body).encode()
    return payload, f"{SECRET}:{len(payload)}"


class FakeGateway:
    def __init__(self, prices=None, fail=False):
        self.prices = prices or {"price_m": {"id": "price_m", "interval": "month", "amount": 499, "currency": "usd"},
                                 "price_y": {"id": "price_y", "interval": "year", "amount": 4900, "currency": "usd"}}
        self.fail = fail
        self.checkouts: list[dict] = []
        self.portals: list[dict] = []
        self.cancelled: list[str] = []

    def _maybe_fail(self):
        if self.fail:
            raise GatewayError("The payment provider could not be reached. Try again in a moment.")

    def create_checkout(self, **kw) -> str:
        self._maybe_fail()
        self.checkouts.append(kw)
        return f"https://checkout.test/{kw['price_id']}"

    def create_portal(self, **kw) -> str:
        self._maybe_fail()
        self.portals.append(kw)
        return f"https://portal.test/{kw['customer_id']}"

    def cancel_subscription(self, subscription_id: str) -> None:
        self._maybe_fail()
        self.cancelled.append(subscription_id)

    def parse_webhook(self, payload: bytes, signature: str) -> Event:
        if signature != f"{SECRET}:{len(payload)}":
            raise InvalidSignature()
        body = json.loads(payload)
        return Event(id=body["id"], type=body["type"], created=body["created"], object=body["data"]["object"])

    def get_price(self, price_id: str) -> dict:
        self._maybe_fail()
        return self.prices[price_id]
