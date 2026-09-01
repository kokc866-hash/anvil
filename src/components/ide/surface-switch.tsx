import { ANVIL_SURFACE, surfaceLabel } from "@/lib/surface";
import { useIde } from "@/store/ide";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";

export function SurfaceSwitch({ compact }: { compact?: boolean }) {
  const t = useT();
  const servers = useIde((s) => s.mcpServers);
  const active = useIde((s) => s.activeSurfaceId);
  const mode = useIde((s) => s.surfaceMode);
  const setActive = useIde((s) => s.setActiveSurface);
  const setMode = useIde((s) => s.setSurfaceMode);
  const setSidebar = useIde((s) => s.setSidebar);
  const live = servers.filter((x) => x.enabled && x.url.trim());
  if (!live.length) return null;
  const current = live.some((s) => s.id === active) ? active : ANVIL_SURFACE;
  const label = surfaceLabel(current, live);
  return (
    <div className={cn("flex min-w-0 items-center gap-1", compact && "max-w-[42%]")}>
      <select
        className="h-7 max-w-full min-w-0 rounded-md border-0 bg-transparent px-1 text-xs text-fg outline-none"
        value={current}
        title={t("surface")}
        onChange={(e) => {
          const id = e.target.value;
          setActive(id);
          if (id !== ANVIL_SURFACE) setSidebar("mcp");
        }}
      >
        <option value={ANVIL_SURFACE}>{t("surfaceAnvil")}</option>
        {live.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name || s.id}
          </option>
        ))}
      </select>
      {current !== ANVIL_SURFACE ? (
        <button
          type="button"
          className={cn("h-6 shrink-0 rounded-sm px-1.5 text-[10px]", mode === "bridge" ? "bg-hover text-fg" : "text-muted hover:text-fg")}
          title={t("surfaceBridgeHint")}
          onClick={() => setMode(mode === "bridge" ? "exclusive" : "bridge")}
        >
          {mode === "bridge" ? t("surfaceBridge") : label}
        </button>
      ) : null}
    </div>
  );
}
