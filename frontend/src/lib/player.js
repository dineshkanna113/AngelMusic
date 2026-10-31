import { coverUrl, streamToken, streamUrl } from "./api";
import { offline } from "./offline";

const PREFS_KEY = "ls.player";
const RESUME_KEY = "ls.resume";
const MAX_RETRIES = 6;
const STALL_TIMEOUT_MS = 10_000;
// Start fetching the next track once the current one is fully buffered, or when this
// close to the end, so preloading never competes with the track that's playing.
const PRELOAD_REMAINING_S = 30;
// Count a play once half the track (or 4 minutes) has been heard, like Last.fm.
const SCROBBLE_AFTER_S = 240;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readJSON(key, fallback) {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key)) };
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable; preferences just won't persist
  }
}

function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Device output rate as the browser's audio graph sees it (what the source gets resampled to). */
export function outputSampleRate() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const rate = ctx.sampleRate;
    ctx.close();
    return rate;
  } catch {
    return null;
  }
}

/**
 * Two-deck player. One <audio> element plays while the other silently preloads the next
 * track, so track changes start from a warm buffer instead of a fresh network request.
 * Every network failure is retried from the exact position with a fresh stream token.
 */
export class PlayerEngine {
  constructor() {
    this.decks = [new Audio(), new Audio()];
    this.deckTrack = [null, null];
    this.active = 0;
    this.listeners = new Set();
    this.intent = false; // user wants audio playing
    this.retries = 0;
    this.loadSeq = 0;
    this.stallTimer = null;
    this.awaitingOnline = false;
    this.originalQueue = null;
    this.lastResumeSave = 0;
    this.position = 0; // last known-good playback position, used to resume after errors
    this.objectUrls = [null, null]; // blob URLs of offline tracks loaded in each deck
    this.scrobbled = false;
    this.sleepTimer = null;
    this.onPlayed = null; // (trackId) => void, set by the app to record listening history

    const prefs = readJSON(PREFS_KEY, { volume: 1, muted: false, replayGain: "off", repeat: "off", outputDevice: "" });
    this.state = {
      queue: [],
      index: -1,
      playing: false,
      buffering: false,
      currentTime: 0,
      duration: 0,
      buffered: [],
      bufferedAhead: 0,
      nextReady: false,
      error: null,
      shuffle: false,
      volume: clamp(Number(prefs.volume) || 0, 0, 1),
      muted: !!prefs.muted,
      replayGain: ["off", "track", "album"].includes(prefs.replayGain) ? prefs.replayGain : "off",
      repeat: ["off", "all", "one"].includes(prefs.repeat) ? prefs.repeat : "off",
      outputDevice: prefs.outputDevice || "",
      sleep: null, // { mode: "time", at: epochMs } | { mode: "track" }
    };

    const events = ["play", "pause", "playing", "waiting", "stalled", "timeupdate", "progress",
      "durationchange", "ended", "error", "canplaythrough", "seeked"];
    this.decks.forEach((deck, i) => {
      deck.preload = "auto";
      events.forEach((type) => deck.addEventListener(type, () => this.onDeckEvent(i, type)));
    });

    window.addEventListener("online", () => {
      if (this.awaitingOnline) {
        this.awaitingOnline = false;
        this.retries = 0;
        this.recover();
      }
    });
    window.addEventListener("pagehide", () => this.saveResume(true));
    this.applyVolume();
    this.setupMediaSession();
    if (this.state.outputDevice) this.setOutputDevice(this.state.outputDevice, { quiet: true });
  }

  // ---- store API (useSyncExternalStore) -------------------------------------------

  subscribe = (fn) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.state;

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  get audio() {
    return this.decks[this.active];
  }

  get standby() {
    return this.decks[1 - this.active];
  }

  get track() {
    return this.state.queue[this.state.index] ?? null;
  }

  // ---- public controls ------------------------------------------------------------

  playQueue(tracks, startIndex = 0) {
    let queue = tracks;
    let index = startIndex;
    this.originalQueue = null;
    if (this.state.shuffle) {
      this.originalQueue = tracks;
      const first = tracks[startIndex];
      queue = [first, ...shuffled(tracks.filter((_, i) => i !== startIndex))];
      index = 0;
    }
    this.set({ queue });
    this.load(index, { autoplay: true });
  }

