# AngelStream — lossless streaming server

Streams your own FLAC/WAV/AIFF/ALAC library to the browser, byte-for-byte, with no transcoding.
The frontend lives in `../lossless-stream-frontend`. In production this server also serves the built frontend,
so there's a single origin and no CORS.

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
- **Admin:** upload music by drag-and-drop, rescan, manage users (add, reset password, admin role, delete).
- **Security:** bcrypt passwords, revocable sessions (password change and "sign out everywhere" invalidate all tokens),
  login throttling, stream-only short-lived media tokens, path-traversal-safe file access, no framing.

## Run locally

```bash
python -m venv venv && venv/Scripts/activate        # macOS/Linux: source venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env                                  # set SECRET_KEY; for dev, APP_ENV=development
uvicorn main:app --reload --port 8000
```

Frontend dev server (hot reload, proxies `/api` to :8000):

```bash
cd ../lossless-stream-frontend && npm install && npm run dev   # http://localhost:5173
```

The first account you create becomes the admin. After that, sign-ups follow `ALLOW_REGISTRATION`.
The library is scanned on startup. Changed files are re-read incrementally, and admins can trigger **Rescan** in the UI.

## Tests

```bash
pytest -q
```

## Production

```bash
# from the folder containing both repos
docker build -f lossless-stream-backend/Dockerfile -t angelstream .
docker run -d -p 8000:8000 \
  -e SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')" \
  -v /path/to/music:/music:ro -v angelstream-data:/data angelstream
```

Put it behind a TLS reverse proxy (Caddy, nginx). Notes:

- `SECRET_KEY` is required when `APP_ENV=production`. Changing it signs everyone out.
- `<audio>` can't send headers, so streams use a short-lived (6 h), stream-only token in the query string. The long-lived
  access token never appears in URLs. Access logs are disabled in the container so those tokens aren't logged.
- Don't let the proxy gzip `audio/*` responses. It breaks Range requests.
- Login throttling is in-memory per process. Run one worker, or put rate limiting in the proxy.
- Offline downloads and the PWA need HTTPS (browsers only allow Cache Storage and service workers in secure contexts).
- `MAX_UPLOAD_MB` (default 2048) caps a single uploaded file. Raise your proxy's body-size limit to match.

## API

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/health` | — |
| GET | `/api/auth/status` | — |
| POST | `/api/auth/register`, `/api/auth/login` | — |
| GET | `/api/auth/me` | Bearer |
| POST | `/api/auth/stream-token` | Bearer |
| GET | `/api/tracks`, `/api/tracks/{id}` | Bearer |
| POST | `/api/auth/password`, `/api/auth/logout-all` | Bearer |
| GET/POST/DELETE | `/api/auth/app-password` | Bearer |
| GET | `/api/albums`, `/api/artists`, `/api/tracks/{id}/lyrics` | Bearer |
| GET/PUT/DELETE | `/api/favorites`, `/api/favorites/{id}` | Bearer |
| GET/POST/PATCH/DELETE | `/api/playlists`, `/api/playlists/{id}`, `POST /api/playlists/{id}/tracks` | Bearer |
| GET/POST/DELETE | `/api/history` | Bearer |
| POST | `/api/library/rescan`, `/api/library/upload` | Bearer (admin) |
| GET/POST/PATCH/DELETE | `/api/users`, `/api/users/{id}` | Bearer (admin) |
| GET | `/api/stream/{id}?t=`, `/api/download/{id}?t=` | stream token, supports `Range` |
| GET | `/api/tracks/{id}/cover?t=` | stream token |
| GET/POST | `/rest/*` (Subsonic 1.16.1 + OpenSubsonic `songLyrics`, `formPost`) | username + app password (`p`, `enc:`, or `t`+`s`) |

Interactive docs are at `/api/docs` when not in production.
