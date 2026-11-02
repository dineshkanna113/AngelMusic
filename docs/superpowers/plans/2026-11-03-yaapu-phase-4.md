# Yaapu Phase 4: artist growth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give artists tools to grow an audience: announce releases as **drops** with a countdown and **pre-saves**, share one **smart link** per release, and see real **stats** and a **top-fans** leaderboard.

**Architecture:** An `artist_owners` table links user accounts to the artists (derived from file tags) they manage; admins grant access. New router `app/routes/growth.py` holds stats, drops, pre-saves and the public smart-link page. Publishing an upload that a drop is linked to marks the drop released and adds the track to every pre-saver's favorites. The web app gets a Studio view for artists and drop pages for fans.

**Tech Stack:** FastAPI + SQLite, pytest; React 19, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-yaapu-design.md` (Phase 4). Builds on branch `yaapu-phase-3`.

## Global Constraints

- No invented numbers: every statistic is counted from real rows; a metric with no data is hidden or labelled empty.
- Location: plays store a country and city **only** when a trusted CDN header supplies them (`CloudFront-Viewer-Country`, `CloudFront-Viewer-City`) and `TRUST_GEO_HEADERS=true`. The IP address is never stored. Without the headers, location charts show an empty state.
- Privacy: named fans appear on leaderboards only if they share activity (`share_activity`) and have a public profile; everyone else counts in totals anonymously.
- The smart-link page is public by design and shows only what the artist entered (title, description, release time, artwork) plus the artist's name.
- API additive only (`docs/MOBILE_API.md`, api_version 1). Sticker chrome design; lime is never text on light.

## Review Focus

- A user who does not manage an artist: stats, drop edits and artwork uploads return 403; a missing artist returns 404 (not 403).
- A drop whose release time has passed but is not linked to a published upload: shows "Dropping soon", never a fake "Out now".
- Pre-saving twice, or un-pre-saving after release: no duplicate favorites, no error.
- A pre-saver who already favorited the track, or whose account was deleted before release: no failure in the publish step.
- Smart-link page for an unknown slug: 404 page without leaking whether a draft exists; HTML-escape every field (title, description) in the page and its meta tags.
- Artwork: only PNG/JPEG/WebP by magic bytes, 2 MB limit, random file name.

---

### Task 1: Artist access, stats and top fans (backend)

**Files:** `backend/app/db.py`, `backend/app/config.py`, `backend/app/routes/me.py` (geo on plays), `backend/app/routes/discover.py` (artist page `can_manage`, `top_fans`, owners may edit bio), `backend/app/routes/growth.py` (new), `backend/app/main.py`, `backend/tests/test_growth.py`.

**Interfaces:**
- Tables: `artist_owners(artist_id, user_id, PK both, CASCADE on user)`; `plays` gains `country TEXT`, `city TEXT` (nullable). Setting `trust_geo_headers: bool` (env `TRUST_GEO_HEADERS`, default false).
- `PUT/DELETE /api/artists/{id}/owners/{username}` admin only; 404 unknown artist/user; idempotent.
- `GET /api/artists/{id}` adds `can_manage: bool` and `top_fans: [{person, plays}]` (≤5, opt-in fans only).
- `PUT /api/artists/{id}/bio` allowed for admins and owners.
- `GET /api/studio` → `{artists: [{id, name}]}` the user manages.
- `GET /api/artists/{id}/stats?days=30` (owners and admins) → `{days, plays, listeners, followers, series: [{date, plays}] (one entry per day, zero-filled), top_tracks: [{...Track, plays}], top_fans: [{person | null, plays}] (≤10; non-opt-in fans appear as `person: null`), countries: [{name, plays}], cities: [{name, plays}]}`.
- `POST /api/history` records `country`/`city` from the headers when trusted.

- [ ] Failing tests: owner grant/revoke (admin only, idempotent, unknown 404); stats for owner vs stranger (403) vs unknown (404); counts of plays, distinct listeners and zero-filled series over a window; top fans respect opt-out and show `person: null`; countries/cities empty without trusted headers and filled with them; headers ignored when untrusted; owner can set bio, stranger cannot; `can_manage` flag.
- [ ] Implement; full suite passes; commit `feat(growth): artist access, stats and top fans`.

### Task 2: Drops, pre-saves and smart links (backend)

**Files:** `backend/app/db.py`, `backend/app/routes/growth.py`, `backend/app/ingest.py` (release hook), `backend/tests/test_growth.py`.

**Interfaces:**
- Tables: `drops(id, slug UNIQUE, artist_id, user_id, title, description, release_at, artwork, upload_id, track_id, album_id, released_at, created_at)`; `presaves(drop_id, user_id, created_at, PK both, CASCADE)`.
- `Drop = {id, slug, artist: {id, name}, title, description, release_at, artwork_url | null, status: "upcoming" | "dropping_soon" | "out", presaves: int, presaved: bool, album_id | null, track_id | null, can_manage: bool, share_url: "/s/{slug}"}`. `status`: out when `released_at`; dropping_soon when time passed but not released; else upcoming.
- `POST /api/drops {artist_id, title ≤120, description ≤500, release_at (ISO, must be in the future), upload_id?}` (owner/admin; `upload_id` must be the caller's own unpublished upload) → 201 Drop.
- `GET /api/drops?artist_id=` → `{drops}` upcoming and dropping-soon first (soonest first), then out (newest first, last 30 days).
- `GET /api/drops/{slug}` → Drop. `PATCH /api/drops/{id}` (title, description, release_at, upload_id) and `DELETE` for owner/admin.
- `PUT/DELETE /api/drops/{id}/presave` (any user; not after `out`).
- `POST /api/drops/{id}/artwork` (multipart; owner/admin) and `GET /api/drop-art/{name}` (public).
- `GET /s/{slug}` public HTML: Open Graph and Twitter tags, the drop's title, artist, release time and artwork, a link into the app (`/#/drop/{slug}`); 404 for unknown slug; all fields HTML-escaped.
- Release hook in `ingest.publish`: for drops with this `upload_id`, set `track_id`, `album_id`, `released_at`; `INSERT OR IGNORE` the track into each pre-saver's favorites.

