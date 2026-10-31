import { useSyncExternalStore } from "react";

// Which side panel is open next to the content: null | "queue" | "lyrics".
let panel = null;
const listeners = new Set();

export const ui = {
  togglePanel(name) {
    panel = panel === name ? null : name;
    listeners.forEach((fn) => fn());
  },
  closePanel() {
    panel = null;
    listeners.forEach((fn) => fn());
  },
};

export const usePanel = () =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => panel,
  );
