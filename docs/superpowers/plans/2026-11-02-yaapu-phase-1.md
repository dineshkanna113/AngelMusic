# Yaapu Phase 1: rebrand and design system Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the web app as Yaapu: new name everywhere users see it, the "temple night" design system, and a full-screen Now Playing stage whose colour blooms from the cover art.

**Architecture:** Brand strings change in place. The design system replaces `frontend/src/tokens.css` and keeps the existing Tailwind colour names (`surface-*`, `fg`, `muted`, `accent`, …) so every component keeps working, plus one new `social` colour. Cover colour is computed in the browser from the already-loaded cover image (new pure module `lib/color.js`, unit-tested with Vitest) and published as CSS variables by a small store.

**Tech Stack:** React 19, Vite 6, Tailwind 3.4, Vitest (new dev dependency), FastAPI (unchanged except names).

**Spec:** `docs/superpowers/specs/2026-11-02-yaapu-design.md`

## Global Constraints

- Palette, exact: night `#160F1E`, dusk `#251A30`, marigold `#FFB020`, kingfisher `#19C2B8`, jasmine `#F6EFE3`, mist `#A497B0`.
- Fonts: Bricolage Grotesque (display), Hanken Grotesk (text), Noto Sans Tamil (Tamil fallback), from Google Fonts.
- Marigold = play, primary actions, premium. Kingfisher = social and live only. Never swap them.
- No all-caps labels, no dot-joined meta strings, no monospace data labels, no arrows glued to link text.
- Only one orchestrated animation (the cover bloom); all other motion answers a user action; `prefers-reduced-motion` turns the bloom into an instant colour change.
- Every existing route, handler, `aria-label`, `id` and API contract keeps working; `docs/MOBILE_API.md` stays additive-only.
- Infrastructure identifiers stay as they are so the live server updates in place: Compose project `angelmusic`, `/srv/angelmusic/...` paths, the GitHub repo URL `dineshkanna113/AngelMusic`.
- Screens are designed at 390 px first, then 1440 px.

## Review Focus

- A track with no cover art: Now Playing and the bloom fall back to night/dusk, no flash of an odd colour.
- A cover that is near-white or near-black: extracted colour is clamped so jasmine text on it still meets 4.5:1.
- Offline playback (cover from a `blob:` URL) and cross-origin covers: extraction must not throw on a tainted canvas; it falls back.
- A returning user with an old `am.session` in storage: they land on sign-in cleanly, no crash.
- Tamil track titles render in Noto Sans Tamil, not boxes.

---

## File map

| File | Change |
|---|---|
| `backend/app/main.py`, `backend/app/manage.py`, `backend/app/routes/auth.py`, `backend/app/routes/subsonic.py` | brand strings |
| `backend/tests/test_mobile.py` | assert new brand |
| `README.md`, `frontend/README.md`, `docs/DEPLOY.md`, `docs/MOBILE_API.md`, `docs/openapi.json` | brand strings (not infra ids) |
| `frontend/index.html`, `frontend/public/manifest.webmanifest`, `frontend/package.json`, `frontend/package-lock.json` | name, colours, fonts |
| `frontend/public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `frontend/public/favicon.svg` | new mark |
| `frontend/src/lib/api.js`, `lib/offline.js`, `lib/player.js`, `views/Songs.jsx` | storage keys `am.` to `yp.` |
| `frontend/src/tokens.css`, `frontend/tailwind.config.js`, `frontend/src/index.css` | design system |
| `frontend/src/components/Wordmark.jsx` (new) | the Yaapu wordmark |
| `frontend/src/components/Shell.jsx`, `PlayerBar.jsx`, `Login.jsx`, `Grid.jsx`, `MixGrid.jsx`, `Dialog.jsx`, `Menu.jsx` | restyle |
| `frontend/src/lib/color.js` (new) + `frontend/src/lib/color.test.js` (new) | cover colour extraction |
| `frontend/src/lib/ambient.js` (new) | store: current cover colour as CSS variables |
| `frontend/src/views/NowPlaying.jsx` (new), `frontend/src/App.jsx` | stage route `#/now` |

---

### Task 1: Rename to Yaapu

**Files:** Modify the brand-string files in the file map (backend, docs, frontend names, storage keys). Test: `backend/tests/test_mobile.py`.

