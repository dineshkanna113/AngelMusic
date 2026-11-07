# Billing with Stripe

Yaapu has two plans. **Free** listeners can stream everything in full lossless quality, but they cannot save music for
offline listening and they see promo cards on Home and Browse. **Premium** listeners can save music offline and see no promos.

If Stripe is not configured, billing is **off**: every user counts as Premium, no promos appear, and no upgrade screens show.
That is the default for self-hosted servers and the private beta.

Card details never reach Yaapu. Stripe's hosted Checkout takes the payment and Stripe's customer portal handles cancelling
and changing cards. Yaapu stores only Stripe's customer and subscription IDs, the status, and the dates.

## What you need

1. A Stripe account. Everything below starts in **test mode** (no real money).
2. Two recurring prices (monthly and/or yearly) on one product. **You choose the amounts and currency in Stripe**; the app
   reads them from Stripe and never stores a price of its own.
3. The business details Stripe asks for: who the seller is, their country, and a public support contact. Decide your
   refund and cancellation policy before going live (see "Going live").

## Set up in test mode

1. In the Stripe dashboard, switch to **Test mode**.
2. **Product catalogue**: create a product called "Yaapu Premium". Add a **recurring** price for each billing period you want
   to offer. Copy each price's ID (it starts with `price_`).
3. **Developers, API keys**: copy the **Secret key** (`sk_test_...`).
4. **Developers, Webhooks**: add an endpoint `https://YOUR-DOMAIN/api/billing/webhook` and enable these events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`

   Copy the endpoint's **Signing secret** (`whsec_...`).
5. **Settings, Billing, Customer portal**: turn the portal on, and allow customers to cancel and update payment methods.
6. Put the values in `deploy/.env`:

   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_PRICE_MONTHLY=price_...
   STRIPE_PRICE_YEARLY=price_...
   ```

   Billing turns on only when the secret key, the webhook secret and at least one price are all set. Restart with
   `docker compose up -d`.

## Test it locally

Use the Stripe CLI so Stripe can reach your laptop:

```
stripe login
stripe listen --forward-to localhost:8000/api/billing/webhook
```

The CLI prints a signing secret for that session; use it as `STRIPE_WEBHOOK_SECRET` while testing. Then sign in, open
**Premium**, choose a plan, and pay with Stripe's test card `4242 4242 4242 4242` (any future date, any CVC). Useful others:
`4000 0000 0000 0341` (card is attached, then payment fails), `4000 0000 0000 9995` (insufficient funds).

What you should see: after paying, the Premium page says "Checking your payment" and then "You're Premium" within a few
seconds. If the webhook is not reaching the server, it says "can take a minute" and **nothing unlocks**. That is correct:
Premium is granted only by Stripe's signed webhook, never by the return page.

## How access is decided

One rule, in `backend/app/entitlements.py`:

| Situation | Premium? |
|---|---|
| Billing off | Yes |
| An admin gift (`comp_until` in the future) | Yes, until that date |
| Subscription `active` or `trialing` | Yes, through the paid period plus the grace days (late renewal webhook) |
| Subscription set to cancel at period end | Yes, exactly until the period ends |
| Payment failed (`past_due`) | Yes, until the period end plus the grace days while Stripe retries |
| Cancelled, unpaid, incomplete | No |

`BILLING_GRACE_DAYS` (default 3) sets the grace. Admins can gift Premium to testers, artists or press from
**Settings, Users, Gift Premium**, or with `python -m app.manage grant-premium USERNAME --days 90`.

## What is and is not enforced

- **Offline saving is enforced by the server**: the download endpoint (and the Subsonic `download` call) refuse Free users.
  Streaming is never blocked.
- This is **not copy protection**. A determined user could still save a stream by other means. Stopping that needs DRM,
  which this app does not have and which is a separate project.
- **Promos are not ads from an ad network.** They are cards an admin writes (title, text, image, link, dates) under
  **Settings, Promos**. Real advertising would be a separate project.

## Deleting accounts

When a user deletes their account, Yaapu cancels their Stripe subscription first. If Stripe is unreachable the account is
still deleted and the server logs a line telling you to cancel that subscription in the dashboard.

## Going live (checklist)

- [ ] Legal pages reviewed by a lawyer (Terms, Privacy, Refunds are **drafts** in the app and say so).
- [ ] Refund and cancellation policy decided and written into the Terms and Refunds pages.
- [ ] Stripe account activated with the real business details and bank account.
- [ ] Tax: decide whether to use Stripe Tax and set tax behaviour on the prices.
- [ ] Switch to **live** keys: new `sk_live_...`, a new webhook endpoint (live mode has its own signing secret), live prices.
- [ ] Statement descriptor and support email set in Stripe.
- [ ] Place one real small purchase and refund it.
- [ ] `STRIPE_*` values stored as secrets (AWS Secrets Manager or SSM), not in the repository.
- [ ] Alert on webhook failures (Stripe dashboard shows failed deliveries; set up the email alert).

## Operations

- Stripe retries failed webhooks for days. Every event is applied once (by event id), and an older event never overwrites a
  newer one, so retries and re-sends are safe.
- The webhook route must be reachable from the public internet and must not sit behind login or a WAF rule that blocks
  Stripe's requests. Bodies over 256 KB are refused.
- Nothing logs card data, the secret key, the webhook secret or webhook bodies.
