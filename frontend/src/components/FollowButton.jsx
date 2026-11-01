import { useState } from "react";
import { toastError } from "../lib/toast";

/**
 * Follow / Following toggle for a person or an artist. Optimistic: it flips at once and
 * flips back if the server says no. `onToggle(on)` does the request.
 */
export default function FollowButton({ following, onToggle, label = "Follow", className = "", onChange }) {
  const [on, setOn] = useState(following);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    const next = !on;
    setOn(next);
    setBusy(true);
    try {
      await onToggle(next);
      onChange?.(next);
    } catch (err) {
      setOn(!next);
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" aria-pressed={on} disabled={busy} onClick={toggle}
      className={`${on ? "btn-secondary" : "btn-social"} ${className}`}>
      {on ? "Following" : label}
    </button>
  );
}
