import { X } from "lucide-react";
import { useIde } from "@/store/ide";
import { Button } from "@/components/ui/button";
import { ProductWorkflows } from "./product-workflows";
import { ConnectionSummary } from "./connection-summary";

export function AgentSupportPane({ section }: { section: "workflows" | "connection" }) {
  const en = useIde(s => s.locale === "en");
  const title = section === "workflows"
    ? (en ? "Guided workflows" : "Geführte Aufgaben")
    : (en ? "Connection and supported inputs" : "Verbindung und unterstützte Eingaben");
  return <section aria-label={title} className="flex h-full min-h-0 flex-col bg-surface">
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <h2 className="min-w-0 flex-1 text-xs font-medium">{title}</h2>
      <Button variant="quiet" className="h-8 w-8 shrink-0 p-0" aria-label={en ? "Close" : "Schließen"} onClick={() => useIde.getState().setSidebar(null)}><X className="size-4" /></Button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {section === "workflows" ? <ProductWorkflows /> : <ConnectionSummary />}
    </div>
  </section>;
}
