import { api } from "./api";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "25 min", "1 h", "2 h 5 min": listening time for people, from seconds. */
export function formatListening(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** [value, label] choices for the Rewind switcher, in UTC like the server. */
export function rewindPeriods(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const prevY = m === 0 ? y - 1 : y;
  const prevM = m === 0 ? 11 : m - 1;
  return [
    ["month", "This month"],
    [`${prevY}-${String(prevM + 1).padStart(2, "0")}`, `${MONTHS[prevM]} ${prevY}`],
    ["year", "This year"],
    [String(y - 1), String(y - 1)],
  ];
}

export const live = {
  rewind: (period) => api(`/api/rewind?period=${encodeURIComponent(period)}`),
  blend: (username) => api("/api/blends", { method: "POST", body: { username } }),
};
