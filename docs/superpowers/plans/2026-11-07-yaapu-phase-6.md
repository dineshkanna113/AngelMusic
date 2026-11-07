# Yaapu Phase 6: Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a paid **Premium** plan sold through **Stripe**. Free users see promos and cannot save music offline; Premium users get neither limit. Everything stays unlocked when billing is not configured, so self-hosters and the private beta are unaffected.

**Decisions made by the owner (2026-11-07):** Stripe only. Plans: Free and Premium (no Family or Student). Premium unlocks **offline downloads** and **no ads**. Lossless streaming stays free for everyone, because it is the product's identity. Licensing work (DDEX import, royalty reports) is **out of scope** for this phase.

**Architecture:** A `subscriptions` table is the single source of truth for what a user has paid for, and it is changed only by verified Stripe webhooks, never by what the browser says. One function, `entitlements.is_premium(conn, user_id)`, answers "does this user get Premium?" for every gate. Stripe is called through a small `BillingGateway` interface so tests use a fake and never touch the network. Hosted Stripe Checkout and the Stripe customer portal handle card entry and plan management, so card data never reaches Yaapu's servers.

**Tech Stack:** FastAPI, SQLite, the official `stripe` Python SDK (pinned) behind the gateway; React 19 and Vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-yaapu-design.md` (Phase 6, "Business"). Builds on branch `yaapu-phase-5`.

## Global Constraints

- **Money is moved only by Stripe.** Yaapu stores customer and subscription IDs, status and dates. No card numbers, no bank details, no secrets in the database or logs.
- **Only a verified webhook grants or removes Premium.** The checkout success page, query strings and client state never do. A user cannot reach Premium by calling an endpoint.
- **Billing off means everything is on.** If `STRIPE_SECRET_KEY` is unset, `/api/billing` reports `enabled: false`, every user counts as Premium, no promos show, and no upgrade UI appears.
- **No invented prices.** Amounts live in Stripe; the app reads them from Stripe `Price` objects by ID. No number is hard-coded in the app.
- **Be honest about enforcement.** Offline downloads are enforced by the API (a download request from a Free user is refused), but a determined user could still cache audio by hand. Real copy protection (DRM) is out of scope. The plan and docs say so.
- API changes are additive only (`docs/MOBILE_API.md`, api_version 1). Sticker chrome design; lime is never text on light.
- Legal pages (terms, privacy, refunds) are drafts for a lawyer to review. The app must not claim they are final.

## Decisions to confirm (rulings I made)

- **Ads:** there is no ad system. "No ads" is delivered as **house promos**: admin-written cards (title, text, image, link) shown to Free users on Home and Browse, never to Premium. No audio ads and no third-party ad network. Cost if wrong: a real ad network is a separate project.
- **Grace period:** `past_due` keeps Premium until 3 days after the current period ends (Stripe retries the payment meanwhile). `canceled`, `unpaid` and `incomplete_expired` end Premium at once. A subscription set to cancel at period end stays Premium until that date.
- **Complimentary Premium:** admins can grant Premium without Stripe (for beta testers, artists, press) until a date. Cost if wrong: none; it is a separate column.
- **Account deletion** cancels the user's Stripe subscription before deleting data. Required for app-store and payments hygiene.

## Review Focus

- **Webhook:** a bad or missing signature returns 400 and changes nothing; the same event ID delivered twice changes nothing the second time; an older event arriving after a newer one does not overwrite newer state; an unknown event type returns 200 and is ignored; the metadata `user_id` must match a real user and the customer ID must match the one already stored for them.
- **Entitlement edges:** period end exactly now, grace boundaries, comp grants expiring, a user with two subscriptions (latest wins), a deleted user's subscription rows.
- **Checkout:** a user who already has an active subscription is sent to the portal, not charged twice; the success URL cannot be used to claim Premium.
- **Free-user enforcement:** the download endpoint returns 402 with a machine-readable code for Free users and works for Premium and comp users; streaming itself is never blocked.
- **Money safety:** nothing logs the Stripe secret, webhook secret, or full webhook payloads; the webhook route is exempt from auth but not from signature checks, and from body-size abuse (cap the body).
- **Billing disabled:** every gate and every UI element behaves as unlocked.

---

### Task 1: Billing core: data, entitlements and the Stripe gateway (backend)

**Files:** `backend/requirements.txt` (pin `stripe`), `backend/app/config.py`, `backend/app/db.py`, `backend/app/entitlements.py`, `backend/app/billing.py` (gateway interface and Stripe implementation), `backend/tests/fakes.py` (fake gateway), `backend/tests/test_entitlements.py`.

**Interfaces:**
- Settings (env): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`, `PUBLIC_URL` (already exists; used for return URLs), `BILLING_GRACE_DAYS` (default 3). `settings.billing_enabled` is true only when the secret key, webhook secret and at least one price ID are set.
- Tables: `subscriptions(user_id PK → users ON DELETE CASCADE, stripe_customer_id, stripe_subscription_id, status, price_id, interval, current_period_end TEXT, cancel_at_period_end INT, last_event_created INT, updated_at)`; `webhook_events(id PK, type, received_at)`; `users` gains `comp_until TEXT` (nullable; migrated through `ADDED_COLUMNS`).
- `entitlements.is_premium(conn, settings, user_id, now=None) -> bool`: true when billing is disabled, when `comp_until` is in the future, or when the subscription is `active` or `trialing`, or `past_due` within the grace window, or any status with `cancel_at_period_end` and `current_period_end` still in the future while the status is `active`.
- `entitlements.plan(conn, settings, user_id) -> {premium: bool, source: "billing_off" | "comp" | "subscription" | "free", status, current_period_end, cancel_at_period_end}`.
- `BillingGateway` (in `billing.py`): `create_checkout(customer_id|None, user, price_id) -> url`, `create_portal(customer_id) -> url`, `cancel_subscription(subscription_id)`, `parse_webhook(payload: bytes, signature: str) -> Event` (raises `InvalidSignature`), `list_prices() -> [{id, interval, amount, currency}]`. `StripeGateway` implements it; tests use `FakeGateway`.

