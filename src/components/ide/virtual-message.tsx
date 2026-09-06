import { memo, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { ChatMsg } from "@/store/ide";

type ObserverGroup = { observer: IntersectionObserver; listeners: Map<Element, (visible: boolean) => void> };
const observers = new WeakMap<Element, ObserverGroup>();

function observe(root: Element, element: Element, receive: (visible: boolean) => void) {
  let group = observers.get(root);
  if (!group) {
    const listeners = new Map<Element, (visible: boolean) => void>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
      },
      { root, rootMargin: "1000px 0px" },
    );
    group = { observer, listeners };
    observers.set(root, group);
  }
  const active = group;
  active.listeners.set(element, receive);
  active.observer.observe(element);
  return () => {
    active.observer.unobserve(element);
    active.listeners.delete(element);
    if (!active.listeners.size) {
      active.observer.disconnect();
      observers.delete(root);
    }
  };
}

export const VirtualMessage = memo(function VirtualMessage({
  message,
  live,
  enabled,
  scroller,
  children,
}: {
  message: ChatMsg;
  live: boolean;
  enabled: boolean;
  scroller: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!enabled || live);
  const measured = useRef(0);
  const shown = !enabled || live || visible;
  useEffect(() => {
    const element = ref.current,
      root = scroller.current;
    if (!enabled || !element || !root || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    return observe(root, element, (inside) => {
      // Keep keyboard focus and active text selection mounted.
      const selection = window.getSelection();
      const selected = Boolean(
        selection &&
        !selection.isCollapsed &&
        ((selection.anchorNode && element.contains(selection.anchorNode)) ||
          (selection.focusNode && element.contains(selection.focusNode))),
      );
      setVisible(inside || element.contains(document.activeElement) || selected);
    });
  }, [enabled, scroller]);
  useEffect(() => {
    const element = ref.current;
    if (!shown || !element) return;
    const measure = () => {
      measured.current = element.getBoundingClientRect().height;
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [shown]);
  const estimate = Math.max(64, Math.min(800, 48 + Math.ceil(message.content.length / 75) * 22));
  return (
    <div
      ref={ref}
      className="flex w-full min-w-0 flex-col"
      style={shown ? undefined : { height: measured.current || estimate }}
      aria-hidden={shown ? undefined : true}
    >
      {shown ? children : null}
    </div>
  );
});
