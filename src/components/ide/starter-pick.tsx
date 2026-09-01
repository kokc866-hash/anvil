import { useState } from "react";
import { applyStarter, isBareWorkspace, STARTERS, type StarterId } from "@/lib/starters";
import { useIde } from "@/store/ide";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

export function StarterPick({ onDone }: { onDone?: () => void }) {
  const t = useT();
  const files = useIde((s) => s.files);
  const bare = isBareWorkspace(files);
  const [pending, setPending] = useState<StarterId | null>(null);

  function go(id: StarterId, replace: boolean) {
    applyStarter(id, replace);
    useIde.getState().setNotice(t("starterOk"));
    setPending(null);
    onDone?.();
  }

  const live = STARTERS.filter((s) => s.group === "live");
  const remote = STARTERS.filter((s) => s.group === "remote");

  function grid(list: typeof STARTERS) {
    return (
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        {list.map((s) => (
          <button
            key={s.id}
            type="button"
            className="rounded-md border border-border bg-surface px-3 py-2 text-left hover:bg-hover"
            onClick={() => (bare ? go(s.id, true) : setPending(s.id))}
          >
            <span className="block text-sm text-fg">{s.label}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg text-left">
      <p className="text-xs font-medium text-fg">{t("starter")}</p>
      <p className="mt-0.5 text-[11px] text-muted">{t("starterHint")}</p>
      <p className="mt-3 text-[10px] tracking-wide text-subtle uppercase">{t("starterLive")}</p>
      {grid(live)}
      <p className="mt-3 text-[10px] tracking-wide text-subtle uppercase">{t("starterRemote")}</p>
      <p className="mt-0.5 text-[11px] text-muted">{t("starterRemoteHint")}</p>
      {grid(remote)}
      {pending ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-muted">{t("starterBusy")}</span>
          <Button className="h-7 px-2 text-[11px]" onClick={() => go(pending, false)}>
            {t("starterMerge")}
          </Button>
          <Button className="h-7 px-2 text-[11px]" onClick={() => go(pending, true)}>
            {t("starterReplace")}
          </Button>
          <Button variant="quiet" className="h-7 px-2 text-[11px]" onClick={() => setPending(null)}>
            {t("cancel")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
