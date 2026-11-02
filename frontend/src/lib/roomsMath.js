// Pure helpers for Rooms: where a listener should be, and when to correct them.

export const DRIFT_SECONDS = 1.5;

/** Where the host is now, from the last state the server stamped (times in seconds, server clock). */
export function positionAt(sync, serverNow) {
  if (!sync.playing) return sync.position;
  return sync.position + Math.max(0, serverNow - sync.server_time);
}

/** Server clock minus local clock, in seconds, from one frame's server_time and the local arrival time (ms). */
export const clockOffset = (serverTime, localMs) => serverTime - localMs / 1000;

/** Seek only when the listener is further off than the tolerance; small drift is left alone. */
export const needsSeek = (current, target, tolerance = DRIFT_SECONDS) => Math.abs(current - target) > tolerance;

/** A sync that repeats what was already applied is the host's heartbeat, not a new action. */
export const isHeartbeat = (applied, sync) =>
  !!applied && applied.track_id === sync.track_id && applied.playing === sync.playing;

/** WebSocket URL for a room: the API base if there is one, else the page's own origin. */
export function roomSocketUrl(apiBase, code, location) {
  const base = apiBase || `${location.protocol}//${location.host}`;
  return `${base.replace(/^http/, "ws")}/api/rooms/${code.toUpperCase()}/ws`;
}
