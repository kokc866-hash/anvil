import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { OutputPane } from "@/components/ide/output-pane";
import { startIdeSync } from "@/lib/ide-sync";
import { useIde } from "@/store/ide";

export const Route = createFileRoute("/console")({ component: ConsolePage });

function ConsolePage() {
  const theme = useIde((s) => s.theme);

  useEffect(() => {
    return startIdeSync();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.title = "Ausgabe · Anvil";
  }, [theme]);

  return (
    <div className="h-dvh bg-bg text-fg">
      <OutputPane popout />
    </div>
  );
}