- [ ] Failing tests for `is_premium` and `plan` across every status and boundary in Review Focus (frozen `now`); migration adds `comp_until` to an existing database.
- [ ] Implement; suite passes; commit `feat(billing): subscriptions table, entitlements and Stripe gateway`.

### Task 2: Billing API: checkout, portal, webhook, admin grants (backend)

**Files:** `backend/app/routes/billing.py`, `backend/app/main.py`, `backend/app/routes/auth.py` (account deletion cancels the subscription; `/api/auth/me` and login responses gain `premium`), `backend/app/manage.py` (`grant-premium`), `backend/tests/test_billing.py`.

**Interfaces:**
- `GET /api/billing` → `{enabled, plan: {premium, source, status, current_period_end, cancel_at_period_end}, prices: [{id, interval, amount, currency}]}`. Prices come from the gateway and are cached for 10 minutes.
- `POST /api/billing/checkout {interval: "month"|"year"}` → `{url}`. 400 when billing is disabled or the price is not configured; 409 with `{portal: true}` when the user already has a live subscription.
- `POST /api/billing/portal` → `{url}`; 404 when the user has no Stripe customer.
- `POST /api/billing/webhook` (no auth): verifies the signature, caps the body at 256 KB, applies the event idempotently and in order (see Review Focus). Handles `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.payment_failed`. Returns 200 for unknown types.
- `PUT /api/users/{id}/premium {until: ISO date | null}` (admin only; null clears) and `python -m app.manage grant-premium USERNAME --days N`.
- `DELETE /api/auth/me` cancels the Stripe subscription first; if Stripe fails the account is still deleted and the failure is logged without secrets, with a note for the operator.
- `premium: bool` is added to `/api/auth/me` and the login/refresh user object (additive).

- [ ] Failing tests with `FakeGateway`: checkout and portal paths; webhook signature, replay, ordering, unknown type, oversized body, wrong user; entitlement changes after each webhook; admin grant; account deletion cancels; billing disabled behaviour.
- [ ] Implement; suite passes; regenerate `docs/openapi.json`; document in `docs/MOBILE_API.md`; commit `feat(billing): checkout, portal, webhook and admin grants`.

### Task 3: Free-tier limits: offline gate and house promos (backend)

