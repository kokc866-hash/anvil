import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";

function uniq(ids: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const t = id.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function score(id: string, q: string) {
  const n = id.toLowerCase();
  const s = q.trim().toLowerCase();
  if (s) {
    if (n === s) return 0;
    if (n.startsWith(s)) return 1;
    if (n.includes(s)) return 2;
    return 99;
  }
  if (/^(gpt-|o[1-9]|chatgpt|claude|gemini|grok|llama|qwen|mistral|deepseek|sonar|command)/i.test(id)) return 10;
  if (/(whisper|tts|dall-e|embedding|moderation|babbage|davinci|ada-|audio|realtime|transcribe|image-|sora)/i.test(id))
    return 40;
  return 20;
}

export function ModelPick({
  catalog = [],
  live = [],
  value,
  onChange,
  placeholder = "Modell-ID",
  loading = false,
  hint,
  labelOf,
  prefer = [],
}: {
  catalog?: string[];
  live?: string[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  loading?: boolean;
  hint?: string;
  labelOf?: (id: string) => string;
  prefer?: string[];
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const all = useMemo(() => uniq([...prefer, ...live, ...catalog, value]), [prefer, live, catalog, value]);
  const pref = useMemo(() => new Map(prefer.map((id, i) => [id, i])), [prefer]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const filtering = s.length > 0 && s !== value.trim().toLowerCase();
    return all
      .map((id) => ({ id, n: filtering ? score(id, q) : score(id, "") }))
      .filter((r) => r.n < 99)
      .sort((a, b) => {
        if (!filtering && pref.size) {
          const ia = pref.has(a.id) ? pref.get(a.id)! : 1000;
          const ib = pref.has(b.id) ? pref.get(b.id)! : 1000;
          if (ia !== ib) return ia - ib;
        }
        return a.n - b.n || a.id.localeCompare(b.id);
      });
  }, [all, q, value, pref]);
  const shown = rows.slice(0, 400);
  const liveSet = useMemo(() => new Set(live), [live]);
  const label = (id: string) => labelOf?.(id) || id;

  return (
    <div ref={box} className="relative py-2">
      <span className="text-xs text-muted">Modell</span>
      <input
        value={open ? q : label(value) || value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="mt-1 h-9 w-full rounded-md border border-border bg-bg px-2 font-mono text-xs text-fg outline-none placeholder:text-subtle focus:ring-2 focus:ring-ring"
        onFocus={() => {
          setQ(value);
          setOpen(true);
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 120);
        }}
        onChange={(e) => {
          setQ(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Enter") {
            e.preventDefault();
            const first = shown[0]?.id;
            if (first) onChange(first);
            setOpen(false);
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      />
      <p className="mt-1 text-[11px] text-subtle">
        {hint
          ? hint
          : loading
            ? "Lade Liste…"
            : live.length
              ? `${live.length} vom Server${catalog.length ? ` · ${catalog.length} Katalog` : ""} · tippen filtert`
              : catalog.length
                ? `${catalog.length} im Katalog · tippen filtert`
                : "ID eintippen oder Verbindung prüfen"}
      </p>
      {open ? (
        <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-surface shadow-lg">
          {shown.length === 0 ? (
            <li className="px-2 py-2 text-[11px] text-subtle">{q.trim() ? `Übernehmen: ${q.trim()}` : "Keine Treffer"}</li>
          ) : (
            shown.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px]",
                    r.id === value ? "bg-hover text-fg" : "text-muted hover:bg-hover hover:text-fg",
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(r.id);
                    setQ("");
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate font-mono">{label(r.id)}</span>
                  {liveSet.has(r.id) ? <span className="shrink-0 text-[9px] text-subtle">live</span> : null}
                </button>
              </li>
            ))
          )}
          {rows.length > shown.length ? (
            <li className="px-2 py-1 text-[10px] text-subtle">+{rows.length - shown.length} weitere — genauer suchen</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
