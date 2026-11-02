import { useState } from "react";
import { Modal, mount } from "./Dialog";

const MAX = 1000;

function BioDialog({ name, initial, onDone }) {
  const [text, setText] = useState(initial);
  return (
    <Modal title={`${name}’s bio`} onClose={() => onDone(null)} wide>
      <form onSubmit={(e) => { e.preventDefault(); onDone(text.trim()); }} className="grid gap-4">
        <label className="grid gap-1.5">
          <span className="text-sm text-fg-2">Shown on the artist’s page <span className="text-muted">({MAX - text.length} left)</span></span>
          <textarea className="input h-40 resize-none rounded-md py-3" maxLength={MAX} value={text} autoFocus
            onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => onDone(null)}>Cancel</button>
          <button className="btn-primary">Save bio</button>
        </div>
      </form>
    </Modal>
  );
}

/** Resolves to the new bio (empty clears it), or null when cancelled. */
export const editBio = (name, initial = "") => mount((done) => <BioDialog name={name} initial={initial} onDone={done} />);
