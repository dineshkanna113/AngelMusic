# Yaapu API for mobile apps

Everything the web app does goes through this JSON API, so a native app (iOS, Android,
Flutter, React Native) has the same capabilities. The full schema is in
[`openapi.json`](openapi.json) (regenerate with `python -m app.manage openapi docs/openapi.json`);
it imports into Postman, Insomnia, or OpenAPI code generators.

Base URL: `https://<your-domain>`. All paths below start with `/api`. Native apps don't need
CORS.

## Contract

- **Versioning.** `GET /api/config` returns `api_version` (currently `1`). Within a version,
  changes are additive only: new fields and endpoints may appear, existing ones keep their
  meaning. **Ignore unknown fields.** A breaking change would bump `api_version`.
- **Forced update.** Compare your app version with `min_app_version` from `/api/config` at
  launch; if older, show an "update the app" screen.
- **Errors** are `{"detail": "<message for the user>"}` with a proper status code. Validation
  errors (422) have `detail` as a list of `{loc, msg}`. A 500 includes `request_id`.
- **Request IDs.** Send `X-Request-ID: <uuid>` on each request (optional); the same value comes
  back in the response and in server logs, so a bug report can name the exact request.
- **Times** are UTC, `YYYY-MM-DD HH:MM:SS`.

## Launch sequence

```
GET  /api/config                 no auth: versions, registration_open, upload limits, features
POST /api/auth/refresh           if a refresh token is stored  -> new tokens, or 401 -> show sign-in
GET  /api/tracks                 with If-None-Match: <stored ETag>  -> 304 = library unchanged
```

## Authentication

```
POST /api/auth/login     {"username", "password", "device": "Pixel 8 · Yaapu 1.0"}
POST /api/auth/register  same body; only when /api/config says registration_open
-> 200 {
     "access_token": "...", "expires_in": 3600,
     "refresh_token": "...", "refresh_expires_in": 5184000,
     "session_id": "...", "user": {"id", "username", "is_admin", "can_upload"}
   }
```

- Send `Authorization: Bearer <access_token>` on every request. It lives 1 hour.
- Store the **refresh token in the Keychain / Android Keystore** (never plain prefs).
- Renew with `POST /api/auth/refresh {"refresh_token"}` shortly before `expires_in` runs out,
  or when a request returns 401. **Every refresh returns a new refresh token: always store
  the new one.** Refreshing twice with the same token within 60 seconds is tolerated (app
  resume races); replaying an older one revokes the device session (it was copied).
- A 401 from `/refresh` means signed out (password changed, device revoked, 60 days unused):
  clear tokens and show sign-in.
- `POST /api/auth/logout` signs this device out. `GET /api/auth/sessions` lists signed-in
  devices (`current: true` marks this one) and `DELETE /api/auth/sessions/{id}` signs one out.
- **Account deletion** (required by the App Store and Google Play):
  `DELETE /api/auth/account {"password"}`. Deletes the user's favorites, playlists, history,
  sessions and unpublished uploads.

## Library

| Call | Notes |
|---|---|
| `GET /api/tracks` | The whole library with this user's `favorite`, `play_count`, `last_played`. Send `If-None-Match` with the last `ETag`; a 304 means use the cache. |
| `GET /api/albums`, `GET /api/artists` | Same ETag behaviour. |
| `GET /api/tracks/{id}/lyrics` | `{"synced": [{"time", "text"}] or null, "plain"}`; 404 if none. |
| `PUT/DELETE /api/favorites/{id}` | |
| `GET/POST/PATCH/DELETE /api/playlists[/{id}]`, `POST /api/playlists/{id}/tracks` | PATCH with `track_ids` replaces the order. |
| `POST /api/history {"track_id"}` | Call after 30 s of playback (or half the track). Drives play counts and the mixes. |
| `GET /api/history` | Recently played. |

Track fields worth knowing: `codec`, `mime`, `sample_rate`, `bit_depth`, `lossless`,
`rg_track_gain`/`rg_album_gain` (ReplayGain, dB), `has_cover`, `has_lyrics`, `duration` (s).

## Playback, covers and offline

Players can't always attach headers, so media URLs use a **stream token** in the query string:

```
POST /api/auth/stream-token          -> {"token", "expires_in": 21600}
GET  /api/stream/{track_id}?t=<token>        original file, HTTP range requests (seeking)
GET  /api/download/{track_id}?t=<token>      same file as an attachment (offline saving)
GET  /api/tracks/{track_id}/cover?t=<token>  embedded or folder art
```