  /** Insert tracks right after the current one. */
  playNext(tracks) {
    if (!this.track) return this.playQueue(tracks, 0);
    const { queue, index } = this.state;
    this.originalQueue = null;
    this.set({ queue: [...queue.slice(0, index + 1), ...tracks, ...queue.slice(index + 1)] });
    this.invalidateStandby();
  }

  addToQueue(tracks) {
    if (!this.track) return this.playQueue(tracks, 0);
    this.originalQueue &&= [...this.originalQueue, ...tracks];
    this.set({ queue: [...this.state.queue, ...tracks] });
    this.invalidateStandby();
  }

  removeFromQueue(i) {
    const { queue, index } = this.state;
    if (i === index || i < 0 || i >= queue.length) return;
    this.originalQueue = null;
    this.set({ queue: queue.filter((_, n) => n !== i), index: i < index ? index - 1 : index });
    this.invalidateStandby();
  }

  moveInQueue(from, to) {
    const { queue, index } = this.state;
    if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return;
    const next = [...queue];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    let newIndex = index;
    if (from === index) newIndex = to;
    else if (from < index && to >= index) newIndex = index - 1;
    else if (from > index && to <= index) newIndex = index + 1;
    this.originalQueue = null;
    this.set({ queue: next, index: newIndex });
    this.invalidateStandby();
  }

  clearUpcoming() {
    const { queue, index } = this.state;
    this.originalQueue = null;
    this.set({ queue: queue.slice(0, index + 1) });
    this.invalidateStandby();
  }

  jumpTo(i) {
    if (i >= 0 && i < this.state.queue.length) this.load(i, { autoplay: true });
  }

  /** minutes: number, "track" (stop after the current track) or null to cancel. */
  setSleepTimer(minutes) {
    clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    if (minutes === null) return this.set({ sleep: null });
    if (minutes === "track") return this.set({ sleep: { mode: "track" } });
    const at = Date.now() + minutes * 60_000;
    this.sleepTimer = setTimeout(() => this.sleepNow(), minutes * 60_000);
    this.set({ sleep: { mode: "time", at } });
  }

  sleepNow() {
    clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    this.intent = false;
    this.audio.pause();
    this.set({ sleep: null });
  }

  /** Route audio to a specific output device (Chrome/Edge/Firefox; not Safari). */
  async setOutputDevice(deviceId, { quiet = false } = {}) {
    if (typeof this.audio.setSinkId !== "function") {
      if (!quiet) throw new Error("This browser can't choose an output device.");
      return;
    }
    try {
      await Promise.all(this.decks.map((d) => d.setSinkId(deviceId)));
      this.set({ outputDevice: deviceId });
      this.savePrefs();
    } catch (err) {
      if (!quiet) throw err;
    }
  }

  togglePlay() {
    if (!this.track) return;
    if (this.audio.paused || this.state.error) {
      this.intent = true;
      if (this.state.error || !this.audio.src) this.recover({ immediate: true });
      else this.safePlay();
    } else {
      this.intent = false;
      this.audio.pause();
    }
  }

  next() {
    const i = this.nextIndex({ manual: true });
    if (i !== null) this.load(i, { autoplay: true });
  }

  previous() {
    if (this.audio.currentTime > 3 || this.state.index <= 0) {
      this.seek(0);
    } else {
      this.load(this.state.index - 1, { autoplay: true });
    }
  }

  seek(time) {
    if (!this.track) return;
    const t = clamp(time, 0, this.state.duration || this.track.duration || 0);
    this.audio.currentTime = t;
    this.position = t;
    this.set({ currentTime: t });
    this.updatePositionState();
  }

  setVolume(volume) {
    this.set({ volume: clamp(volume, 0, 1), muted: volume === 0 ? this.state.muted : false });
    this.applyVolume();
    this.savePrefs();
  }

  toggleMute() {
    this.set({ muted: !this.state.muted });
    this.applyVolume();
    this.savePrefs();
  }

  setReplayGain(mode) {
    this.set({ replayGain: mode });
    this.applyVolume();
    this.savePrefs();
  }

  cycleRepeat() {
    const order = ["off", "all", "one"];
    this.set({ repeat: order[(order.indexOf(this.state.repeat) + 1) % order.length] });
    this.savePrefs();
    this.invalidateStandby();
  }

