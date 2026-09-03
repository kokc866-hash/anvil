import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export type CtxItem = {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  sep?: boolean;
  onClick?: () => void;
  items?: CtxItem[];
};

export function CtxMenu({
  x,
  y,
  onClose,
  items,
}: {
  x: number;
  y: number;
  onClose: () => void;
  items: CtxItem[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, flip: false });

  useLayoutEffect(() => {
    const el = ref.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el?.offsetWidth || 220;
    const h = el?.offsetHeight || Math.min(420, items.length * 32 + 16);
    const left = Math.max(8, Math.min(x, vw - w - 8));
    const top = Math.max(8, Math.min(y, vh - h - 8));
    setPos({ left, top, flip: left > vw - w - 200 });
  }, [x, y, items.length]);

  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-[80] cursor-default bg-transparent"
        aria-label="Menü schließen"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={ref}
        role="menu"
        className="fixed z-[90] max-h-[min(420px,calc(100vh-16px))] min-w-44 overflow-y-auto overflow-x-hidden rounded-md border border-border bg-surface py-1 shadow-lg"
        style={{ left: pos.left, top: pos.top }}
      >
        {items.map((it, i) => (
          <Row key={`${it.label}-${i}`} it={it} onClose={onClose} flip={pos.flip} />
        ))}
      </div>
    </>,
    document.body,
  );
}

/** Dropdown under a trigger, clamped to `within` so it never paints over Spur/Agent. */
export function FlyAt({
  anchor,
  within,
  onClose,
  children,
  align = "end",
}: {
  anchor: HTMLElement;
  within?: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  align?: "start" | "end";
}) {
  const [box, setBox] = useState({ top: 0, left: 0, width: 224, maxH: 288 });

  useLayoutEffect(() => {
    const ar = anchor.getBoundingClientRect();
    const wr = within?.getBoundingClientRect();
    const rightBound = wr ? wr.right - 4 : window.innerWidth - 8;
    const leftBound = 8;
    const topBound = wr ? wr.top + 4 : 8;
    const botBound = wr ? wr.bottom - 4 : window.innerHeight - 8;
    let width = Math.min(280, Math.max(160, rightBound - leftBound));
    if (width > rightBound - leftBound) width = Math.max(96, rightBound - leftBound);
    let left = align === "end" ? ar.right - width : ar.left;
    if (left + width > rightBound) left = rightBound - width;
    if (left < leftBound) left = leftBound;
    if (left + width > rightBound) width = Math.max(96, rightBound - left);
    const below = botBound - (ar.bottom + 2);
    const above = ar.top - 2 - topBound;
    if (below >= 120 || below >= above) {
      setBox({ top: ar.bottom + 2, left, width, maxH: Math.max(96, Math.min(288, below)) });
    } else {
      const maxH = Math.max(96, Math.min(288, above));
      setBox({ top: ar.top - 2 - maxH, left, width, maxH });
    }
  }, [anchor, within, align]);

  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-[80] cursor-default bg-transparent"
        aria-label="Menü schließen"
        onClick={onClose}
      />
      <div
        role="menu"
        className="fixed z-[90] overflow-x-hidden overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-lg"
        style={{ top: box.top, left: box.left, width: box.width, maxHeight: box.maxH }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

function Row({ it, onClose, flip }: { it: CtxItem; onClose: () => void; flip: boolean }) {
  const [open, setOpen] = useState(false);
  if (it.sep) return <div className="my-1 h-px bg-border" role="separator" />;
  if (it.items?.length) {
    return (
      <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
        <button
          type="button"
          className="flex h-8 w-full items-center justify-between gap-3 px-3 text-left text-sm text-fg hover:bg-hover"
        >
          {it.label}
          <ChevronRight className="size-3.5 text-subtle" />
        </button>
        {open ? (
          <div
            role="menu"
            className="absolute top-0 z-50 max-h-[min(360px,70vh)] min-w-40 overflow-y-auto overflow-x-hidden rounded-md border border-border bg-surface py-1 shadow-lg"
            style={flip ? { right: "100%" } : { left: "100%" }}
          >
            {it.items.map((c, i) => (
              <Row key={`${c.label}-${i}`} it={c} onClose={onClose} flip={flip} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      disabled={it.disabled}
      className={cn(
        "flex h-8 w-full items-center px-3 text-left text-sm hover:bg-hover disabled:text-subtle",
        it.danger ? "text-danger" : "text-fg",
      )}
      onClick={() => {
        it.onClick?.();
        onClose();
      }}
    >
      {it.label}
    </button>
  );
}

export function CtxItemBtn({ children, onClick, danger }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      className={cn("flex h-8 w-full items-center gap-2 px-3 text-left text-sm hover:bg-hover", danger ? "text-danger" : "text-fg")}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
