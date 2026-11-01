# Yaapu: design

Status: approved by the owner on 2026-11-02 (whole plan, "proceed"). Phase 1 is the first build.

## Intent

AngelMusic becomes **Yaapu**, a public music streaming service for Gen Z where listening is social.
It carries both licensed catalogue (labels and distributors) and independent artists who upload
their own music, side by side, like Spotify. It must feel grand and premium, and must not look like
a Spotify clone.

Voice: confident, warm, a little cheeky, plain words. The product speaks to a global audience.

## Goals

- Feature parity with Spotify and Apple Music for listening, library and discovery.
- A social layer that is the reason to choose Yaapu: friends' live activity, listening together,
  sharing, blends.
- Tools for artists to grow an audience inside the app (drops, pre-saves, smart links, stats).
- Licensed and independent catalogue through one ingestion and review pipeline.
- Premium lossless playback kept as a paid-tier strength, not the whole identity.

## Non-goals (first version)

Podcasts and audiobooks, music video, remote playback control across devices (Connect-style),
karaoke vocal removal, Chromecast/AirPlay casting.

## Anti-goals

- Looking like Spotify (green on black, its sidebar layout) or like generic AI-generated UI.
- Invented numbers anywhere: stats, charts and counts come from real data or are absent.
- Engagement dark patterns: infinite autoplay of things the listener did not choose, fake urgency,
  streaks that punish.

## Constraints

- Builds on the existing monorepo (`backend/` FastAPI + SQLite, `frontend/` React 19 + Vite +
  Tailwind 3, `deploy/` Compose + Caddy, `docs/`). Routes, handlers and API contracts stay
  compatible; `docs/MOBILE_API.md` contract is additive-only (api_version 1).
- Licensing deals are the owner's job. The product builds the technical side (DDEX ingestion,
  territory rules, accurate play counting for royalty reports) so deals can land.
- Gen Z means mobile first: every screen is designed at 390px first, then desktop.
- Accessibility floor: keyboard focus visible, reduced motion respected, contrast AA.

## Identity and design system (decided)

**Revised 2026-11-02:** the owner chose "Sticker chrome" from three mockups (Marquee, Kolam,
Sticker chrome) and asked that it read as global: no Tamil lettering, no culture-specific
stickers. It replaces the earlier "temple night" direction.

Direction "Sticker chrome": a Gen Z scrapbook. Light, glossy, playful, social-first.

| Token | Hex | Role |
|---|---|---|
| pearl | `#F7F2FF` | ground (top of the pearl-lilac-mint gradient) |
| lilac | `#E9E3FF` | ground (middle) |
| mint | `#D6F7EE` | ground (bottom) |
| ink | `#19161F` | text, the player pill, primary buttons |
| lime | `#C6FF3D` | play and primary actions (on ink, or as a sticker with ink text) |
| bubblegum | `#FF6FD8` | friends and anything live (sticker fill with ink text) |
| gum-ink | `#B0127A` | bubblegum as text on light grounds |
| muted | `#5A5466` | secondary text |
| white | `#FFFFFF` | cards and the borders around stickers |

Contrast: ink on pearl 16.2, muted on pearl 6.6, lime on ink 15.1, ink on bubblegum 7.2,
gum-ink on pearl 5.9. White on bubblegum (2.5) is not allowed.

- Type: **Syne** 800 for display (chrome gradient on the largest heads), **Hanken Grotesk** for
  text, Noto Sans Tamil only as a font fallback so non-Latin titles render (never decoration).
- Icons: **Phosphor** (fill weight in navigation, regular elsewhere).
- Shapes: cards with large radii and a white border; featured covers and stickers sit at a
  slight tilt (±2-8°); lists stay straight so they scan.
- Stickers: pill labels with a 3 px white border ("on repeat", "live", "hi-res"), and drawn
  music artifacts (vinyl, cassette, headphones, boombox, drum, sparkle) in the palette. They
  decorate Home, empty states, login and the share card; never over player controls.
  An abstract dot-and-loop line pattern is the background texture.
- Signature: the floating ink player pill with a spinning record cover (spins only while
  playing; still with reduced motion). Friends appear as story rings on phone Home.
- Now Playing keeps the cover-colour bloom, as a soft tint of the pearl ground.
- No all-caps labels, no dot-joined meta strings, no arrows glued to link text.
- Watermelon UI is searched before building a component from scratch; its source is adapted to
  these tokens and to accessible native controls, never installed as-is.

## Features

Already built: lossless playback, playlists, favorites, history, personal mixes, radio, synced
lyrics, offline saving, queue, sleep timer, artist uploads with review and scheduled releases,
roles, mobile-ready auth and API, AWS deployment.

To reach parity: browse by genre, mood and language; charts (Top 50 Yaapu); new releases;
editorial playlists; artist pages with bio, top tracks, discography and follow; collaborative
playlists with covers and descriptions; new-release notifications; gapless and crossfade; a
monthly shareable "Rewind" recap.

Social: profiles with top artists; follow friends and artists; live friend activity; Rooms
(synced listening with reactions and chat); Blend (a playlist from two friends' tastes); share
cards (story images for Instagram and WhatsApp).

Artist growth: Drops (release countdowns with pre-saves), smart links (one share page per
release), top-fans leaderboard, artist stats (plays, listeners, cities).

Business: Free and Premium tiers (Premium: lossless, offline, no ads), payments, DDEX
deliveries from labels and distributors through the review pipeline, play counting for
royalty reports.

## Phases

1. **Rebrand and new design**: Yaapu name and identity everywhere, new design system, the stage
   player, colour from cover art. Web app first.
2. **Social core**: profiles, follow, friend activity, share cards, collaborative playlists.
   Before this ships publicly: PostgreSQL, S3 + CDN for audio.
3. **Discovery**: browse, charts, new releases, editorial playlists, artist pages.
4. **Artist growth**: drops, pre-saves, smart links, stats, top fans.
5. **Live**: Rooms, Blend, Rewind (adds a realtime service).
6. **Business**: subscriptions, payments, DDEX, royalty reports.

Native iOS/Android apps may start after Phase 2.

## Phase 1 scope (the first build)

- Rename AngelMusic to Yaapu across code, docs, deploy, page titles, PWA manifest, icons, API
  name and Subsonic server type. Storage keys move from `am.` to `yp.` (users sign in again).
- Replace the Ribbon/Hallmark theme with the Yaapu design system (tokens above) in
  `frontend/src/tokens.css` and the Tailwind mapping; restyle the shell, controls, cards, lists,
  dialogs, login.
- New stage Now Playing view (route `#/now`) with cover-colour bloom, opened from the player bar;
  colour is extracted on the client from the cover image (no backend change).
- New wordmark and app icon in the identity.
- Keep every existing feature, route, handler and test hook working.

Done when: no "AngelMusic"/"AngelStream" remains, backend tests pass, frontend lint and build
pass, the Docker image builds, and Home, Album, Now Playing, Upload, Settings and Login are
checked at 1440 and 390 px.

## Left to the builder

Exact spacing scale, component-level details, the colour-extraction method, icon drawing, and
copy, all within the system above.