**Files:** `backend/app/routes/library.py` (download gate), `backend/app/db.py` (`promos`), `backend/app/routes/promos.py`, `backend/tests/test_premium_gates.py`.

**Interfaces:**
- Offline: the stream endpoint accepts `dl=1` (what the app sends when saving a track for offline). A Free user gets `402 {"code": "premium_required", "detail": "Offline listening is a Premium feature"}`; Premium, comp and billing-off users get the file. Normal streaming is untouched.
- Table `promos(id, title, body, image, link, active, starts_at, ends_at, created_at)`; image stored like avatars (magic-byte check, 2 MB).
- `GET /api/promos` → up to 3 active promos for Free users; `[]` for Premium and when billing is off. Admin: `POST/PATCH/DELETE /api/promos`, `POST /api/promos/{id}/image`. Link must be `https://` or a same-site `#/` route; anything else is rejected.

- [ ] Failing tests for both gates and for promo scheduling, validation (links, images, sizes) and visibility; implement; commit `feat(billing): offline gate and house promos`.

### Task 4: Premium screens (frontend)

**Files:** `frontend/src/lib/billing.js` (+ tests), `views/Premium.jsx`, `components/PromoCard.jsx`, `components/UpgradeDialog.jsx`, `views/Settings.jsx` (billing card), `views/Home.jsx` and `views/Browse.jsx` (promo slot), `components/TrackMenu.jsx` and the offline buttons (lock + upgrade prompt), `lib/offline.js` (send `dl=1`, handle 402), `views/Promos.jsx` (admin), `App.jsx`, `Shell.jsx`.

**Interfaces:**
- `formatPrice(amount, currency, locale)` and `perMonth(price)` pure helpers, tested; `lib/billing.js` wraps the API.
- `#/premium`: plan comparison (Free vs Premium, only the two real differences plus a note that lossless is free for everyone), prices read from the API, monthly/yearly switch, "Go Premium" starts checkout and redirects. If billing is disabled the route shows "Everything is unlocked".
- Return from Stripe (`#/premium?checkout=success`): shows "Checking your payment" and polls `/api/billing` until Premium appears or 20 seconds pass (then "It can take a minute; we'll unlock it as soon as Stripe confirms"). It never unlocks from the URL alone.
- Settings billing card: status, renewal or end date, "Manage billing" (portal), "Upgrade".
- Locked offline controls show a lock and open the upgrade dialog instead of failing.
- Admin: promo manager page (create, schedule, image, pause) and a Premium toggle (comp until) on the user list.

- [ ] Failing Vitest tests for the helpers; implement screens; verify headless at 1440 and 390 for Free, Premium and billing-off; commit `feat(billing): premium screens`.

### Task 5: Operations, docs and legal drafts

**Files:** `docs/BILLING.md`, `deploy/.env.example`, `docs/DEPLOY.md`, `docs/AWS_ARCHITECTURE_BRIEF.md`, `frontend/src/views/Legal.jsx` (draft Terms, Privacy and Refund pages, clearly labelled drafts).

- [ ] `docs/BILLING.md`: Stripe account setup in test mode (create the product and two prices, copy the price IDs), the webhook endpoint and the events to enable, the Stripe CLI command for local testing, test card numbers, going live checklist (live keys, tax settings, business details, statement descriptor), and the cancellation and refund policy the owner must decide.
- [ ] Env template and deploy docs list the new variables; the AWS brief notes that the webhook route must be publicly reachable, secrets belong in Secrets Manager, and webhook retries need idempotent handling (already built).
- [ ] Legal drafts exist and say "Draft: not legal advice, have a lawyer review before launch".

### Task 6: Verify and ship

- [ ] Backend suite, Vitest, lint, build, sloplint, Docker image build; a Stripe **test-mode** run end to end if the owner supplies test keys (otherwise the fake gateway covers it and I say so); push `yaapu-phase-6`.

---

## What I need from you before launch (not before building)

1. A Stripe account (test keys are enough to build and verify; live keys only at launch).
2. The two prices you want to charge (monthly and yearly) and the currency. I will not pick amounts.
3. Your refund and cancellation policy, and who is the legal seller (business name and country). Stripe requires this and it drives tax settings.
4. Someone to review the Terms and Privacy drafts.
