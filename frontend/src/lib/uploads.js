import { useSyncExternalStore } from "react";
import { accessToken, api, API_BASE, ApiError } from "./api";

// Resumable uploads: each file is sent in chunks with an Upload-Offset header. If a chunk
// fails (network drop, laptop sleep, server restart) the client asks the server how much it
// has and carries on from there, so a 2 GB master never restarts from zero.

export const AUDIO_EXTENSIONS = [".flac", ".wav", ".aif", ".aiff", ".m4a", ".mp3", ".ogg", ".opus"];
const CONCURRENCY = 2;
const MAX_ATTEMPTS = 8;

export const isAudioFile = (name) => AUDIO_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForOnline() {
  if (navigator.onLine !== false) return Promise.resolve();
  return new Promise((resolve) => window.addEventListener("online", resolve, { once: true }));
}

async function putChunk(id, offset, blob, signal) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/uploads/${id}/content`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${await accessToken()}`, "Upload-Offset": String(offset) },
      body: blob,
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiError(0, "Connection lost");
  }
  const data = await res.json().catch(() => null);
  if (res.status === 409 && typeof data?.received === "number") return { received: data.received, resync: true };
  if (!res.ok) throw new ApiError(res.status, data?.detail || `Upload failed (${res.status})`);
  return data;
}

// Network trouble and server hiccups are retried; a 4xx means the file itself is the problem.
const retryable = (err) => err instanceof ApiError && (err.status === 0 || err.status === 409 || err.status >= 500);

let seq = 0;

class UploadManager {
  constructor() {
    this.items = [];
    this.listeners = new Set();
    this.onFinished = null; // set by views to refresh the submission list
    window.addEventListener("beforeunload", (e) => {
      if (this.active()) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  subscribe = (fn) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.items;

  active() {
    return this.items.some((i) => i.state === "queued" || i.state === "uploading" || i.state === "retrying");
  }

  update(key, patch) {
    this.items = this.items.map((i) => (i.key === key ? { ...i, ...patch } : i));
    this.listeners.forEach((fn) => fn());
  }

  add(files, { publish = false } = {}) {
    const fresh = [...files].map((file) => ({
      key: ++seq, file, name: file.webkitRelativePath || file.name, size: file.size,
      id: null, received: 0, state: "queued", error: "", publish, controller: null,
    }));
    this.items = [...this.items, ...fresh];
    this.listeners.forEach((fn) => fn());
    this.pump();
  }

  pump() {
    const running = this.items.filter((i) => i.state === "uploading" || i.state === "retrying").length;
    const next = this.items.filter((i) => i.state === "queued").slice(0, CONCURRENCY - running);
    next.forEach((item) => this.run(item.key));
  }

  get(key) {
    return this.items.find((i) => i.key === key);
  }

  async run(key) {
    const controller = new AbortController();
    this.update(key, { state: "uploading", error: "", controller });
    let attempt = 0;
    try {
      let item = this.get(key);
      if (!item.id) {
        const created = await api("/api/uploads", {
          method: "POST", body: { filename: item.file.name, size: item.size, publish: item.publish }, signal: controller.signal,
        });
        this.update(key, { id: created.id, chunk: created.chunk_size });
      }
      for (;;) {
        item = this.get(key);
        if (item.received >= item.size) break;
        try {
          const end = Math.min(item.size, item.received + item.chunk);
          const res = await putChunk(item.id, item.received, item.file.slice(item.received, end), controller.signal);
          this.update(key, { received: res.received, state: "uploading" });
          if (!res.resync) attempt = 0;
        } catch (err) {
          if (err.name === "AbortError" || !retryable(err) || ++attempt >= MAX_ATTEMPTS) throw err;
          this.update(key, { state: "retrying", error: err.message });
          await waitForOnline();
          await sleep(Math.min(30_000, 1000 * 2 ** attempt));
          // Ask the server where it got to; the last chunk may or may not have landed.
          const status = await api(`/api/uploads/${item.id}`).catch(() => null);
          if (status) this.update(key, { received: status.received });
          if (status && status.status !== "uploading") break;
        }
      }
      this.update(key, { state: "done", received: this.get(key).size, controller: null });
      this.onFinished?.();
    } catch (err) {
      if (err.name !== "AbortError") this.update(key, { state: "failed", error: err.message, controller: null });
    } finally {
      this.pump();
    }
  }

  retry(key) {
    this.update(key, { state: "queued", error: "" });
    this.pump();
  }

  async cancel(key) {
    const item = this.get(key);
    if (!item) return;
    item.controller?.abort();
    this.update(key, { state: "canceled", controller: null });
    if (item.id && item.state !== "done") await api(`/api/uploads/${item.id}`, { method: "DELETE" }).catch(() => {});
    this.pump();
  }

  clearFinished() {
    this.items = this.items.filter((i) => !["done", "canceled"].includes(i.state));
    this.listeners.forEach((fn) => fn());
  }
}

export const uploads = new UploadManager();
export const useTransfers = () => useSyncExternalStore(uploads.subscribe, uploads.getSnapshot);

/** Expand dropped folders (DataTransferItemList) into audio files, recursively. */
export async function filesFromDrop(dataTransfer) {
  const entries = [...(dataTransfer.items ?? [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dataTransfer.files];
  const out = [];
  const walk = async (entry) => {
    if (entry.isFile) {
      out.push(await new Promise((res, rej) => entry.file(res, rej)));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries returns results in batches; keep reading until it's empty.
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const child of batch) await walk(child);
      }
    }
  };
  for (const entry of entries) await walk(entry);
  return out;
}

export const uploadAudioUrl = (id, token) => `${API_BASE}/api/uploads/${id}/audio?t=${encodeURIComponent(token)}`;
export const uploadCoverUrl = (id, token) => `${API_BASE}/api/uploads/${id}/cover?t=${encodeURIComponent(token)}`;

export const STATUS_LABELS = {
  uploading: "Uploading", processing: "Checking", invalid: "Needs attention", pending: "In review",
  scheduled: "Scheduled", published: "Live", declined: "Declined", removed: "Taken down",
};
