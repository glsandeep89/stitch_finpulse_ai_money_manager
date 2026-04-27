import { useEffect, useMemo, useRef, useState } from "react";

type RowActionItem = {
  id: string;
  label: string;
  icon: string;
  variant?: "default" | "danger";
  onClick: () => void;
};

export function RowActionMenu({
  label = "More actions",
  items,
}: {
  label?: string;
  items: RowActionItem[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useMemo(() => `row-action-menu-${Math.random().toString(36).slice(2)}`, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={label}
        onClick={() => setOpen((v) => !v)}
        className="rounded-full p-1.5 text-on-surface-variant hover:bg-surface-container-high hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-[18px] leading-none">more_horiz</span>
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 top-9 z-30 min-w-[230px] rounded-xl border border-outline-variant/20 bg-surface-container-lowest shadow-lg py-1"
        >
          {items.map((item) => {
            const danger = item.variant === "danger";
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                className={`w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 transition-colors ${
                  danger
                    ? "text-error hover:bg-error/10"
                    : "text-on-surface hover:bg-surface-container-high"
                }`}
              >
                <span className="material-symbols-outlined text-[16px] leading-none">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