  toggleShuffle() {
    const { queue, index, shuffle } = this.state;
    const current = queue[index];
    if (!shuffle) {
      this.originalQueue = queue;
      const rest = shuffled(queue.filter((_, i) => i !== index));
      this.set({ shuffle: true, queue: current ? [current, ...rest] : rest, index: current ? 0 : -1 });
    } else {
      const original = this.originalQueue ?? queue;
      this.originalQueue = null;
      this.set({ shuffle: false, queue: original, index: current ? original.indexOf(current) : -1 });
    }
    this.invalidateStandby();
  }

  /** Restore last session's queue and position, paused. */
  restore(tracks) {
    if (this.track) return;
    const saved = readJSON(RESUME_KEY, null);
    if (!saved?.ids?.length) return;
    const byId = new Map(tracks.map((t) => [t.id, t]));
    const queue = saved.ids.map((id) => byId.get(id)).filter(Boolean);
    const current = byId.get(saved.ids[saved.index]);
    const index = current ? queue.indexOf(current) : -1;
    if (index < 0) return;
    this.set({ queue });
    this.load(index, { autoplay: false, startAt: saved.position || 0 });
  }

  reset() {
    this.intent = false;
    this.loadSeq++;
    this.setSleepTimer(null);
    this.decks.forEach((d, i) => this.unload(i));
    this.set({ queue: [], index: -1, playing: false, buffering: false, currentTime: 0, duration: 0, buffered: [],
      bufferedAhead: 0, error: null, nextReady: false });
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
  }

  // ---- loading --------------------------------------------------------------------

  async load(index, { autoplay = true, startAt = 0, reload = false } = {}) {
    const track = this.state.queue[index];
    if (!track) return;
    const seq = ++this.loadSeq;
    this.intent = autoplay;
    this.clearStallTimer();
    if (!reload) this.retries = 0;
    this.position = startAt;
    this.scrobbled = false;
    this.set({
      index, error: null, currentTime: startAt, duration: track.duration, buffered: [], bufferedAhead: 0,
      nextReady: false, buffering: autoplay,
    });

    const standbyIdx = 1 - this.active;
    if (!reload && this.deckTrack[standbyIdx] === track.id && !this.standby.error) {
      // Warm handoff: the next track is already buffered in the standby deck.
      const previous = this.active;
      this.active = standbyIdx;
      this.unload(previous);
      if (this.audio.currentTime !== startAt) this.audio.currentTime = startAt;
    } else {
      this.audio.pause();
      let src;
      try {
        src = await this.sourceFor(track);
      } catch {
        if (seq === this.loadSeq) this.recover();
        return;
      }
      if (seq !== this.loadSeq) return; // superseded by a newer load
      this.setDeckSource(this.active, track.id, src);
      if (startAt) this.audio.currentTime = startAt; // honoured as the initial position
    }

    this.applyVolume();
    this.updateMediaSession();
    this.saveResume(true);
    if (autoplay) this.safePlay();
    else this.set({ buffering: false });
  }

  /** Saved-offline tracks play from local storage; everything else streams. */
  async sourceFor(track) {
    const local = await offline.objectUrl(track.id).catch(() => null);
    if (local) return local;
    return streamUrl(track.id, streamToken.peek() ?? (await streamToken.get()));
  }

  setDeckSource(deckIdx, trackId, src) {
    this.revokeObjectUrl(deckIdx);
    if (src.startsWith("blob:")) this.objectUrls[deckIdx] = src;
    this.deckTrack[deckIdx] = trackId;
    this.decks[deckIdx].src = src;
  }

  revokeObjectUrl(deckIdx) {
    if (this.objectUrls[deckIdx]) URL.revokeObjectURL(this.objectUrls[deckIdx]);
    this.objectUrls[deckIdx] = null;
  }

  unload(deckIdx) {
    const deck = this.decks[deckIdx];
    deck.pause();
    deck.removeAttribute("src");
    deck.load(); // aborts any in-flight download and frees the buffer
    this.deckTrack[deckIdx] = null;
    this.revokeObjectUrl(deckIdx);
  }

  invalidateStandby() {
    const nextIdx = this.nextIndex();
    const next = nextIdx === null ? null : this.state.queue[nextIdx];
    if (this.deckTrack[1 - this.active] && this.deckTrack[1 - this.active] !== next?.id) {
      this.unload(1 - this.active);
      this.set({ nextReady: false });
    }
  }

  safePlay() {
    this.audio.play().catch((err) => {
      if (err.name === "NotAllowedError") {
        // Autoplay blocked (e.g. restored session); wait for a user gesture.
        this.intent = false;
        this.set({ playing: false, buffering: false });
      }
      // AbortError: a newer load replaced this one; nothing to do.
    });
  }