- [ ] Failing tests: create (future only, own upload only, non-owner 403), status transitions, listing order, pre-save idempotent and blocked after release, release hook favorites for pre-savers (including one who already favorited), deleted pre-saver user, artwork validation, smart-link page (escaping, OG tags, unknown 404).
- [ ] Implement; suite passes; regenerate `docs/openapi.json`; document in `docs/MOBILE_API.md`; commit `feat(growth): drops, pre-saves, smart links`.

### Task 3: Studio and drop screens (frontend)

**Files:** create `lib/growth.js`, `views/Studio.jsx`, `views/Drop.jsx`, `components/Countdown.jsx`, `components/DropCard.jsx`, `components/LineChart.jsx` (+ tests for `lib/growth.js` helpers); modify `App.jsx`, `Shell.jsx`, `views/Browse.jsx`, `views/Albums.jsx` (ArtistView), `vite.config.js` (proxy `/s` and `/api/drop-art`).

**Interfaces:**
- `countdownParts(releaseAt, now): {done, days, hours, minutes, seconds}` (UTC SQLite string or ISO; never negative); `Countdown` ticks each second while visible and shows a still total when `prefers-reduced-motion`.
- Routes: `#/studio`, `#/drop/{slug}`; nav gains Studio only for users who manage an artist.

- [ ] Failing Vitest tests for `countdownParts` (days/hours/minutes/seconds split, done when past, accepts both timestamp formats).
- [ ] Drop page: big sticker artwork, chrome title, countdown, Pre-save / Pre-saved, presave count, Copy link, "Out now" with Play when released.
- [ ] Studio: artist picker, stat tiles, plays-per-day chart, top tracks, top fans (named or "listener"), countries and cities (empty state), drops list and create/edit form (artwork upload, link to an unpublished upload).
- [ ] Browse "Upcoming drops" row; artist page shows the next drop and top fans; admins get "Manage access" (grant/revoke by username).
- [ ] Verify headless at 1440 and 390 with two accounts; commit `feat(growth): studio and drop screens`.

### Task 4: Verify and ship

- [ ] Backend suite, Vitest, lint, build, sloplint, Docker image; update MOBILE_API.md and the design spec status; push branch `yaapu-phase-4`.
