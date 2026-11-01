# Yaapu "Sticker chrome" redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the web app's look as "Sticker chrome" (light, glossy, sticker-tilted, global) with Phosphor icons and drawn music-artifact stickers, keeping every feature and route.

**Architecture:** Tokens in `frontend/src/tokens.css` switch to the Sticker chrome palette; Tailwind keeps its colour names (`surface-*`, `fg`, `muted`, `accent`, `social`…) mapped onto the new values, so most screens change through tokens. Icons keep their export names in `components/Icons.jsx` but render Phosphor. A new `components/Stickers.jsx` holds the sticker label and drawn artifacts. The shell, player, Home, Now Playing, Login and cards are recomposed to match the approved mockup.

**Tech Stack:** React 19, Tailwind 3.4, `@phosphor-icons/react` (MIT, new), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-yaapu-design.md` (Identity and design system, revised). Mockup: `.superpowers/brainstorm/1375-1793569127/content/sticker-app-v3.html` (minus the Tamil letter sticker and the culture-specific stickers, per the owner).

## Global Constraints

- Palette exact: pearl `#F7F2FF`, lilac `#E9E3FF`, mint `#D6F7EE`, ink `#19161F`, lime `#C6FF3D`, bubblegum `#FF6FD8`, gum-ink `#B0127A`, muted `#5A5466`, white `#FFFFFF`.
- Never white text on bubblegum; bubblegum fills carry ink text; bubblegum as text is gum-ink.
- Lime = play and primary actions. Bubblegum = friends and live. Never swapped.
- Fonts: Syne 800 display, Hanken Grotesk text, Noto Sans Tamil fallback only.
- No Tamil lettering or culture-specific motifs as decoration.
- Tilt only featured covers and stickers; lists, forms and controls stay straight.
- Spinning cover only while playing; `prefers-reduced-motion` stops it.
- Every route, handler, `aria-label` and test hook keeps working.

## Review Focus

- Long titles on tilted mix cards and in the player pill: truncate, never overflow the card.
- The floating player pill must not cover the last rows of any page (bottom padding equals its height).
- Phone: the pill sits above the tab bar; nothing behind it is unreachable.
- Focus rings stay visible on the light ground (ink ring) and on ink surfaces (lime ring).
- A user with no friends yet: story rings and the friends column show an inviting empty state, not a blank strip.

---

### Task 1: Tokens, fonts and icons

**Files:** `frontend/src/tokens.css`, `frontend/tailwind.config.js`, `frontend/index.html`, `frontend/public/manifest.webmanifest`, `frontend/src/base.css`, `frontend/src/components/Icons.jsx`, `frontend/package.json`.

**Interfaces:** CSS vars `--color-pearl|lilac|mint|ink|lime|gum|gum-ink|muted|white|sky|peach`, `--ground` (the pearl-lilac-mint gradient), `--radius-sm 12px|md 22px|lg 30px|pill`, `--shadow-sticker`, `--shadow-float`. Tailwind: `surface-0`=pearl, `surface-1`=white, `surface-2`=`#F3EFFA`, `surface-3`=`#E7E2F0`, `line`=`#E3DEEC`, `fg`=ink, `fg-2`=`#3A3542`, `muted`, `accent`=lime, `accent-ink`=ink, `accent-soft`=`#ECFFC2`, `social`=bubblegum, `social-ink`=gum-ink, `ink`, `gold`=`#9A5B00`, `danger`=`#C2273B`. Icons.jsx keeps every current export name.

- [ ] Contrast check (node one-off) for the pairs in the spec; all pass.
- [ ] Install `@phosphor-icons/react`; map each existing icon name to a Phosphor icon (fill weight where it sits in navigation).
- [ ] lint, test, build pass; commit `feat(design): sticker chrome tokens and Phosphor icons`.

### Task 2: Stickers and the shell

**Files:** create `frontend/src/components/Stickers.jsx`; modify `Wordmark.jsx`, `Shell.jsx`, `PlayerBar.jsx`, `index.css`, `App.jsx`, `FriendsRail.jsx`, icons in `public/`.

**Interfaces:** `<StickerLabel tone="lime|gum|sky|peach" tilt={deg}>`, `<Artifact kind="vinyl|cassette|headphones|boombox|drum|sparkle" size tilt />`, `<DotLoops className />` (background pattern).

- [ ] Wordmark: ink rounded square with a lime dot (tilted) + "yaapu" in Syne 800; regenerate icons/favicon.
- [ ] Sidebar as a floating translucent white panel; active item ink pill with lime text; "Your playlists" with a "with <name>" bubblegum sticker on shared playlists.
- [ ] Player: floating ink pill (desktop centred, max 760 px; phone above the tab bar), spinning round cover, lime play disc, lime progress, resolution chip; main gets bottom padding equal to the pill.
- [ ] Friends column: white translucent panel, square-ish tilted avatars, bubblegum "live" stickers. Mobile tab bar: lime pill on the active tab.
- [ ] Verify (headless 1440 + 390); commit `feat(design): sticker shell, player pill, stickers`.

### Task 3: Screens

**Files:** `views/Home.jsx`, `components/MixGrid.jsx`, `components/Grid.jsx`, `components/TrackList.jsx`, `components/QualityBadge.jsx`, `views/NowPlaying.jsx`, `components/Login.jsx`, `views/Profile.jsx`, `views/Friends.jsx`, `views/Playlists.jsx`, `views/Albums.jsx`, `views/Settings.jsx`, `views/Upload.jsx`, `views/Review.jsx`, `components/Dialog.jsx`, `components/Menu.jsx`, `lib/sharecard.js`.

- [ ] Home: chrome greeting with a line about live friends; phone story rings of live friends; mix cards as tilted white-bordered stickers with a tag sticker; recently played in a white card; artifact stickers placed beside section heads.
- [ ] Now Playing: tilted white-bordered cover with stickers ("on repeat" when play_count ≥ 3, "<friend> is here" when a friend plays the same track), chrome title, ink pill controls, reaction chips.
- [ ] Login: pearl ground, big chrome wordmark, artifact stickers, white form card.
- [ ] Lists, grids, badges, menus, dialogs, settings, upload/review restyled through the components.
- [ ] Share card: pearl gradient, tilted cover, chrome title, sticker labels.
- [ ] Verify all screens headless at 1440 and 390, sloplint 0 FAIL; push; commit `feat(design): sticker chrome screens`.
