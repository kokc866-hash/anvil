import { type ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Head({ children }: { children: ReactNode }) {
  return <p className="pt-4 pb-1 text-xs font-medium tracking-wide text-subtle uppercase">{children}</p>;
}

export function Vis({ q, label, children }: { q: string; label: string; children: ReactNode }) {
  if (q && !label.toLowerCase().includes(q)) return null;
  return <>{children}</>;
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm text-fg">{label}</p>
        {hint ? <p className="mt-0.5 text-xs text-muted text-pretty">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap rounded-md border border-border bg-bg p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "h-8 rounded-sm px-2.5 text-xs font-medium",
            value === o.id ? "bg-hover text-fg" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block py-2">
      <span className="text-xs text-muted">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-9 w-full rounded-md border border-border bg-bg px-2 font-mono text-xs text-fg outline-none placeholder:text-subtle focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-7 w-11 rounded-full border transition-colors duration-150",
        on ? "border-accent bg-accent" : "border-border bg-bg",
      )}
    >
      <span
        className={cn(
          "ui-switch-knob absolute top-0.5 left-0.5 size-5 rounded-full bg-fg",
          on ? "translate-x-[1.15rem] bg-accent-fg" : "",
        )}
      />
    </button>
  );
}
