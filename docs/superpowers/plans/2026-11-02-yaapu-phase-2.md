# Yaapu Phase 2: social core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Listening becomes social: profiles, following people and artists, live friend activity, story share cards, and public and collaborative playlists.

**Architecture:** New backend router `app/routes/social.py` (people, follows, presence, activity) and playlist access rules extended in `app/routes/me.py`; schema additions via the existing `ADDED_COLUMNS` and `CREATE TABLE IF NOT EXISTS` migration. Frontend adds a `lib/social.js` client, a profile view, a friends rail, and a canvas share-card renderer. Live activity is polled (20 s); a realtime service arrives in Phase 5.

**Tech Stack:** FastAPI + SQLite (unchanged), pytest; React 19 + Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-yaapu-design.md` (Phase 2). Builds on branch `yaapu-phase-1`.

## Global Constraints

- Kingfisher (`social` colour) marks everything social and live; marigold stays for play and primary actions.
- API is additive only (`docs/MOBILE_API.md`, api_version 1); existing playlist endpoints and the Subsonic API keep working for owners.
- Privacy: listening activity is shared with followers by default and can be switched off in Settings; a private profile hides activity, top artists and public playlists from people who are not mutual friends.
- No invented numbers: follower counts and top artists come from real rows only.
- PostgreSQL/S3 move is a separate plan before public launch (spec: "before this ships publicly"); this plan stays on SQLite.

## Review Focus

- Following yourself, following twice, unfollowing someone you don't follow: no error, no duplicate rows.
- A deleted user who was followed or was a playlist collaborator: their rows go (ON DELETE CASCADE), feeds don't break.
- Private profile viewed by a one-way follower: no activity or top artists leak.
- A collaborator removed from a playlist can no longer edit it, and a non-member gets 404 on a private playlist (not 403, which would reveal it exists).
- Very long titles and Tamil titles on the share card wrap within the card.

---

### Task 1: Profiles and follows (backend)

**Files:** Modify `backend/app/db.py`; create `backend/app/routes/social.py`; modify `backend/app/main.py`; create `backend/tests/test_social.py`.

**Interfaces:**
- Schema: users + `display_name TEXT NOT NULL DEFAULT ''`, `bio TEXT NOT NULL DEFAULT ''`, `avatar TEXT` (file name), `is_private INTEGER NOT NULL DEFAULT 0`, `share_activity INTEGER NOT NULL DEFAULT 1`. Tables `follows(follower_id, followee_id, created_at, PK(follower_id, followee_id))`, `artist_follows(user_id, artist_id, created_at, PK)`, both `ON DELETE CASCADE` to users.
- `GET /api/people?q=` → `{people: [PersonCard]}` (username/display name prefix match, max 20, excludes self). `PersonCard = {username, display_name, avatar_url, is_following, follows_you}`.
- `GET /api/people/{username}` → `Profile = PersonCard + {bio, followers, following, top_artists: [{id, name, plays}] | null, playlists: [PlaylistSummary] | null, is_private, is_self}`; `null` when hidden by privacy. 404 for unknown.
- `PUT|DELETE /api/people/{username}/follow` → 204; self → 400.
- `GET /api/people/{username}/followers`, `/following` → `{people: [PersonCard]}`.
- `PATCH /api/me/profile {display_name ≤40, bio ≤160, is_private, share_activity}` → Profile of self.
- `POST /api/me/avatar` (multipart `file`, ≤ 2 MB, PNG/JPEG/WebP by magic bytes) → `{avatar_url}`; `DELETE /api/me/avatar`; `GET /api/avatars/{name}` serves it (no auth; long cache; name is random).
- `PUT|DELETE /api/artists/{artist_id}/follow` → 204 (404 unknown artist); `GET /api/me/artists` → `{artists: [{id, name}]}`; `/api/artists` items gain `following: bool`.
- Top artists: by plays in the last 30 days, top 6.

- [ ] Write failing tests: follow/unfollow idempotent, self-follow 400, counts, mutual `follows_you`, search, private profile hides `top_artists` and `playlists` from a one-way follower but not from a mutual friend, profile patch validation, avatar rejects a non-image and accepts a PNG, artist follow 404 for unknown id, cascade on user delete.
- [ ] Run `pytest tests/test_social.py` → FAIL.
- [ ] Implement schema and router.
- [ ] Run full backend suite → PASS. Commit `feat(social): profiles and follows`.

### Task 2: Presence and friend activity (backend)

**Files:** Modify `backend/app/db.py`, `backend/app/routes/social.py`; tests in `backend/tests/test_social.py`.

**Interfaces:**
- Table `presence(user_id PK → users ON DELETE CASCADE, track_id TEXT, updated_at TEXT)`.
- `POST /api/presence {track_id: str | null}` → 204 (unknown track → 404). The player sends it on track change and every 60 s while playing; `null` on pause.
- `GET /api/activity` → `{friends: [{person: PersonCard, track: Track | null, live: bool, at: str}]}` for people I follow who share activity and are not private-without-mutual: `live` when presence has a track updated < 120 s ago; else the latest play (if any) with its time. Sorted live first, then most recent.

- [ ] Failing tests: live vs last-played, share_activity off hides the person, private non-mutual hidden, unfollowed people absent, unknown track 404.
- [ ] Implement; full suite PASS; commit `feat(social): presence and friend activity`.

### Task 3: Public and collaborative playlists (backend)

**Files:** Modify `backend/app/db.py`, `backend/app/routes/me.py`; tests `backend/tests/test_social.py`.

**Interfaces:**
- playlists + `visibility TEXT NOT NULL DEFAULT 'private'` (`private|public`), `collaborative INTEGER NOT NULL DEFAULT 0`; table `playlist_members(playlist_id → playlists CASCADE, user_id → users CASCADE, added_at, PK)`.
- Access: owner = full; member of a collaborative playlist = read + edit tracks (PATCH `track_ids`, POST tracks); anyone signed in = read a public playlist; otherwise 404.
- `PlaylistSummary` gains `visibility`, `collaborative`, `owner: {username, display_name}`, `role: owner|member|viewer`.
- `GET /api/playlists` returns owned + member playlists.
- `PATCH /api/playlists/{id}` accepts `visibility`, `collaborative` (owner only; others 403 for these fields).
- `POST /api/playlists/{id}/members {username}` (owner; must be someone the owner follows or who follows the owner) and `DELETE /api/playlists/{id}/members/{username}`; `GET .../members`.
- Profile `playlists` = that user's public playlists.

- [ ] Failing tests: member can reorder and append; member can't rename or delete; removed member gets 404 on a private playlist; public playlist readable read-only by a stranger; existing owner tests still pass.
- [ ] Implement; full suite PASS; regenerate `docs/openapi.json`; commit `feat(social): public and collaborative playlists`.

### Task 4: Social client, profile view and people search (frontend)

**Files:** Create `frontend/src/lib/social.js`, `frontend/src/views/Profile.jsx`, `frontend/src/components/Avatar.jsx`, `frontend/src/components/FollowButton.jsx`; modify `App.jsx` (route `u/:username`), `views/Search.jsx` (People section), `views/Settings.jsx` (Profile card: display name, bio, avatar, private profile, share activity), `components/Shell.jsx` (account menu "Your profile").

**Interfaces:**
- `social.profile(username)`, `social.follow(username, on: bool)`, `social.search(q)`, `social.updateProfile(patch)`, `social.uploadAvatar(file)`, `social.followArtist(id, on)`.
- `<Avatar person size />`: image or initial on dusk with a kingfisher ring.
- `<FollowButton username following onChange />`: `btn-social` "Follow" / "Following", optimistic with rollback.

- [ ] Build; profile view shows avatar, names, bio, follower counts, top artists (as chips linking to artists), public playlists; private placeholder text when hidden.
- [ ] Verify lint, tests, build; commit `feat(social): profiles, people search, follow`.

### Task 5: Friends rail and presence heartbeat (frontend)

**Files:** Create `frontend/src/components/FriendsRail.jsx`, `frontend/src/views/Friends.jsx`; modify `App.jsx` (rail on desktop ≥ 1280 px right of main; route `friends`), `components/Shell.jsx` (mobile nav gets Friends in place of Playlists... keep Playlists, replace Albums), `lib/player.js` or `App.jsx` (heartbeat), artist page follow button (`views/Albums.jsx` ArtistView).

**Interfaces:** `social.activity()` polled every 20 s while the tab is visible; heartbeat `social.presence(trackId|null)`.

- [ ] Rail: each friend with avatar, name, track title and artist; a kingfisher pulse dot for live (reduced motion: static); tap a track to play it; empty state "Follow friends to see what they're playing" with a people-search link.
- [ ] Verify; commit `feat(social): friends rail and activity`.

### Task 6: Share cards (frontend)

**Files:** Create `frontend/src/lib/sharecard.js`, `frontend/src/lib/sharecard.test.js`, `frontend/src/components/ShareDialog.jsx`; modify `components/TrackMenu.jsx` ("Share"), `views/NowPlaying.jsx` (Share button).

**Interfaces:**
- `wrapLines(measure: (s) => number, text, maxWidth, maxLines): string[]` (pure; ellipsis on the last line).
- `renderShareCard(track, coverImg, ambient) → Promise<Blob>`: 1080×1920 PNG: ambient-to-night gradient, cover 800 px, title in Bricolage 800, artist, the Yaapu mark and wordmark.
- Dialog: preview, "Share" (Web Share API with the file when supported), "Download image", "Copy link" (`<origin>/#/album/<album_id>`).

- [ ] Failing Vitest tests for `wrapLines`: short text one line; long text wraps; exceeds maxLines → ellipsis; a single over-long word is cut with ellipsis.
- [ ] Implement; tests PASS; commit `feat(social): story share cards`.

### Task 7: Collaborative playlists UI and verification

**Files:** Modify `views/Playlists.jsx` (visibility and collaborative toggles for owner, members dialog, role-aware actions), `components/Shell.jsx` (badge for shared playlists).

- [ ] Owner: "Make public" / "Make private", "Collaborative" toggle, "Collaborators…" (add from people you follow / who follow you, remove). Member: can reorder and add; no rename/delete. Viewer: read-only with Play and Save copy is out of scope (not built).
- [ ] Verify end to end with two local accounts in headless Chromium at 1440 and 390 px; backend suite, Vitest, lint, build, Docker image; push branch `yaapu-phase-2`.
