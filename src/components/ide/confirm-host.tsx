import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { subscribeConfirm } from "@/lib/confirm";

export function ConfirmHost() {
  const [ask, setAsk] = useState<Parameters<Parameters<typeof subscribeConfirm>[0]>[0]>(null);

  useEffect(() => subscribeConfirm(setAsk), []);
  if (!ask) return null;

  return (
    <div className="ui-overlay fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-label={ask.title || "Bestätigung"} className="ui-pop w-[min(34rem,100%)] rounded-lg border border-border bg-surface p-4 shadow-xl">
        {ask.title ? <p className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">{ask.title}</p> : null}
        <p className="max-h-[50vh] overflow-auto text-sm whitespace-pre-wrap break-words text-fg">{ask.body}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button className="h-8" variant="quiet" onClick={() => ask.resolve(false)}>
            {ask.cancel || "Abbrechen"}
          </Button>
          {ask.secondary ? <Button className="h-8" variant="quiet" onClick={() => ask.resolve("secondary")}>{ask.secondary}</Button> : null}
          <Button className="h-8" variant={ask.danger ? "danger" : "primary"} onClick={() => ask.resolve(true)}>
            {ask.ok || "OK"}
          </Button>
        </div>
      </div>
    </div>
  );
}