  nextIndex({ manual = false } = {}) {
    const { index, queue, repeat } = this.state;
    if (!queue.length) return null;
    if (repeat === "one" && !manual) return index;
    if (index + 1 < queue.length) return index + 1;
    return repeat === "off" ? null : 0;
  }

  async preloadNext() {
    const nextIdx = this.nextIndex();
    if (nextIdx === null || nextIdx === this.state.index) return;
    const next = this.state.queue[nextIdx];
    const standbyIdx = 1 - this.active;
    if (this.deckTrack[standbyIdx] === next.id) return;
    this.deckTrack[standbyIdx] = next.id;
    try {
      const src = await this.sourceFor(next);
      if (this.deckTrack[standbyIdx] !== next.id) {
        if (src.startsWith("blob:")) URL.revokeObjectURL(src);
        return;
      }
      this.setDeckSource(standbyIdx, next.id, src);
      this.decks[standbyIdx].load();
      this.applyVolume();
    } catch {
      this.deckTrack[standbyIdx] = null;
    }
  }

  // ---- events ---------------------------------------------------------------------

  onDeckEvent(deckIdx, type) {
    if (deckIdx !== this.active) {
      if (type === "canplaythrough") this.set({ nextReady: true });
      if (type === "error") {
        this.deckTrack[deckIdx] = null;
        this.set({ nextReady: false });
      }
      return;
    }
    const a = this.audio;
    switch (type) {
      case "play":
        this.set({ playing: true });
        break;
      case "playing":
        this.retries = 0;
        this.clearStallTimer();
        this.set({ playing: true, buffering: false, error: null });
        this.updatePositionState();
        break;
      case "pause":
        if (!a.ended) this.set({ playing: false, buffering: false });
        this.clearStallTimer();
        this.saveResume(true);
        break;
      case "waiting":
      case "stalled":
        if (this.intent) {
          this.set({ buffering: true });
          this.armStallTimer();
        }
        break;
      case "progress":
        if (this.stallTimer) this.armStallTimer(); // data is still arriving
        this.updateBuffered();
        break;
      case "timeupdate":
        // A deck that lost its media (error, src swap) reports 0; don't let that clobber the
        // position we need for resuming.
        if (a.readyState < HTMLMediaElement.HAVE_METADATA || a.error) break;
        this.position = a.currentTime;
        this.set({ currentTime: a.currentTime });
        this.maybeScrobble();
        this.updateBuffered();
        this.saveResume();
        break;
      case "seeked":
        this.updateBuffered();
        break;
      case "durationchange":
        if (Number.isFinite(a.duration)) this.set({ duration: a.duration });
        this.updatePositionState();
        break;
      case "ended":
        this.onEnded();
        break;
      case "error":
        this.recover();
        break;
      default:
    }
  }

  maybeScrobble() {
    const duration = this.state.duration || this.track?.duration || 0;
    if (this.scrobbled || !duration || this.position < Math.min(duration / 2, SCROBBLE_AFTER_S)) return;
    this.scrobbled = true;
    this.onPlayed?.(this.track.id);
  }

  onEnded() {
    if (this.state.sleep?.mode === "track") {
      this.sleepNow();
      this.set({ playing: false });
      return;
    }
    const i = this.nextIndex();
    if (i === null) {
      this.intent = false;
      this.set({ playing: false, currentTime: 0 });
      this.audio.currentTime = 0;
      return;
    }
    if (i === this.state.index) {
      this.audio.currentTime = 0;
      this.safePlay();
      return;
    }
    this.load(i, { autoplay: true });
  }

  updateBuffered() {
    const a = this.audio;
    const ranges = [];
    let ahead = 0;
    for (let i = 0; i < a.buffered.length; i++) {
      const start = a.buffered.start(i);
      const end = a.buffered.end(i);
      ranges.push([start, end]);
      if (a.currentTime >= start - 0.5 && a.currentTime <= end) ahead = end - a.currentTime;
    }
    this.set({ buffered: ranges, bufferedAhead: ahead });

    const duration = this.state.duration || this.track?.duration || 0;
    const fullyBuffered = ranges.some(([s, e]) => s <= 1 && e >= duration - 1);
    if (this.intent && duration && (fullyBuffered || duration - a.currentTime < PRELOAD_REMAINING_S)) {
      this.preloadNext();
    }
  }

