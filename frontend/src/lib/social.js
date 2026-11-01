import { api, API_BASE, accessToken, ApiError } from "./api";

const enc = encodeURIComponent;

export const social = {
  profile: (username) => api(`/api/people/${enc(username)}`),
  search: (q) => api(`/api/people?q=${enc(q)}`).then((d) => d.people),
  followers: (username) => api(`/api/people/${enc(username)}/followers`).then((d) => d.people),
  following: (username) => api(`/api/people/${enc(username)}/following`).then((d) => d.people),
  follow: (username, on) => api(`/api/people/${enc(username)}/follow`, { method: on ? "PUT" : "DELETE" }),
  followArtist: (id, on) => api(`/api/artists/${enc(id)}/follow`, { method: on ? "PUT" : "DELETE" }),
  updateProfile: (patch) => api("/api/me/profile", { method: "PATCH", body: patch }),
  removeAvatar: () => api("/api/me/avatar", { method: "DELETE" }),
  activity: () => api("/api/activity").then((d) => d.friends),
  presence: (trackId) => api("/api/presence", { method: "POST", body: { track_id: trackId } }),
  members: (playlistId) => api(`/api/playlists/${playlistId}/members`).then((d) => d.people),
  addMember: (playlistId, username) => api(`/api/playlists/${playlistId}/members`, { method: "POST", body: { username } }),
  removeMember: (playlistId, username) =>
    api(`/api/playlists/${playlistId}/members/${enc(username)}`, { method: "DELETE" }),

  /** Multipart upload; api() only sends JSON. */
  async uploadAvatar(file) {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_BASE}/api/me/avatar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken()}` },
      body: form,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, data?.detail || `Upload failed (${res.status})`);
    return data;
  },
};

export const avatarSrc = (url) => (url ? `${API_BASE}${url}` : null);
