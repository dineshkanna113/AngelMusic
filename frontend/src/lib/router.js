import { useSyncExternalStore } from "react";

// Hash routing: works when served from any path and needs no server rewrites.
const subscribe = (fn) => {
  window.addEventListener("hashchange", fn);
  return () => window.removeEventListener("hashchange", fn);
};
const getHash = () => window.location.hash.replace(/^#/, "") || "/";

export function useRoute() {
  const path = useSyncExternalStore(subscribe, getHash);
  // "#/premium?checkout=success": the query belongs to the page, not to the route.
  const [route, query = ""] = path.split("?");
  const [, section = "", ...rest] = route.split("/");
  return { path, section, params: rest.map(decodeURIComponent), query: new URLSearchParams(query) };
}

export const href = (...parts) => `#/${parts.map((p) => encodeURIComponent(p)).join("/")}`;

export function navigate(...parts) {
  window.location.hash = href(...parts).slice(1);
}
