# AngelStream — frontend

React + Vite + Tailwind client for the lossless streaming server in `../lossless-stream-backend`
(see that README for the full setup and production deployment).

```bash
npm install
npm run dev     # http://localhost:5173, proxies /api to http://localhost:8000
npm run build   # dist/ is served by the backend in production
npm run lint
```

- `src/lib/player.js` — two-deck playback engine (preloading, error/stall recovery, ReplayGain, Media Session)
- `src/lib/api.js` — API client, session and stream-token handling
- `VITE_API_BASE` — set only if the API is on a different origin than the app
- Keys: Space play/pause · ←/→ seek 10 s · Shift+←/→ prev/next · M mute
