import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

export function Modal({ title, children, onClose, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={(e) => e.stopPropagation()}
        className={`w-full ${wide ? "max-w-lg" : "max-w-sm"} max-h-[90dvh] overflow-y-auto rounded-xl border border-line bg-surface-1 p-5 shadow-2xl`}
      >
        <h2 className="mb-3 text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function PromptDialog({ title, label, initial = "", confirmLabel = "Save", onDone }) {
  const [value, setValue] = useState(initial);
  const input = useRef(null);
  useEffect(() => input.current?.select(), []);
  return (
    <Modal title={title} onClose={() => onDone(null)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onDone(value.trim());
        }}
        className="space-y-4"
      >
        <label className="block space-y-1.5">
          <span className="text-xs text-muted">{label}</span>
          <input ref={input} className="input" value={value} maxLength={200} onChange={(e) => setValue(e.target.value)} autoFocus />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => onDone(null)}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={!value.trim()}>{confirmLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmDialog({ title, message, confirmLabel = "Delete", onDone }) {
  return (
    <Modal title={title} onClose={() => onDone(false)}>
      <p className="mb-5 text-sm text-muted">{message}</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => onDone(false)}>Cancel</button>
        <button type="button" className="btn-primary !bg-danger" onClick={() => onDone(true)} autoFocus>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

// Imperative helpers: `const name = await prompt({...})` keeps call sites simple.
export function mount(render) {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (value) => {
      root.unmount();
      host.remove();
      resolve(value);
    };
    root.render(render(done));
  });
}

export const promptDialog = (props) => mount((done) => <PromptDialog {...props} onDone={done} />);
export const confirmDialog = (props) => mount((done) => <ConfirmDialog {...props} onDone={done} />);