  armStallTimer() {
    this.clearStallTimer();
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null;
      if (this.intent && this.state.buffering) this.recover();
    }, STALL_TIMEOUT_MS);
  }

  clearStallTimer() {
    clearTimeout(this.stallTimer);
    this.stallTimer = null;
  }

  /** Reload the current track at the current position after an error or stall. */
  async recover({ immediate = false } = {}) {
    const track = this.track;
    if (!track) return;
    const a = this.audio;
    const code = a.error?.code;
    if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED && a.canPlayType(track.mime) === "") {
      this.intent = false;
      this.set({ playing: false, buffering: false, error: `This browser can't decode ${track.codec.toUpperCase()} files.` });
      return;
    }
    if (this.retries >= MAX_RETRIES) {
      this.intent = false;
      this.set({ playing: false, buffering: false, error: "Playback failed repeatedly. Press play to try again." });
      this.retries = 0;
      return;
    }
    const resumeAt = this.position;
    const autoplay = this.intent;
    const seq = this.loadSeq;
    this.retries++;
    this.set({ buffering: autoplay, error: null });

    if (!immediate) await sleep(Math.min(500 * 2 ** (this.retries - 1), 8000));
    if (seq !== this.loadSeq) return;
    if (!navigator.onLine) {
      this.awaitingOnline = true;
      this.set({ buffering: false, error: "You're offline. Playback resumes when the connection returns." });
      return;
    }
    try {
      // A 401 from an expired stream token surfaces as a media error, so always refresh.
      await streamToken.get({ force: true });
    } catch {
      if (seq === this.loadSeq) this.recover();
      return;
    }
    if (seq !== this.loadSeq) return;
    this.load(this.state.index, { autoplay, startAt: resumeAt, reload: true });
  }

  // ---- volume / ReplayGain --------------------------------------------------------

  gainFactor(trackId) {
    const { replayGain } = this.state;
    if (replayGain === "off" || !trackId) return 1;
    const t = this.state.queue.find((q) => q.id === trackId);
    if (!t) return 1;
    const [gain, peak] = replayGain === "album"
      ? [t.rg_album_gain ?? t.rg_track_gain, t.rg_album_peak ?? t.rg_track_peak]
      : [t.rg_track_gain ?? t.rg_album_gain, t.rg_track_peak ?? t.rg_album_peak];
    if (gain == null) return 1;
    let factor = 10 ** (gain / 20);
    if (peak) factor = Math.min(factor, 1 / peak); // never clip
    return factor;
  }

  applyVolume() {
    const { volume, muted } = this.state;
    this.decks.forEach((deck, i) => {
      deck.muted = muted;
      deck.volume = clamp(volume * this.gainFactor(this.deckTrack[i]), 0, 1);
    });
  }

  // ---- persistence ----------------------------------------------------------------

  savePrefs() {
    const { volume, muted, replayGain, repeat, outputDevice } = this.state;
    writeJSON(PREFS_KEY, { volume, muted, replayGain, repeat, outputDevice });
  }

  saveResume(force = false) {
    const now = Date.now();
    if (!force && now - this.lastResumeSave < 5000) return;
    this.lastResumeSave = now;
    const { queue, index } = this.state;
    if (index < 0) return;
    writeJSON(RESUME_KEY, { ids: queue.map((t) => t.id), index, position: this.position });
  }

  // ---- OS media controls (lock screen, keyboard media keys, headsets) ---------------

  setupMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const handlers = {
      play: () => this.togglePlay(),
      pause: () => this.togglePlay(),
      previoustrack: () => this.previous(),
      nexttrack: () => this.next(),
      seekbackward: (d) => this.seek(this.audio.currentTime - (d.seekOffset || 10)),
      seekforward: (d) => this.seek(this.audio.currentTime + (d.seekOffset || 10)),
      seekto: (d) => this.seek(d.seekTime),
    };
    for (const [action, fn] of Object.entries(handlers)) {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        // action not supported by this browser
      }
    }
  }

  updateMediaSession() {
    const t = this.track;
    if (!("mediaSession" in navigator) || !t) return;
    const token = streamToken.peek();
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist,
      album: t.album,
      artwork: t.has_cover && token ? [{ src: coverUrl(t.id, token), sizes: "512x512" }] : [],
    });
  }

  updatePositionState() {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
    const duration = this.state.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        position: clamp(this.audio.currentTime, 0, duration),
        playbackRate: 1,
      });
    } catch {
      // ignore invalid transient states
    }
  }
}

export const player = new PlayerEngine();