- Refresh the stream token when it has under an hour left; it dies with the device session.
- Files are served **byte-for-byte** (FLAC, ALAC, WAV, AIFF; also MP3/AAC/Ogg/Opus): no
  transcoding. ExoPlayer/Media3 and AVPlayer play FLAC natively (AVPlayer: iOS 11+).
- For offline, download with `/api/download` and play the local file; post plays to
  `/api/history` when back online.
- Gapless: prepare the next item in the player's queue (ExoPlayer playlists, AVQueuePlayer).

## Social

| Call | Notes |
|---|---|
| `GET /api/people?q=` | Find people by username or display name. Items are `PersonCard`: `id, username, display_name, avatar_url, is_following, follows_you`. |
| `GET /api/people/{username}` | Profile: `bio, followers, following, is_private, is_self, top_artists, playlists`. `top_artists` and `playlists` are `null` when a private profile hides them (only mutual friends see them). |
| `PUT/DELETE /api/people/{username}/follow` | Idempotent. Mutual follows are friends. |
| `GET /api/people/{username}/followers`, `/following` | Lists of `PersonCard`. |
| `PATCH /api/me/profile` | `display_name` (≤40), `bio` (≤160), `is_private`, `share_activity`. |
| `POST /api/me/avatar` (multipart `file`), `DELETE /api/me/avatar` | PNG, JPEG or WebP up to 2 MB. Avatar URLs are public and never change; a new upload gets a new URL. |
| `PUT/DELETE /api/artists/{id}/follow`, `GET /api/me/artists` | Followed artists; `/api/artists` items carry `following`. |
| `POST /api/presence {"track_id" or null}` | Send on track change and every 60 s while playing; `null` on pause. |
| `GET /api/activity` | Friends' listening: `{person, track, live, at}`, live (heartbeat < 2 min) first. Poll every 20-30 s while visible. |

Playlists carry `visibility` (`private`/`public`), `collaborative`, `owner` and the caller's `role`
(`owner`, `member`, `viewer`). Owners `PATCH` visibility and collaboration and manage members with
`GET/POST /api/playlists/{id}/members` and `DELETE /api/playlists/{id}/members/{username}`
(only people you follow or who follow you). Members can reorder and add tracks; viewers read
public playlists. A playlist you can't see is a 404.

## Discovery

| Call | Notes |
|---|---|
| `GET /api/charts?days=7&limit=50` | Most played tracks across all listeners in the window: tracks with `rank` and `plays`. Aggregate only; empty when nothing was played. |
| `GET /api/artists/{id}` | `{id, name, bio, followers, following, top_tracks (≤5, with plays), albums}`. `bio` is `""` when none. |
| `PUT /api/artists/{id}/bio {"bio"}` | Admin only; max 1000 characters; empty clears. |
| `GET /api/editorial` | Playlists admins featured on Browse (always public). Admins feature one with `PATCH /api/playlists/{id} {"featured": true}`. |

Tracks also carry `mood` and `language` (display name, e.g. "Tamil"; empty when untagged), read from the
files' tags. Genre, mood and language browsing and "new releases" are computed in the app from the
track list (`added_at`), so they need no extra calls.

## Uploading (users with `can_upload`)

Resumable, chunked (tus-style). Files go to review; nothing is public until an admin approves.

```
POST /api/uploads {"filename", "size"}                       -> {"id", "chunk_size", ...}
PUT  /api/uploads/{id}/content   Upload-Offset: <bytes sent so far>   body: next chunk (≤ 64 MiB)
     -> {"received", "status"}   409 {"received"} = resume from there
GET  /api/uploads/{id}           status: uploading | processing | invalid | pending | scheduled | published | declined | removed
PATCH /api/uploads/{id}          fix tags before review: title, artist, album, album_artist, genre, year, track_no, disc_no
GET  /api/uploads?status=        your uploads + counts per status
DELETE /api/uploads/{id}         withdraw an unpublished upload
```

On a dropped connection, `GET /api/uploads/{id}` and continue from `received`. `issues`
on an upload lists problems (`level: error` blocks publishing; `warning` doesn't).

Admins also have `POST /api/uploads/{id}/approve {"release_at"?}` (now, or scheduled),
`POST /api/uploads/{id}/decline {"note"}`, `GET /api/uploads?scope=all`, and
`DELETE /api/tracks/{id}` (takedown).

## Subsonic

The server also speaks the Subsonic/OpenSubsonic API at `/rest` (users create an app
password in Settings). It lets existing apps such as Symfonium, Tempo or play:Sub work today,
before a native app ships.
