import { Modal, mount } from "./Dialog";
import { Artifact } from "./Stickers";
import { navigate } from "../lib/router";

function UpgradeDialog({ reason, onDone }) {
  return (
    <Modal title="That’s a Premium feature" onClose={() => onDone(false)}>
      <div className="grid gap-4">
        <Artifact kind="headphones" size={72} tilt={-8} className="mx-auto" />
        <p className="text-sm text-fg-2">{reason}</p>
        <p className="text-sm text-muted">Listening in full lossless quality stays free for everyone.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => onDone(false)}>Not now</button>
          <button type="button" className="btn-primary" onClick={() => { onDone(true); navigate("premium"); }}>See Premium</button>
        </div>
      </div>
    </Modal>
  );
}

/** Explains what Premium adds and offers the plans page. Resolves true if the person went to see it. */
export const showUpgrade = (reason = "Saving music for offline listening is part of Premium.") =>
  mount((done) => <UpgradeDialog reason={reason} onDone={done} />);
