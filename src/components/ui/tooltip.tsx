import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export type TipSide = "top" | "bottom" | "left" | "right";

export function modGlyph() {
  if (typeof navigator === "undefined") return "Ctrl";
  return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl";
}

type Props = {
  label: string;
  kbd?: string;
  side?: TipSide;
  delay?: number;
  children: ReactElement;
};

export function Tip({ label, kbd, side = "bottom", delay = 280, children }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const t = useRef(0);
  const id = useId();

  function hide() {
    window.clearTimeout(t.current);
    setPos(null);
  }

  function show(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    const pad = 8;
    let x = r.left + r.width / 2;
    let y = r.bottom + pad;
    if (side === "top") {
      x = r.left + r.width / 2;
      y = r.top - pad;
    } else if (side === "right") {
      x = r.right + pad;
      y = r.top + r.height / 2;
    } else if (side === "left") {
      x = r.left - pad;
      y = r.top + r.height / 2;
    }
    setPos({ x, y });
  }

  useEffect(() => () => window.clearTimeout(t.current), []);

  if (!isValidElement(children)) return children as unknown as ReactNode;

  const child = cloneElement(children as ReactElement<Record<string, unknown>>, {
    "aria-label": (children.props as { "aria-label"?: string })["aria-label"] || label,
    title: undefined,
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      (children.props as { onMouseEnter?: (ev: typeof e) => void }).onMouseEnter?.(e);
      const el = e.currentTarget;
      window.clearTimeout(t.current);
      t.current = window.setTimeout(() => show(el), delay);
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      (children.props as { onMouseLeave?: (ev: typeof e) => void }).onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      (children.props as { onFocus?: (ev: typeof e) => void }).onFocus?.(e);
      show(e.currentTarget);
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      (children.props as { onBlur?: (ev: typeof e) => void }).onBlur?.(e);
      hide();
    },
    onMouseDown: (e: React.MouseEvent<HTMLElement>) => {
      (children.props as { onMouseDown?: (ev: typeof e) => void }).onMouseDown?.(e);
      hide();
    },
  });

  return (
    <>
      {child}
      {pos && typeof document !== "undefined"
        ? createPortal(
            <div
              id={id}
              role="tooltip"
              className={cn("anvil-tip", `anvil-tip-${side}`)}
              style={{ left: pos.x, top: pos.y }}
            >
              <span>{label}</span>
              {kbd ? <kbd>{kbd.replace(/Ctrl/g, modGlyph())}</kbd> : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
