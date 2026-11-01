# Yaapu

A music streaming service for your own library: FLAC, WAV, AIFF and ALAC played byte-for-byte, with no transcoding,
in the browser, in Subsonic apps, and (next) in the Yaapu mobile app.

```
backend/    FastAPI API, library scanner, upload pipeline, Subsonic API      (Python 3.12)
frontend/   Web app: player, library, mixes, uploads, admin                  (React 19, Vite, Tailwind)
deploy/     Production stack: Docker Compose + Caddy (HTTPS)                 -> docs/DEPLOY.md
docs/       DEPLOY.md (AWS), MOBILE_API.md (for app developers), openapi.json
Dockerfile  One image: the built web app served by the API, same origin, no CORS
```

## What it does differently

| Common problem in streaming apps | What this does |
| --- | --- |
| Silent transcoding or "lossless" that isn't | Serves the original file untouched. The **Signal path** panel shows the source format, delivery, device rate and level. |
| Hidden resampling | Detects the browser's output rate and tells you when it differs from the source, and how to match it. |
| Slow start and laggy seeking | HTTP Range streaming: playback starts after the first chunk, and seeking jumps straight to the byte offset. |
| Gaps or loading spinners between tracks | A two-deck player preloads the next track into a standby element and switches when the current one ends (measured ≈1 ms event-to-event on localhost). It isn't sample-accurate gapless, but there's no network fetch at the boundary. |
| Playback dies on flaky Wi-Fi or expired sessions | Auto-recovery: on a network error or a stall of 10 s or more, it refreshes the stream token and resumes from the same position, with backoff. It waits for `online` when offline. |
| Volume levelling that alters the signal | ReplayGain (track/album) is optional and **off by default**, with peak protection so it never clips. |
| No OS integration | Media Session: lock screen, hardware media keys, headset buttons, scrubbing. |
| Lost place after a reload | The queue and position are restored (paused). |
| Library caps (e.g. Tidal's 10,000 saved tracks) | Favorites, playlists and history have no limits. |
| Weak favorites and playlist management | Favorites, playlists with reorder and remove, "play next" / "add to queue", and an editable queue that can be saved as a playlist. |
| Lossless only inside one vendor's app | A Subsonic/OpenSubsonic API lets native apps (Symfonium, Tempo, DSub, play:Sub, Feishin…) stream and sync originals, with CarPlay / Android Auto through those apps. |
| Offline downloads tied to a subscription | "Save for offline" stores the original files on the device (installable PWA). Saved tracks play with no connection. |

## Features

- **Browse:** home (recently played, recently added, most played, Hi-Res), songs (sort, lossless/Hi-Res filter), albums, artists,
  accent-insensitive search.
- **Your music:** unlimited favorites, playlists (create, rename, reorder, remove, delete), listening history and play counts
  (counted at 50% or 4 min, like Last.fm).
- **Playback:** editable queue panel, synced lyrics (`.lrc` sidecar or embedded `LYRICS` tags, click a line to seek),
  sleep timer (minutes or end of track), output-device selection, ReplayGain, keyboard shortcuts, lock-screen controls.
- **Offline and install:** save any track, album or playlist for offline playback. The app is an installable PWA that
  opens without a connection.
- **Downloads:** download the original file of any track.
- **Native apps:** per-user Subsonic *app password* (Settings → Subsonic apps). The account password is never accepted by
  third-party apps.
- **Made for you:** Daily Mixes per taste, On Repeat, Rediscover, Discover, Hi-Res and decade mixes, and track radio,
  built per user from their own plays and favorites.
- **Uploads with review:** resumable chunked uploads (files and whole folders), content-sniffed validation, exact and
  likely-duplicate detection, tag editing, an admin review queue with preview, scheduled releases, and takedowns.
- **Roles:** listener, uploader (submits music for review) and admin.
- **Mobile-ready API:** 1-hour access tokens with rotating refresh tokens, per-device sessions, account deletion,
  `/api/config` for version checks, ETags on the library. See [docs/MOBILE_API.md](docs/MOBILE_API.md).
- **Security:** bcrypt passwords, revocable sessions (password change and "sign out everywhere" invalidate all tokens),
  login throttling, stream-only short-lived media tokens, path-traversal-safe file access, no framing.

## Run locally

Put some music in `audio-library/` at the repository root (it's git-ignored), then:

```bash
cd backend
python -m venv .venv && .venv/Scripts/activate      # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env                                  # set SECRET_KEY; for dev, APP_ENV=development
uvicorn main:app --reload --port 8000
```

Web app with hot reload (proxies `/api` to :8000), in a second terminal:

```bash
cd frontend && npm install && npm run dev            # http://localhost:5173
```

The first account you create becomes the admin. After that, sign-ups follow `ALLOW_REGISTRATION`.
The library is scanned on startup. Changed files are re-read incrementally, and admins can trigger **Rescan** in the UI.

## Tests

```bash
cd backend && pytest -q
cd frontend && npm run lint && npm run build
```

CI runs both, then builds the Docker image (`.github/workflows/ci.yml`).

## Production

**AWS:** follow [docs/DEPLOY.md](docs/DEPLOY.md): one EC2 instance, Docker Compose, Caddy for automatic HTTPS, the database and
music on an EBS volume, nightly database backups to S3. The stack is in [`deploy/`](deploy/).

Notes for any host:

- `SECRET_KEY` is required when `APP_ENV=production`. Changing it signs everyone out.
- On a production server nobody can register until the first admin exists; create it with
  `python -m app.manage create-user <name> --admin` (from `backend/`). Sign-up stays closed unless `ALLOW_REGISTRATION=true`.
- `<audio>` can't send headers, so streams use a short-lived (6 h), stream-only token in the query string. Access logs
  are disabled in the container and in the Caddyfile so those tokens aren't logged.
- Don't let a proxy gzip `audio/*` responses. It breaks Range requests. (The Caddyfile only compresses text and JSON.)
- Run one worker: SQLite, upload locks and the release scheduler live in the process.
- Offline downloads and the PWA need HTTPS.
- `MAX_UPLOAD_MB` (default 2048) caps one file; uploads arrive in 8 MB chunks, so proxies need no special body limit.

## API

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/health` | — |
| GET | `/api/auth/status` | — |
| GET | `/api/config` | — |
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/refresh` | — |
| GET | `/api/auth/me` | Bearer |
| POST | `/api/auth/stream-token` | Bearer |
| GET | `/api/tracks`, `/api/tracks/{id}` | Bearer |
| POST | `/api/auth/password`, `/api/auth/logout`, `/api/auth/logout-all` | Bearer |
| GET/DELETE | `/api/auth/sessions`, `/api/auth/sessions/{id}` | Bearer |
| DELETE | `/api/auth/account` | Bearer + password |
| GET/POST/DELETE | `/api/auth/app-password` | Bearer |
| GET | `/api/albums`, `/api/artists`, `/api/tracks/{id}/lyrics` | Bearer |
| GET/PUT/DELETE | `/api/favorites`, `/api/favorites/{id}` | Bearer |
| GET/POST/PATCH/DELETE | `/api/playlists`, `/api/playlists/{id}`, `POST /api/playlists/{id}/tracks` | Bearer |
| GET/POST/DELETE | `/api/history` | Bearer |
| POST | `/api/library/rescan` | Bearer (admin) |
| POST/GET/PATCH/DELETE | `/api/uploads`, `/api/uploads/{id}`, `PUT /api/uploads/{id}/content` | Bearer (uploader) |
| POST | `/api/uploads/{id}/approve`, `/api/uploads/{id}/decline`, `DELETE /api/tracks/{id}` | Bearer (admin) |
| GET | `/api/uploads/{id}/audio?t=`, `/api/uploads/{id}/cover?t=` | stream token (owner or admin) |
| GET/POST/PATCH/DELETE | `/api/users`, `/api/users/{id}` | Bearer (admin) |
| GET | `/api/stream/{id}?t=`, `/api/download/{id}?t=` | stream token, supports `Range` |
| GET | `/api/tracks/{id}/cover?t=` | stream token |
| GET/POST | `/rest/*` (Subsonic 1.16.1 + OpenSubsonic `songLyrics`, `formPost`) | username + app password (`p`, `enc:`, or `t`+`s`) |

Interactive docs are at `/api/docs` when not in production; the schema is committed at [docs/openapi.json](docs/openapi.json).
