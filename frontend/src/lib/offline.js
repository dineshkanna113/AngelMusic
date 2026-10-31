// Offline downloads: the original files are stored in Cache Storage and played from
// there, so saved tracks keep working on a plane, in a tunnel or on a flaky connection.
import { API_BASE, coverUrl, streamToken } from "./api";

const CACHE = "ls-offline-v1";
const META_KEY = "ls.offline.meta";
const audioKey = (id) => `/offline/audio/${id}`;
const coverKey = (id) => `/offline/cover/${id}`;

export const offlineSupported = typeof window !== "undefined" && "caches" in window && window.isSecureContext;

function readMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY)) || {};
  } catch {
    return {};
  }
}

class OfflineStore {
  constructor() {
    this.meta = readMeta(); // id -> track object, so the library works with no connection
    this.progress = {}; // id -> 0..1 while downloading
    this.listeners = new Set();
    this.snapshot = { ids: new Set(Object.keys(this.meta)), progress: {} };
    this.controllers = new Map();
  }

  subscribe = (fn) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snapshot;

  emit() {
    this.snapshot = { ids: new Set(Object.keys(this.meta)), progress: { ...this.progress } };
    try {
      localStorage.setItem(META_KEY, JSON.stringify(this.meta));
    } catch {
      // quota exceeded for metadata; audio is still cached
    }
    this.listeners.forEach((fn) => fn());
  }

  has(id) {
    return id in this.meta;
  }

  tracks() {
    return Object.values(this.meta);
  }

  async save(track) {
    if (!offlineSupported || this.has(track.id) || track.id in this.progress) return;
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    const controller = new AbortController();
    this.controllers.set(track.id, controller);
    this.progress[track.id] = 0;
    this.emit();
    try {
      const token = await streamToken.get();
      const res = await fetch(`${API_BASE}/api/download/${track.id}?t=${encodeURIComponent(token)}`, {
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
      const total = Number(res.headers.get("Content-Length")) || track.size;
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      let lastEmit = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (Date.now() - lastEmit > 250) {
          this.progress[track.id] = received / total;
          this.emit();
          lastEmit = Date.now();
        }
      }
      const cache = await caches.open(CACHE);
      const blob = new Blob(chunks, { type: track.mime });
      await cache.put(audioKey(track.id), new Response(blob, { headers: { "Content-Type": track.mime } }));
      if (track.has_cover) {
        const cover = await fetch(coverUrl(track.id, token)).catch(() => null);
        if (cover?.ok) await cache.put(coverKey(track.id), cover);
      }
      this.meta[track.id] = track;
    } finally {
      delete this.progress[track.id];
      this.controllers.delete(track.id);
      this.emit();
    }
  }

  cancel(id) {
    this.controllers.get(id)?.abort();
  }

  async remove(id) {
    if (!offlineSupported) return;
    const cache = await caches.open(CACHE);
    await Promise.all([cache.delete(audioKey(id)), cache.delete(coverKey(id))]);
    delete this.meta[id];
    this.emit();
  }

  async clear() {
    if (offlineSupported) await caches.delete(CACHE);
    this.meta = {};
    this.emit();
  }

  async objectUrl(id, kind = "audio") {
    if (!offlineSupported || !this.has(id)) return null;
    const cache = await caches.open(CACHE);
    const res = await cache.match(kind === "audio" ? audioKey(id) : coverKey(id));
    return res ? URL.createObjectURL(await res.blob()) : null;
  }

  async usage() {
    const est = await navigator.storage?.estimate?.();
    const saved = this.tracks().reduce((n, t) => n + (t.size || 0), 0);
    return { saved, quota: est?.quota ?? null, used: est?.usage ?? null };
  }
}

export const offline = new OfflineStore();
