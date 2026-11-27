import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { useIde } from "@/store/ide";

export type CtxItem = {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  sep?: boolean;
  onClick?: () => void;
  items?: CtxItem[];
};

function menuKeys(event: KeyboardEvent<HTMLDivElement>, close: () => void) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    close();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  if (!buttons.length) return;
  event.preventDefault();
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
    : (current + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
  buttons[index].focus();
}

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
  const [pos, setPos] = useState({ left: x, top: y });
  const [path, setPath] = useState<number[]>([]);
  const en = useIde(s => s.locale === "en");
  const entries = path.reduce((level, index) => level[index]?.items ?? [], items);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      setPos({ left: Math.max(8, Math.min(x, innerWidth - el.offsetWidth - 8)), top: Math.max(8, Math.min(y, innerHeight - el.offsetHeight - 8)) });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    window.addEventListener("resize", place);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); };
  }, [x, y]);
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    if (ref.current) ref.current.scrollTop = 0;
  }, [path]);

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
        className="fixed z-[90] max-h-[min(420px,calc(100dvh-16px))] w-max max-w-[min(20rem,calc(100vw-16px))] min-w-[min(11rem,calc(100vw-16px))] overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-lg"
        style={{ left: pos.left, top: pos.top }}
        onKeyDown={event => {
          if (event.key === "ArrowLeft" && path.length) { event.preventDefault(); setPath(path.slice(0,-1)); }
          else menuKeys(event, onClose);
        }}
      >
        {path.length > 0 && <button type="button" role="menuitem" className="flex min-h-9 w-full items-center gap-2 border-b border-border px-3 text-sm text-muted hover:bg-hover"
          onClick={() => setPath(path.slice(0,-1))}><ChevronLeft className="size-4" />{en ? "Back" : "Zurück"}</button>}
        {entries.map((it, i) => it.sep ? <div key={i} className="my-1 border-t border-border" role="separator" /> : (
          <button key={`${it.label}-${i}`} type="button" role="menuitem" disabled={it.disabled} aria-haspopup={it.items?.length ? "menu" : undefined}
            className={cn("flex min-h-9 w-full items-center justify-between gap-3 px-3 py-1 text-left text-sm hover:bg-hover disabled:text-subtle", it.danger ? "text-danger" : "text-fg")}
            onKeyDown={event => { if(event.key === "ArrowRight" && it.items?.length) { event.preventDefault(); setPath([...path,i]); } }}
            onClick={() => { if (it.items?.length) setPath([...path, i]); else { it.onClick?.(); onClose(); } }}>
            {it.label}{Boolean(it.items?.length) && <ChevronRight className="size-4 shrink-0 text-subtle" />}
          </button>
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
  align?: "start" | "end" | "beside";
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{top?: number;bottom?: number;left: number;width: number;maxHeight: number}>();

  useLayoutEffect(() => {
    const place = () => {
      const ar = anchor.getBoundingClientRect(), wr = within?.getBoundingClientRect();
      const leftEdge = Math.max(8, (wr?.left ?? 0) + 4), rightEdge = Math.min(innerWidth-8, (wr?.right ?? innerWidth)-4);
      const topEdge = Math.max(8, (wr?.top ?? 0) + 4), bottomEdge = Math.min(innerHeight-8, (wr?.bottom ?? innerHeight)-4);
      const width = Math.max(0, Math.min(280, rightEdge-leftEdge));
      const start = align === "beside" ? ar.right + 6 : align === "end" ? ar.right-width : ar.left;
      const left = Math.max(leftEdge, Math.min(rightEdge-width, start));
      if (align === "beside") {
        const maxHeight = Math.max(0, Math.min(320, bottomEdge-topEdge));
        const height = Math.min(maxHeight, (menu.current?.scrollHeight ?? maxHeight) + 2);
        setBox({ left, width, maxHeight, top: Math.max(topEdge, Math.min(ar.top,bottomEdge-height)) });
      } else {
        const below = Math.max(0,bottomEdge-ar.bottom-2), above = Math.max(0,ar.top-2-topEdge);
        setBox(below >= 200 || below >= above
          ? {left,width,top:ar.bottom+2,maxHeight:Math.min(320,below)}
          : {left,width,bottom:innerHeight-ar.top+2,maxHeight:Math.min(320,above)});
      }
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(anchor);
    if (within) observer.observe(within);
    if (menu.current) observer.observe(menu.current);
    window.addEventListener("resize",place);
    window.addEventListener("scroll",place,true);
    return () => { observer.disconnect(); window.removeEventListener("resize",place); window.removeEventListener("scroll",place,true); };
  }, [anchor, within, align]);

  useLayoutEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({preventScroll:true});
  }, [anchor]);

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
        ref={menu}
        role="menu"
        className="fixed z-[90] overflow-x-hidden overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-lg"
        style={box}
        onKeyDown={event => menuKeys(event, () => { onClose(); anchor.focus({preventScroll:true}); })}
      >
        {children}
      </div>
    </>,
    document.body,
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
