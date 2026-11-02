import { api, API_BASE, accessToken, ApiError } from "./api";

const enc = encodeURIComponent;

/** Milliseconds for a UTC timestamp, in ISO ("...Z", "+05:30") or SQLite ("YYYY-MM-DD HH:MM:SS") form. */
export function parseUtc(value) {
  let text = String(value).trim().replace(" ", "T");
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(text)) text += "Z";
  return Date.parse(text);
}

/** Time left until `releaseAt`, split for a countdown. Never negative; `done` once the time has come. */
export function countdownParts(releaseAt, now = Date.now()) {
  const left = Math.max(0, Math.floor((parseUtc(releaseAt) - now) / 1000));
  return {
    done: left === 0,
    days: Math.floor(left / 86400),
    hours: Math.floor((left % 86400) / 3600),
    minutes: Math.floor((left % 3600) / 60),
    seconds: left % 60,
  };
}

/**
 * Points for a plays-per-day line chart. Zero sits at the bottom and the busiest day at the top,
 * so every drawn height is a real count. Returns the points, the maximum and SVG path strings.
 */
export function chartPoints(series, width, height, pad = 8) {
  const max = Math.max(1, ...series.map((d) => d.plays));
  const innerH = height - pad * 2;
  const step = series.length > 1 ? width / (series.length - 1) : 0;
  const points = series.map((d, i) => ({
    x: Math.round(i * step * 100) / 100,
    y: Math.round((pad + innerH - (d.plays / max) * innerH) * 100) / 100,
    ...d,
  }));
  const line = points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
  const area = points.length ? `${line} L${points.at(-1).x} ${height} L${points[0].x} ${height} Z` : "";
  return { points, max, line, area };
}

export const growth = {
  studio: () => api("/api/studio").then((d) => d.artists),
  stats: (artistId, days) => api(`/api/artists/${enc(artistId)}/stats?days=${days}`),
  drops: (artistId) => api(`/api/drops${artistId ? `?artist_id=${enc(artistId)}` : ""}`).then((d) => d.drops),
  drop: (slug) => api(`/api/drops/${enc(slug)}`),
  createDrop: (body) => api("/api/drops", { method: "POST", body }),
  editDrop: (id, patch) => api(`/api/drops/${id}`, { method: "PATCH", body: patch }),
  deleteDrop: (id) => api(`/api/drops/${id}`, { method: "DELETE" }),
  presave: (id, on) => api(`/api/drops/${id}/presave`, { method: on ? "PUT" : "DELETE" }),
  grant: (artistId, username, on) =>
    api(`/api/artists/${enc(artistId)}/owners/${enc(username)}`, { method: on ? "PUT" : "DELETE" }),
  uploads: () => api("/api/uploads?scope=mine&limit=100").then((d) => d.uploads ?? d.items ?? []),

  /** Multipart upload; api() only sends JSON. */
  async uploadArtwork(id, file) {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_BASE}/api/drops/${id}/artwork`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken()}` },
      body: form,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, data?.detail || `Upload failed (${res.status})`);
    return data;
  },
};

export const artSrc = (url) => (url ? `${API_BASE}${url}` : null);
