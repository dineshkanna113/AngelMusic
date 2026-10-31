import { useEffect, useSyncExternalStore } from "react";
import { auth, streamToken } from "./api";
import { player } from "./player";

/** Full player state; re-renders on every timeupdate, so use only in the player UI. */
export const usePlayer = () => useSyncExternalStore(player.subscribe, player.getSnapshot);

/** Subscribe to one derived primitive so big lists don't re-render 4x a second. */
export const usePlayerSelect = (select) =>
  useSyncExternalStore(player.subscribe, () => select(player.getSnapshot()));

export const useSession = () => useSyncExternalStore(auth.subscribe, () => auth.session);

// One shared stream token for every cover <img> on the page.
let tokenValue = streamToken.peek();
const tokenListeners = new Set();

function refreshToken() {
  streamToken
    .get()
    .then((t) => {
      if (t !== tokenValue) {
        tokenValue = t;
        tokenListeners.forEach((fn) => fn());
      }
    })
    .catch(() => {});
}

export const useStreamTokenValue = () =>
  useSyncExternalStore(
    (fn) => {
      tokenListeners.add(fn);
      return () => tokenListeners.delete(fn);
    },
    () => tokenValue,
  );

/** Mount once (in the signed-in shell) to keep the stream token fresh. */
export function useStreamTokenRefresh() {
  useEffect(() => {
    refreshToken();
    const id = setInterval(refreshToken, 15 * 60_000);
    window.addEventListener("online", refreshToken);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", refreshToken);
    };
  }, []);
}
