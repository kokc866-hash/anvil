import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PreviewPane } from "@/components/ide/preview-pane";
import { startIdeSync } from "@/lib/ide-sync";
import { pickRunPreview } from "@/lib/run-window";
import { useIde } from "@/store/ide";

export const Route = createFileRoute("/run")({ component: RunPage });

function RunPage() {
  const theme = useIde((s) => s.theme);
  const path = useIde((s) => pickRunPreview(s.files, s.runPath, s.activePath, true));

  useEffect(() => {
    return startIdeSync();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.title = path ? `Run · ${path}` : "Run · Anvil";
  }, [theme, path]);

  return (
    <div className="h-dvh bg-bg text-fg">
      <PreviewPane popout />
    </div>
  );
}