**Interfaces:**
- Produces: `/api/config` → `"name": "Yaapu"`; FastAPI title `"Yaapu API"`; Subsonic `"type": "yaapu"`; storage keys `yp.session`, `yp.player`, `yp.resume`, `yp.offline.meta`, `yp.songs.sort`, cache `yp-offline-v1`; npm name `yaapu-frontend`.

- [ ] **Step 1: Write the failing test** in `test_config_health_etag_and_request_id`: `assert cfg["name"] == "Yaapu"`; add `test_subsonic_ping_type` asserting `client.get("/rest/ping?f=json&u=..&p=..")` (use the existing Subsonic test helper pattern in `test_features.py`) returns `["subsonic-response"]["type"] == "yaapu"`.
- [ ] **Step 2: Run** `cd backend && .venv/Scripts/python.exe -m pytest -q tests/test_mobile.py` — expect FAIL on the name.
- [ ] **Step 3: Replace brand strings.** "AngelMusic"/"angelmusic" become "Yaapu"/"yaapu" in user-facing text, API name, Subsonic type, manage.py description, auth.py example device, docs. Leave infra ids from Global Constraints untouched. Storage keys `am.`→`yp.`. Regenerate `docs/openapi.json` with `python -m app.manage openapi ../docs/openapi.json`.
- [ ] **Step 4: Run** backend tests (all pass) and `git grep -n -i "angelmusic\|angelstream" -- . ':!docs/superpowers'` — only infra ids (Compose project, `/srv/angelmusic`, repo URL) remain.
- [ ] **Step 5: Commit** `chore: rename AngelMusic to Yaapu`.

### Task 2: Design system tokens

**Files:** `frontend/src/tokens.css`, `frontend/tailwind.config.js`, `frontend/src/index.css`, `frontend/index.html`, `frontend/public/manifest.webmanifest`.

**Interfaces:**
- Produces CSS variables: `--color-night`, `--color-dusk`, `--color-dusk-2` (a step above dusk), `--color-line`, `--color-marigold`, `--color-marigold-ink` (text on marigold), `--color-kingfisher`, `--color-jasmine`, `--color-mist`, `--color-error`, `--color-warn`, `--color-scrim`, `--ambient` and `--ambient-ink` (set by Task 4, defaulting to dusk/jasmine), `--font-display`, `--font-body`, `--radius-sm|md|lg|pill`.
- Tailwind keeps `surface-0`=night, `surface-1`=dusk, `surface-2`/`surface-3` (lighter steps), `line`, `fg`=jasmine, `fg-2`, `muted`=mist, `accent`=marigold, `accent-ink`, `accent-soft`, `gold`=warn, `danger`, `scrim`; adds `social`=kingfisher and `ambient`. Fonts `font-display`, `font-sans`.
- Light OS setting: Yaapu is dark-only in Phase 1 (`color-scheme: dark`); the light colourway is removed.

- [ ] **Step 1:** Write `tokens.css` with the exact Global Constraints hex values, the scale and radii; remove the Hallmark stamp and Ribbon tokens; `base.css` import stays (focus, overflow, reduced-motion floor).
- [ ] **Step 2:** Update `tailwind.config.js` mapping (same `color-mix` helper), `index.html` fonts link (Bricolage Grotesque opsz+wdth+wght 400..800, Hanken Grotesk 400/500/600, Noto Sans Tamil 400/600), `theme-color` `#160F1E`, manifest colours.
- [ ] **Step 3: Verify contrast:** a node one-off computes WCAG ratios; required ≥ 4.5: jasmine/night, jasmine/dusk, mist/night, marigold-ink/marigold; ≥ 3: kingfisher/night. Expected all pass; print them in the commit message body.
- [ ] **Step 4:** `npm run lint` (0 errors) and `vite build` pass.
- [ ] **Step 5: Commit** `feat(design): Yaapu temple-night tokens`.

### Task 3: Shell, controls and wordmark

**Files:** create `components/Wordmark.jsx`; modify `Shell.jsx`, `PlayerBar.jsx`, `Login.jsx`, `Grid.jsx`, `MixGrid.jsx`, `Dialog.jsx`, `Menu.jsx`, `index.css` component classes; icons in `public/`.

