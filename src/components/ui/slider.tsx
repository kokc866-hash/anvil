type Props = {
  label: string;
  hint?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (n: number) => void;
  format?: (n: number) => string;
  edit?: boolean;
};

export function Slider({ label, hint, min, max, step = 1, value, onChange, format, edit }: Props) {
  const n = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
  const pct = ((n - min) / Math.max(1e-9, max - min)) * 100;
  const shown = format ? format(n) : String(n);
  return (
    <div className="py-2.5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="text-sm text-fg">{label}</p>
        {edit ? (
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={n}
            aria-label={label}
            className="h-6 w-[4.5rem] rounded-md border border-border bg-bg px-1.5 text-right font-mono text-[11px] tabular-nums text-fg outline-none focus:ring-1 focus:ring-ring"
            onChange={(e) => onChange(Number(e.target.value) || min)}
          />
        ) : (
          <span className="font-mono text-[11px] tabular-nums text-muted">{shown}</span>
        )}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={n}
        aria-label={label}
        style={{ background: `linear-gradient(to right, var(--color-muted) ${pct}%, var(--color-border) ${pct}%)` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint ? <p className="mt-1 text-[11px] text-subtle text-pretty">{hint}</p> : null}
    </div>
  );
}
