import { useSyncExternalStore } from "react";

let toasts = [];
let nextId = 1;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export function toast(message, { tone = "info", timeout = 3500 } = {}) {
  const id = nextId++;
  toasts = [...toasts, { id, message, tone }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, timeout);
}

export const toastError = (err) => toast(err?.message || String(err), { tone: "error", timeout: 5000 });

export const useToasts = () =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => toasts,
  );
