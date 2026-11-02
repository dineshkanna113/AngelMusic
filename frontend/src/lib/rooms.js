import { useSyncExternalStore } from "react";
import { api, accessToken, API_BASE } from "./api";
import { library } from "./library";
import { player } from "./player";
import { clockOffset, isHeartbeat, needsSeek, positionAt, roomSocketUrl } from "./roomsMath";

const HEARTBEAT_MS = 8000;
const MAX_CHAT = 100;
const REACTION_MS = 3500;
const BACKOFF = [1000, 2000, 4000, 8000, 15000];

const IDLE = { status: "idle", code: null, room: null, members: [], you: null, chat: [], reactions: [], error: "" };

/**
 * The one room this tab is in. It lives outside any screen so you keep listening together while
 * you browse. The host's player drives the room; a listener's player follows the host.
 */
class RoomSession {
  state = IDLE;
  listeners = new Set();
  ws = null;
  offset = 0; // server clock minus local clock, seconds
  applied = null; // the last host state applied here
  retry = 0;
  retryTimer = null;
  heartbeat = null;
  unsubscribePlayer = null;
  sent = null; // the last playback state the host sent
  wanted = false;
  reactionSeq = 0;

  subscribe = (fn) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.state;
  set(patch) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  get active() {
    return ["connecting", "open", "reconnecting"].includes(this.state.status);
  }

  async create(name) {
    const room = await api("/api/rooms", { method: "POST", body: { name } });
    await this.join(room.code);
    return room.code;
  }

  /** Join (or rejoin) a room by code. Leaves any other room first. */
  async join(code) {
    const upper = code.trim().toUpperCase();
    if (this.state.code === upper && this.active) return;
    this.leave();
    this.wanted = true;
    this.set({ ...IDLE, status: "connecting", code: upper });
    await this.connect();
  }

  async end() {
    const { code } = this.state;
    if (!code) return;
    await api(`/api/rooms/${code}`, { method: "DELETE" });
    this.leave();
  }

  leave() {
    this.wanted = false;
    clearTimeout(this.retryTimer);
    this.stopHosting();
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
    this.applied = null;
    this.set(IDLE);
  }

  async connect() {
    const code = this.state.code;
    const token = await accessToken();
    if (!this.wanted || this.state.code !== code || !token) return;
    const ws = new WebSocket(roomSocketUrl(API_BASE, code, window.location));
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token }));
    ws.onmessage = (e) => {
      try {
        this.handle(JSON.parse(e.data));
      } catch {
        // ignore a malformed frame
      }
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return; // an old socket
      this.ws = null;
      this.stopHosting();
      if (e.code === 4404) return this.set({ status: "gone", error: "That room has ended or never existed." });
      if (e.code === 4429) return this.set({ status: "full", error: "That room is full." });
      if (this.state.status === "ended" || !this.wanted) return;
      this.set({ status: "reconnecting" });
      this.retryTimer = setTimeout(() => this.connect(), BACKOFF[Math.min(this.retry++, BACKOFF.length - 1)]);
    };
  }

  handle(msg) {
    if (msg.server_time) this.offset = clockOffset(msg.server_time, Date.now());
    switch (msg.type) {
      case "state":
        this.retry = 0;
        this.set({ status: "open", room: msg.room, members: msg.members, you: msg.you, error: "" });
        if (msg.you.is_host) this.startHosting();
        else if (msg.room.track_id) this.applyRemote({ ...msg.room, server_time: msg.server_time });
        break;
      case "sync":
        this.set({ room: { ...this.state.room, track_id: msg.track_id, position: msg.position, playing: msg.playing } });
        this.applyRemote(msg);
        break;
      case "members":
        this.set({ members: msg.members });
        break;
      case "chat":
        this.set({ chat: [...this.state.chat, { id: `${msg.at}-${msg.from.username}`, from: msg.from, text: msg.text, at: msg.at }].slice(-MAX_CHAT) });
        break;
      case "react": {
        const id = ++this.reactionSeq;
        this.set({ reactions: [...this.state.reactions, { id, emoji: msg.emoji, from: msg.from, x: 10 + Math.random() * 80 }] });
        setTimeout(() => this.set({ reactions: this.state.reactions.filter((r) => r.id !== id) }), REACTION_MS);
        break;
      }
      case "ended":
        this.stopHosting();
        this.set({ status: "ended", error: "The host ended the room." });
        break;
      case "error":
        this.set({ error: msg.message });
        break;
      default:
    }
  }

  // ---- listener: follow the host -------------------------------------------------

  applyRemote(sync) {
    if (this.state.you?.is_host) return;
    const track = library.getSnapshot().byId.get(sync.track_id);
    if (!track) return this.set({ error: "The host is playing something that isn't in your library." });
    const heartbeat = isHeartbeat(this.applied, sync);
    this.applied = { track_id: sync.track_id, playing: sync.playing };
    const target = positionAt(sync, Date.now() / 1000 + this.offset);
    const s = player.getSnapshot();
    const current = s.queue[s.index];

    if (current?.id !== track.id) {
      player.originalQueue = null;
      player.set({ queue: [track] });
      player.load(0, { autoplay: sync.playing, startAt: target });
      return;
    }
    if (heartbeat) {
      // Only nudge someone who is actually listening; a listener who paused stays paused.
      if (s.playing && needsSeek(s.currentTime, target)) player.seek(target);
      return;
    }
    if (needsSeek(s.currentTime, target)) player.seek(target);
    if (sync.playing !== s.playing) player.togglePlay();
  }

  // ---- host: broadcast the player ------------------------------------------------

  startHosting() {
    this.stopHosting();
    this.sent = null;
    this.unsubscribePlayer = player.subscribe(() => this.hostTick(false));
    this.heartbeat = setInterval(() => this.hostTick(true), HEARTBEAT_MS);
    this.hostTick(true);
  }

  stopHosting() {
    this.unsubscribePlayer?.();
    this.unsubscribePlayer = null;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  hostTick(force) {
    const s = player.getSnapshot();
    const track = s.queue[s.index];
    if (!track || this.ws?.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    const last = this.sent;
    const expected = last ? (last.playing ? last.position + (now - last.at) / 1000 : last.position) : 0;
    const changed = !last || last.track_id !== track.id || last.playing !== s.playing || needsSeek(s.currentTime, expected);
    if (!changed && !(force && s.playing)) return;
    this.sent = { track_id: track.id, playing: s.playing, position: s.currentTime, at: now };
    this.ws.send(JSON.stringify({ type: "play", track_id: track.id, position: Math.max(0, s.currentTime), playing: s.playing }));
  }

  // ---- chat and reactions -------------------------------------------------------

  sendChat(text) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "chat", text }));
  }
  sendReaction(emoji) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "react", emoji }));
  }
}

export const roomSession = new RoomSession();
export const useRoom = () => useSyncExternalStore(roomSession.subscribe, roomSession.getSnapshot);
export const REACTIONS = ["🔥", "💖", "😮", "🎶", "👏", "🙌", "😂", "🥹"];
