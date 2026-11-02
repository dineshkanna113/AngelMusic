# Yaapu Phase 5: Live (Rewind, Blend, Rooms) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three social features: **Rewind** (a shareable recap of your listening), **Blend** (a playlist made from two friends' tastes) and **Rooms** (listen together in sync, with chat and reactions).

**Architecture:** Rewind and Blend are plain REST endpoints computed from the `plays` and `favorites` tables. Rooms add the app's first realtime channel: a WebSocket endpoint with an in-memory hub. Room state (current track, position, playing) is also stored in the database so late joiners sync instantly. The hub is per process; scaling past one server needs a shared pub/sub (Redis), which is already named in `docs/AWS_ARCHITECTURE_BRIEF.md`.

**Tech Stack:** FastAPI (REST + WebSocket), SQLite, pytest (TestClient websockets); React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-yaapu-design.md` (Phase 5). Builds on branch `yaapu-phase-4`.

## Global Constraints

- Real numbers only: every Rewind and Blend figure is counted from rows; a match percentage is computed, never invented. With no data, show an honest empty state.
- Privacy: Blend needs a mutual follow (friends) and the other person's `share_activity`; Rewind is private to its owner (shareable only through an image the owner makes).
- Rooms: join by a 6-character code. Chat is **not stored** (ephemeral, in memory); reactions are not stored. Only the host controls playback. Max 50 listeners per room. Messages max 280 characters, 1 per second per user.
- WebSocket auth: the client sends an `auth` message with its access token as the first frame. The token never goes in the URL.
- API additive only (`docs/MOBILE_API.md`, api_version 1). Sticker chrome design; lime is never text on light.

## Review Focus

- Blend with a stranger, a non-mutual follow, a person who hides activity, or yourself: 403/404/400 with no leak of listening data.
- Rewind period boundaries (month edges, UTC), and a user with zero plays.
- Room WebSocket: no frames processed before `auth`; bad or expired token closes the socket; a non-host `play` frame is ignored; oversized or rapid chat is rejected; a closed room cannot be joined; a disconnected host does not end the room.
- Listener sync: position math uses the server's timestamp, never negative, and does not seek on every message (drift tolerance).

---

### Task 1: Rewind and Blend (backend)

**Files:** `backend/app/routes/live.py` (new), `backend/app/main.py`, `backend/tests/test_live.py`.

**Interfaces:**
- `GET /api/rewind?period=month|year|YYYY-MM|YYYY` (default `month` = the current calendar month, UTC) → `{period, label, start, end, plays, minutes, active_days, top_tracks: [{...Track, plays}] (≤5), top_artists: [{id, name, plays}] (≤5), top_genre: str|null, busiest_day: {date, plays}|null}`. `minutes` sums the durations of played tracks (rounded). Removed tracks are skipped.
- `POST /api/blends {username}` → 201 playlist detail (private, owner = caller, name `"{You} + {Them}"`, comment states the match). Needs a mutual follow and the other person's `share_activity`; 400 for yourself; 404 unknown; 403 otherwise. Tracks: each person's top tracks (plays in the last 90 days, then favorites), interleaved, de-duplicated, up to 30; shared tracks first. Response also carries `blend: {match, shared_artists}` where `match` is the share of artists both listen to (Jaccard, whole percent; 0 when either has no data).

- [ ] Failing tests for both; implement; suite passes; commit `feat(live): rewind and blend`.

### Task 2: Rooms (backend)

**Files:** `backend/app/db.py` (rooms), `backend/app/routes/rooms.py`, `backend/app/hub.py`, `backend/app/main.py`, `backend/tests/test_rooms.py`.

**Interfaces:**
- Table `rooms(code PK, host_id, name, track_id, position REAL, playing INT, state_at TEXT, created_at, ended_at)`.
- `POST /api/rooms {name?}` → 201 `{code, name, host, ...}` (host only one open room at a time: the previous one ends). `GET /api/rooms/{code}` → room snapshot (404 unknown or ended). `DELETE /api/rooms/{code}` host ends it; connected sockets get `ended` and close.
- `WS /api/rooms/{code}/ws`. Frames (JSON): client→server `auth {token}` first; then `play {track_id, position, playing}` (host only), `chat {text}`, `react {emoji}` (one of a fixed set). Server→client: `state {room, members}`, `sync {track_id, position, playing, server_time}`, `chat {from, text, at}`, `react {from, emoji}`, `members {members}`, `ended`, `error {message}`.
- Late joiners receive the stored state with position advanced by elapsed time when playing.

- [ ] Failing tests with TestClient websockets (auth first, host-only play, sync to listener, chat limits, reactions allow-list, end room, late join, max listeners, unknown/ended room); implement; commit `feat(live): rooms`.

### Task 3: Rewind and Blend (frontend)

**Files:** `frontend/src/views/Rewind.jsx`, `frontend/src/lib/live.js` (+ tests), `components/` as needed, `views/Profile.jsx` (Blend button), `views/Home.jsx` (Rewind card), `App.jsx`, `lib/sharecard.js` (rewind card).

- [ ] Rewind page: period switcher, big sticker stats, top tracks and artists, busiest day; share image through the existing share-card canvas. Empty state when no plays.
- [ ] "Blend with {name}" on friends' profiles; opens the new playlist and shows the match.
- [ ] Verify headless at 1440 and 390; commit `feat(live): rewind and blend screens`.

### Task 4: Rooms (frontend)

**Files:** `frontend/src/lib/rooms.js` (+ tests for position math), `views/Room.jsx`, `components/RoomBar.jsx`, `views/Friends.jsx` (start/join), `App.jsx`.

- [ ] `positionAt(sync, serverNow)` pure helper and drift rule (seek only when off by more than 1.5 s) with tests.
- [ ] Room view: code to share, listeners, now playing, chat, reaction buttons with floating stickers, host controls (host's player drives the room), listeners follow the host and can leave.
- [ ] Join by code; reconnect with backoff; verify headless with two sessions; commit `feat(live): room screens`.

### Task 5: Verify and ship

- [ ] Backend suite, Vitest, lint, build, sloplint; regenerate `docs/openapi.json`; document REST and the WebSocket protocol in `docs/MOBILE_API.md`; update the AWS brief's WebSocket note; push `yaapu-phase-5`.
