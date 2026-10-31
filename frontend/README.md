# AngelMusic — frontend

The AngelMusic web app (React + Vite + Tailwind). The API is in `../backend`; see the
[root README](../README.md) for local setup and [docs/DEPLOY.md](../docs/DEPLOY.md) for production.

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
