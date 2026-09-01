import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

export function AppErrorComponent({ error }: ErrorComponentProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-fg">
      <span className="text-danger" aria-hidden="true">
        <TriangleAlert className="size-8" strokeWidth={2} />
      </span>
      <h1 className="text-lg font-medium">Anvil ist stehen geblieben</h1>
      <p className="max-w-md text-sm break-words text-muted">{error.message || "Unerwarteter Fehler."}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-fg hover:bg-hover"
          onClick={() => {
            void import("./intern").then((m) => m.useIntern.getState().restart("soft"));
          }}
        >
          Oberfläche neu
        </button>
        <button
          type="button"
          className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-fg hover:bg-hover"
          onClick={() => location.reload()}
        >
          Neu laden
        </button>
      </div>
    </main>
  );
}
