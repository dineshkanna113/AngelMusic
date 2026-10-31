import { useSyncExternalStore } from "react";
import { api, ApiError } from "./api";
import { offline } from "./offline";
import { toast, toastError } from "./toast";

const artistName = (t) => t.album_artist || t.artist || "Unknown artist";

function deriveAlbums(tracks) {
  const map = new Map();
  for (const t of tracks) {
    let a = map.get(t.album_id);
    if (!a) {
      a = {
        id: t.album_id,
        name: t.album || "Unknown album",
        artist: artistName(t),
        artist_id: t.artist_id,
        year: t.year,
        genre: t.genre,
        tracks: [],
        duration: 0,
        cover: null,
        added_at: t.added_at,
        play_count: 0,
        hires: false,
      };
      map.set(t.album_id, a);
    }
    a.tracks.push(t);
    a.duration += t.duration;
    a.play_count += t.play_count;
    a.year ||= t.year;
    a.genre ||= t.genre;
    if (t.added_at > a.added_at) a.added_at = t.added_at;
    if (!a.cover && t.has_cover) a.cover = t;
    if (t.lossless && ((t.bit_depth ?? 0) > 16 || (t.sample_rate ?? 0) > 48000)) a.hires = true;
  }
  for (const a of map.values()) {
    a.tracks.sort((x, y) => (x.disc_no ?? 1) - (y.disc_no ?? 1) || (x.track_no ?? 0) - (y.track_no ?? 0));
  }
  return [...map.values()].sort((x, y) => x.artist.localeCompare(y.artist) || x.name.localeCompare(y.name));
}

function deriveArtists(albums) {
  const map = new Map();
  for (const a of albums) {
    let ar = map.get(a.artist_id);
    if (!ar) {
      ar = { id: a.artist_id, name: a.artist, albums: [], track_count: 0, cover: null };
      map.set(a.artist_id, ar);
    }
    ar.albums.push(a);
    ar.track_count += a.tracks.length;
    ar.cover ||= a.cover;
  }
  return [...map.values()].sort((x, y) => x.name.localeCompare(y.name));
}

class LibraryStore {
  constructor() {
    this.listeners = new Set();
    this.state = this.build(null, { playlists: null, scanning: false, error: "", offlineMode: false });
    this.pollTimer = null;
  }

  subscribe = (fn) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.state;

  build(tracks, rest) {
    const list = tracks ?? [];
    const albums = deriveAlbums(list);
    return {
      ...this.state,
      ...rest,
      tracks,
      byId: new Map(list.map((t) => [t.id, t])),
      albums,
      artists: deriveArtists(albums),
    };
  }

  set(patch) {
    this.state = "tracks" in patch ? this.build(patch.tracks, patch) : { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  async load() {
    try {
      const data = await api("/api/tracks");
      this.set({ tracks: data.tracks, scanning: data.scanning, error: "", offlineMode: false });
      clearTimeout(this.pollTimer);
      if (data.scanning) this.pollTimer = setTimeout(() => this.load(), 2000);
      return data.tracks;
    } catch (err) {
      if (err instanceof ApiError && err.status === 0 && offline.tracks().length) {
        this.set({ tracks: offline.tracks(), error: "", offlineMode: true });
        return this.state.tracks;
      }
      this.set({ error: err.message });
      return null;
    }
  }

  reset() {
    clearTimeout(this.pollTimer);
    this.state = this.build(null, { playlists: null, scanning: false, error: "", offlineMode: false });
    this.listeners.forEach((fn) => fn());
  }

  patchTrack(id, patch) {
    if (!this.state.tracks) return;
    this.set({ tracks: this.state.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  }

  async toggleFavorite(track) {
    const favorite = !this.state.byId.get(track.id)?.favorite;
    this.patchTrack(track.id, { favorite });
    try {
      await api(`/api/favorites/${track.id}`, { method: favorite ? "PUT" : "DELETE" });
    } catch (err) {
      this.patchTrack(track.id, { favorite: !favorite });
      toastError(err);
    }
  }

  recordPlay(trackId) {
    const t = this.state.byId.get(trackId);
    if (t) this.patchTrack(trackId, { play_count: t.play_count + 1, last_played: new Date().toISOString() });
    api("/api/history", { method: "POST", body: { track_id: trackId } }).catch(() => {});
  }

  async loadPlaylists() {
    try {
      const { playlists } = await api("/api/playlists");
      this.set({ playlists });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 0)) toastError(err);
    }
  }

  async createPlaylist(name, trackIds = []) {
    const pl = await api("/api/playlists", { method: "POST", body: { name, track_ids: trackIds } });
    await this.loadPlaylists();
    return pl;
  }

  async addToPlaylist(playlist, trackIds) {
    try {
      await api(`/api/playlists/${playlist.id}/tracks`, { method: "POST", body: { track_ids: trackIds } });
      toast(`Added ${trackIds.length === 1 ? "1 track" : `${trackIds.length} tracks`} to ${playlist.name}`);
      this.loadPlaylists();
    } catch (err) {
      toastError(err);
    }
  }

  async deletePlaylist(id) {
    await api(`/api/playlists/${id}`, { method: "DELETE" });
    await this.loadPlaylists();
  }
}

export const library = new LibraryStore();
export const useLibrary = () => useSyncExternalStore(library.subscribe, library.getSnapshot);
export const useOffline = () => useSyncExternalStore(offline.subscribe, offline.getSnapshot);
