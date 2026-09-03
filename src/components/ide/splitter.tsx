import { useRef } from "react";

export function VSplit({ onDrag, onBegin }: { onDrag: (dx: number) => void; onBegin?: () => void }) {
  const last = useRef(0);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className="group relative z-10 w-2 shrink-0 cursor-col-resize outline-none"
      onMouseDown={(e) => {
        e.preventDefault();
        onBegin?.();
        last.current = e.clientX;
        function move(ev: MouseEvent) {
          onDrag(ev.clientX - last.current);
          last.current = ev.clientX;
        }
        function up() {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        }
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
    >
      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border group-hover:bg-subtle" />
    </div>
  );
}

export function HSplit({ onDrag }: { onDrag: (dy: number) => void }) {
  const last = useRef(0);
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      className="group relative z-10 h-2 shrink-0 cursor-row-resize outline-none"
      onMouseDown={(e) => {
        e.preventDefault();
        last.current = e.clientY;
        function move(ev: MouseEvent) {
          onDrag(ev.clientY - last.current);
          last.current = ev.clientY;
        }
        function up() {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        }
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
    >
      <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border group-hover:bg-subtle" />
    </div>
  );
}
