# Yaapu Phase 3: discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people find music: a Browse page (genres, moods, languages, new releases, editorial playlists), a Top 50 chart, and richer artist pages (bio, followers, top tracks, discography).

**Architecture:** Mood and language become scanned tag fields (schema v3 rescans the library). Charts, artist info and editorial playlists are small backend additions (`app/routes/discover.py`); genre/mood/language browsing and new releases are derived on the client from the library it already holds. New views follow the Sticker chrome system.

**Tech Stack:** FastAPI + SQLite + mutagen, pytest; React 19, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-yaapu-design.md` (Phase 3). Builds on branch `yaapu-phase-3` (sticker redesign).

## Global Constraints

- No invented numbers: chart plays, follower counts and top tracks come from real rows; empty data hides the section.
- Browse sections for mood and language appear only when the library has tracks with those tags.
- Charts expose aggregate counts only, never who played what.
- API additive only (`docs/MOBILE_API.md`, api_version 1).
- Sticker chrome: tiles are colour stickers (lime, bubblegum, sky, peach) with ink text, tilted ±2-4°; lime is never text on the light ground.

## Review Focus

- A library with no mood/language tags: Browse shows genres only, no empty headings.
- Genres with different casing or several values in one tag ("Rock; Pop"): grouped by the first value, case-insensitive.
- Chart with fewer than 50 plays or none: shows what exists; empty state invites listening, no fake ranks.
- An artist with no bio: no empty block; admins see "Add a bio".
- ISO language codes ("tam", "eng") become readable names ("Tamil", "English"); unknown codes show as written.

---

### Task 1: Mood and language tags (backend)

**Files:** `backend/app/db.py` (SCHEMA_VERSION 3; tracks gain `mood`, `language`), `backend/app/library.py` (read both tags, `normalize_language`), `backend/tests/test_discovery.py`.

**Interfaces:**
- `normalize_language(text: str) -> str`: ISO 639-2/1 code or name → display name ("tam"/"ta"/"Tamil" → "Tamil"; "eng"/"en" → "English"; unknown returned stripped as written; empty → "").
- Tracks API gains `mood: str`, `language: str` (empty string when untagged).
- Tags: Vorbis `mood`, `language`; ID3 `TMOO`, `TLAN`; MP4 `----:com.apple.iTunes:MOOD`, `----:com.apple.iTunes:LANGUAGE`.

- [ ] Failing tests: `normalize_language` table (tam, ta, TAM, Tamil, eng, hin, "tam; eng" → "Tamil", "xx" → "xx", "" → ""); scan of a WAV with ID3 `TLAN=tam`, `TMOO=Energetic` yields `language == "Tamil"`, `mood == "Energetic"`; untagged file yields empty strings.
- [ ] Implement; full backend suite passes; commit `feat(discovery): mood and language tags`.

### Task 2: Charts, artist info, editorial playlists (backend)

**Files:** `backend/app/db.py` (`artist_info`, playlists `featured`), `backend/app/routes/discover.py` (new), `backend/app/routes/me.py` (admin-only `featured` in PATCH), `backend/app/main.py`, `backend/tests/test_discovery.py`.

**Interfaces:**
- `GET /api/charts?days=7&limit=50` → `{days, tracks: [{...Track, rank, plays}]}` ranked by total plays across all users in the window (ties: most recent play); only tracks with at least 1 play.
- `GET /api/artists/{artist_id}` → `{id, name, bio, followers, following, top_tracks: [{...Track, plays}] (≤5, all-time), albums: [Album]}`; 404 unknown.
- `PUT /api/artists/{artist_id}/bio {bio ≤1000}` admin only → artist; empty bio clears it.
- `GET /api/editorial` → `{playlists: [PlaylistSummary]}` featured playlists, newest first.
- `PATCH /api/playlists/{id} {featured: bool}` admin only; featuring forces `visibility = public`.

- [ ] Failing tests: chart ranks by plays across two users and respects the window; chart empty → `[]`; artist payload (followers count, following flag, top tracks); bio set/clear admin-only (403 for users); editorial lists only featured, featuring makes it public, non-admin 403.
- [ ] Implement; suite passes; regenerate `docs/openapi.json`; document in `docs/MOBILE_API.md`; commit `feat(discovery): charts, artist info, editorial`.

### Task 3: Browse and chart screens (frontend)

**Files:** create `frontend/src/lib/browse.js` + `browse.test.js`, `views/Browse.jsx`, `views/BrowseGroup.jsx`, `views/Chart.jsx`; modify `App.jsx`, `components/Shell.jsx`, `lib/format.js` if needed.

**Interfaces:**
- `groupBy(tracks, field): [{key, label, count, cover}]` sorted by count desc then label; groups by the first value of `;`/`,`/`/`-separated tags, case-insensitive (label keeps the most common spelling); skips empty.
- `newReleases(albums, n = 10)`: albums by `added_at` desc.
- Routes: `#/browse`, `#/browse/{genre|mood|language}/{key}`, `#/chart`; nav gains Browse (sidebar and phone bar in place of Songs).

- [ ] Failing Vitest tests for `groupBy` (case-folding, multi-value tags, empty skipped, ordering, label spelling) and `newReleases`.
- [ ] Build Browse: Top 50 banner (sticker), New releases, Genres/Moods/Languages as tilted colour tiles with counts and a cover, Editorial playlists; empty sections omitted.
- [ ] BrowseGroup: header, Play and Shuffle, TrackList. Chart: ranked rows (large rank numerals, play counts), Play all, empty state.
- [ ] Verify headless 1440 and 390; commit `feat(discovery): browse and chart screens`.

### Task 4: Artist pages and editorial controls (frontend)

**Files:** modify `views/Albums.jsx` (ArtistView), `views/Playlists.jsx`, `lib/social.js`; create `components/ArtistHeader.jsx` if needed.

- [ ] ArtistView: big sticker portrait (cover), name in chrome, follower count, Follow, bio (admins get "Edit bio"), Top tracks (from the API), Discography (albums grid), and the existing play actions.
- [ ] Admin: playlist menu "Feature on Browse" / "Remove from Browse".
- [ ] Verify with the two dev accounts; full suites, lint, build, sloplint, Docker image; push; commit `feat(discovery): artist pages and editorial`.
