import { useState } from "react";
import { Modal, mount } from "./Dialog";
import { growth } from "../lib/growth";
import { toast, toastError } from "../lib/toast";

function AccessDialog({ artist, onDone }) {
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = async (on) => {
    setBusy(true);
    try {
      await growth.grant(artist.id, username.trim(), on);
      toast(on ? `${username.trim()} can now manage ${artist.name}` : `Access removed for ${username.trim()}`);
      setUsername("");
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Who manages ${artist.name}?`} onClose={() => onDone(null)}>
      <form onSubmit={(e) => { e.preventDefault(); apply(true); }} className="grid gap-4">
        <label className="grid gap-1.5">
          <span className="text-sm text-fg-2">Username</span>
          <input className="input" autoFocus autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
          <span className="text-xs text-muted">They can edit the bio, see stats, and announce drops for this artist.</span>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => onDone(null)}>Close</button>
          <button type="button" className="btn-secondary" disabled={busy || !username.trim()} onClick={() => apply(false)}>Remove access</button>
          <button className="btn-primary" disabled={busy || !username.trim()}>Give access</button>
        </div>
      </form>
    </Modal>
  );
}

export const manageAccess = (artist) => mount((done) => <AccessDialog artist={artist} onDone={done} />);
