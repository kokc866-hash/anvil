import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { McpTool } from "@/lib/mcp";

export function ServiceToolPicker({
  name,
  tools,
  selected,
  disabled,
  onChange,
}: {
  name: string;
  tools: McpTool[];
  selected: Set<string>;
  disabled: boolean;
  onChange: (names: string[], enabled: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (expanded) dialog.current?.showModal();
  }, [expanded]);
  const visible = tools.filter(
    (tool) =>
      (!onlySelected || selected.has(tool.name)) &&
      `${tool.name} ${tool.description || ""}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const filtered = Boolean(query.trim()) || onlySelected;
  const selectedCount = tools.filter((tool) => selected.has(tool.name)).length;
  const action = "h-auto min-h-8 whitespace-normal px-2 py-1 text-xs";
  const content = (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="text-xs text-muted">
          {selectedCount} von {tools.length} freigegeben
        </p>
        {!expanded && (
          <Button className={action} variant="quiet" onClick={() => setExpanded(true)}>
            Auswahl vergrößern
          </Button>
        )}
      </div>
      <input
        autoFocus={expanded}
        className="w-full min-w-0 rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg"
        aria-label={`${name}: Werkzeuge suchen`}
        placeholder="Werkzeug oder Beschreibung suchen"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          className={action}
          disabled={disabled || !visible.some((tool) => !selected.has(tool.name))}
          onClick={() =>
            onChange(
              visible.map((tool) => tool.name),
              true,
            )
          }
        >
          {filtered ? "Treffer freigeben" : "Alle freigeben"}
        </Button>
        <Button
          className={action}
          variant="quiet"
          disabled={disabled || !visible.some((tool) => selected.has(tool.name))}
          onClick={() =>
            onChange(
              visible.map((tool) => tool.name),
              false,
            )
          }
        >
          {filtered ? "Treffer abwählen" : "Alle abwählen"}
        </Button>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={onlySelected}
            onChange={(event) => setOnlySelected(event.target.checked)}
          />
          Nur ausgewählte
        </label>
      </div>
      <p className="text-xs text-muted">
        Freigaben werden sofort gespeichert. „Alle freigeben“ umfasst auch Werkzeuge, die Daten
        ändern können.
      </p>
      <div
        className={`${expanded ? "max-h-[50vh]" : "max-h-72"} min-h-0 overflow-y-auto overscroll-contain rounded-md border border-border divide-y divide-border`}
      >
        {visible.length === 0 ? (
          <p className="p-3 text-sm text-muted">Keine passenden Werkzeuge.</p>
        ) : (
          visible.map((tool) => (
            <div key={tool.name} className="p-3 hover:bg-hover">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 shrink-0"
                  aria-label={`${name}: ${tool.name} freigeben`}
                  checked={selected.has(tool.name)}
                  disabled={disabled}
                  onChange={(event) => onChange([tool.name], event.target.checked)}
                />
                <span className="min-w-0 break-words text-sm font-medium text-fg [overflow-wrap:anywhere]">
                  {tool.name}
                </span>
              </label>
              {tool.description && (
                <details className="ml-6 mt-1 text-xs text-muted">
                  <summary className="cursor-pointer">Beschreibung</summary>
                  <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">
                    {tool.description}
                  </p>
                </details>
              )}
            </div>
          ))
        )}
      </div>
      {filtered && (
        <p className="text-xs text-muted">
          {visible.length} von {tools.length} angezeigt. Die Sammelauswahl gilt nur für diese
          Treffer.
        </p>
      )}
    </div>
  );
  return (
    <>
      {!expanded && content}
      <dialog
        ref={dialog}
        aria-label={`${name}: Werkzeugauswahl`}
        onClose={() => setExpanded(false)}
        className="fixed inset-0 m-auto max-h-[90vh] w-[min(900px,94vw)] overflow-y-auto rounded-xl border border-border bg-bg p-5 text-fg shadow-xl backdrop:bg-black/60"
      >
        {expanded && (
          <>
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="text-base font-semibold">{name} · Werkzeuge auswählen</h3>
              <Button className={action} onClick={() => dialog.current?.close()}>
                Fertig
              </Button>
            </div>
            {content}
          </>
        )}
      </dialog>
    </>
  );
}