**Interfaces:**
- Produces `<Wordmark className? />`: the word "yaapu" in Bricolage Grotesque at a wide width, lowercase, with a marigold mark (a short stacked-bars metre glyph: long–short–long). Used in Sidebar, Login, Mobile header.
- `.btn-primary` = marigold pill; `.btn-secondary` = dusk pill with line border; `.btn-social` (new) = kingfisher outline pill.

- [ ] **Step 1:** Search Watermelon (`search` tool) for: navigation sidebar, music player bar, login card, toast. Take ideas that fit; adapt source to the tokens and native accessible controls; record which slugs were used in the commit body.
- [ ] **Step 2:** Restyle: sidebar on dusk with display-face section names; player bar on night with a marigold play disc and the seek fill in marigold; cards with `--radius-md`, no shadows on grids; login as a full-height stage with the wordmark set large.
- [ ] **Step 3:** Generate icons: a 512 px PNG of the mark on night (and maskable with 20% padding), 192 px, plus `favicon.svg`; update `index.html`.
- [ ] **Step 4: Verify:** lint, build, and `node <hallmark>/scripts/sloplint.mjs src/index.css src/components/*.jsx src/views/*.jsx --scope app` shows 0 FAIL.
- [ ] **Step 5: Commit** `feat(design): Yaapu shell, controls and mark`.

### Task 4: Cover colour extraction

**Files:** create `frontend/src/lib/color.js`, `frontend/src/lib/color.test.js`, `frontend/src/lib/ambient.js`; add `vitest` dev dependency and `"test": "vitest run"` script; CI frontend job runs `npm test`.

**Interfaces:**
- `pickAmbient(pixels: Uint8ClampedArray): { r, g, b } | null` — from RGBA pixels, ignores transparent and near-grey pixels, returns the most frequent saturated colour bucket, or `null` if none.
- `clampForText(rgb): { r, g, b }` — adjusts lightness so `#F6EFE3` text on it has contrast ≥ 4.5.
- `contrast(a, b): number` — WCAG ratio.
- `ambient.fromImage(img: HTMLImageElement): void` — draws to a 32×32 canvas, calls the two functions, sets `--ambient` / `--ambient-ink` on `:root`; on a tainted canvas or `null` sets the defaults (dusk / jasmine). `ambient.reset()`.

- [ ] **Step 1: Write failing tests:**
  - `pickAmbient` of a buffer that is 70% `rgb(200,40,60)` and 30% grey returns a colour within 16 of `(200,40,60)`.
  - all-grey or all-transparent buffer returns `null`.
  - `clampForText({r:250,g:240,b:200})` gives `contrast(result, {r:246,g:239,b:227}) >= 4.5`.
  - `clampForText({r:5,g:5,b:5})` stays dark enough (contrast ≥ 4.5) and is not changed by more than 30 in any channel.
- [ ] **Step 2: Run** `npm test` — FAIL (module missing).
- [ ] **Step 3:** Implement `color.js` (12-bit bucket histogram, saturation threshold 0.25; lightness clamp in HSL steps of 2%) and `ambient.js` (try/catch around `getImageData`).
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat: extract ambient colour from cover art`.

### Task 5: Now Playing stage and bloom

**Files:** create `views/NowPlaying.jsx`; modify `App.jsx` (route `now`), `PlayerBar.jsx` (cover/title opens `#/now`), `Cover.jsx` (calls `ambient.fromImage` when `track` is the current track and the image loads).

**Interfaces:**
- Consumes `ambient` (Task 4), `usePlayer` state, existing `SidePanels` lyrics/queue components.
- Produces route `#/now`: large cover, title in display face (Tamil falls back to Noto Sans Tamil), artist link, the existing controls, and a lyrics/queue tab pair. Background = radial bloom of `--ambient` into night.

- [ ] **Step 1:** Build the view; the bloom is a 700 ms transition of `--ambient` (registered with `@property` so it interpolates) on track change only; reduced motion = instant.
- [ ] **Step 2:** Esc or the down chevron returns to the previous route; keyboard focus lands on the play control when the stage opens.
- [ ] **Step 3: Verify in Chrome** (dev server on 5173, backend 8010): at 1440 and 390 px — Home, Album, Now Playing (with art, without art), Upload, Settings, Login; no horizontal page scroll at 390 px; a Tamil title renders.
- [ ] **Step 4:** Backend tests, `npm test`, lint, build, `docker build .` all pass.
- [ ] **Step 5: Commit** `feat: Now Playing stage with cover bloom`, push `main`.
