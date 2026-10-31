import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Popover menu anchored to a trigger button. Rendered in a portal with fixed positioning
 * so it never gets clipped by scrolling containers; flips upward near the bottom edge.
 */
export function Menu({ trigger, label = "More options", children, className = "" }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !menuRef.current) return;
    const b = buttonRef.current.getBoundingClientRect();
    const m = menuRef.current.getBoundingClientRect();
    const top = b.bottom + m.height + 8 > window.innerHeight ? Math.max(8, b.top - m.height - 4) : b.bottom + 4;
    const left = Math.min(Math.max(8, b.right - m.width), window.innerWidth - m.width - 8);
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!menuRef.current?.contains(e.target) && !buttonRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    const onScroll = () => setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setPos(null);
          setOpen((v) => !v);
        }}
        className={className}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onClick={(e) => e.stopPropagation()}
            style={pos ?? { top: -9999, left: -9999 }}
            className="fixed z-50 max-h-[70vh] min-w-[13rem] overflow-y-auto rounded-lg border border-line bg-surface-1 py-1 shadow-2xl"
          >
            {typeof children === "function" ? children(() => setOpen(false)) : children}
          </div>,
          document.body,
        )}
    </>
  );
}

export function MenuItem({ icon: Icon, children, onSelect, close, danger = false, disabled = false }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        close?.();
        onSelect?.();
      }}
      className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:opacity-40 ${
        danger ? "text-danger" : ""
      }`}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0 text-muted" />}
      <span className="truncate">{children}</span>
    </button>
  );
}

export const MenuSeparator = () => <div className="my-1 border-t border-line" />;

export const MenuLabel = ({ children }) => (
  <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted">{children}</div>
);
