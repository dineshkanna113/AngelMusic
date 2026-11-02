import { useSyncExternalStore } from "react";
import { social } from "./social";

// One shared poll of friend activity, however many components show it (rail, Home, Friends page).
// It runs only while something is subscribed and the tab is visible.
const POLL_MS = 20_000;
const listeners = new Set();
let friends = null;
let timer = null;

function load() {
  if (document.visibilityState !== "visible") return;
  social.activity().then((next) => {
    friends = next;
    listeners.forEach((fn) => fn());
  }).catch(() => {});
}

const onVisible = () => load();

function subscribe(fn) {
  listeners.add(fn);
  if (listeners.size === 1) {
    load();
    timer = setInterval(load, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size) {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      friends = null; // don't show the last account's friends to the next one
    }
  };
}

/** Friends' listening: null until the first load, then the /api/activity list. */
export const useActivity = () => useSyncExternalStore(subscribe, () => friends);
