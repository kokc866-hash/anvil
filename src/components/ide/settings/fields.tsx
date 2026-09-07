import { createContext, useContext, useId, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { matchesSettings } from "./search";
export { SettingsHeading as Head, SettingsSection } from "./search";

const Description = createContext<{ label: string; hint?: string } | undefined>(undefined);

export function Vis({ q, label, children }: { q: string; label: string; children: ReactNode }) {
  if (!matchesSettings(q, children, label)) return null;
  return <div className="contents" data-settings-match={q ? "true" : undefined}>{children}</div>;
}

export function Row({ label, hint, children, compact = false }: { label: string; hint?: string; children: ReactNode; compact?: boolean }) {
  const id = useId();
  return (
    <div className={cn("flex items-start justify-between gap-4", compact ? "py-1.5" : "py-3")}>
      <div className="min-w-0">
        <p id={id} className="text-sm text-fg">{label}</p>
        {hint ? <p id={`${id}-hint`} className="mt-0.5 text-xs text-muted text-pretty">{hint}</p> : null}
      </div>
      <Description.Provider value={{ label: id, hint: hint ? `${id}-hint` : undefined }}>
        <div className="shrink-0">{children}</div>
      </Description.Provider>
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
  const description = useContext(Description);
  return (
    <div role="group" aria-labelledby={description?.label} aria-describedby={description?.hint} className="flex flex-wrap rounded-md border border-border bg-bg p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
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
  const description = useContext(Description);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={description?.label}
      aria-describedby={description?.hint}
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
