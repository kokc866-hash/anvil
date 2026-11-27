import { useState, type ReactNode } from "react";
import {
  Brain,
  ListChecks,
  Cable,
  FlaskConical,
  FolderTree,
  GitBranch,
  Footprints,
  Library,
  MessageSquare,
  MoreHorizontal,
  Puzzle,
  Search,
  Settings,
  Terminal,
  Unplug,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Tip } from "@/components/ui/tooltip";
import { focusOutputWindow } from "@/lib/output-window";
import { useIde, type SidebarId } from "@/store/ide";
import { FlyAt } from "./ctx-menu";
import { useT } from "@/lib/i18n";
import { useKbd } from "@/lib/use-kbd";

export function ActivityBar({ compact = false, dock, selectDock, onOpenSide }: {
  compact?: boolean;
  dock?: "agent" | "trail";
  selectDock?: (pane: "agent" | "trail") => void;
  onOpenSide?: () => void;
}) {
  const [more, setMore] = useState<HTMLButtonElement | null>(null);
  const sidebar = useIde((s) => s.sidebar);
  const panels = useIde((s) => s.panels);
  const settingsOpen = useIde((s) => s.settingsOpen);
  const harnessBoardOpen = useIde((s) => s.harnessBoardOpen);
  const gitN = useIde((s) => Object.keys(s.dirty).filter(Boolean).length);
  const agentBusy = useIde((s) => s.agentBusy);
  const testFail = useIde((s) => Object.values(s.testResults).filter((h) => !h.ok && !h.skip).length);
  const mcpN = useIde((s) => s.mcpServers.filter((x) => x.enabled).length);
  const mcpOn = useIde((s) => s.activeSurfaceId !== "anvil");
  const outputPopout = useIde((s) => s.outputPopout);
  const setSidebar = useIde((s) => s.setSidebar);
  const togglePanel = useIde((s) => s.togglePanel);
  const setSettingsOpen = useIde((s) => s.setSettingsOpen);
  const setHarnessBoardOpen = useIde((s) => s.setHarnessBoardOpen);
  const t = useT();
  const en = useIde(s => s.locale === "en");
  const kFiles = useKbd("files");
  const kRefs = useKbd("refs");
  const kSearch = useKbd("search");
  const kGit = useKbd("git");
  const kMem = useKbd("memory");
  const kTests = useKbd("tests");
  const kBoard = useKbd("board");
  const kAgent = useKbd("agent");
  const kTrail = useKbd("trail");
  const kOut = useKbd("output");
  const kSet = useKbd("settings");

  function side(id: Exclude<SidebarId, null>) {
    if (onOpenSide) {
      setSidebar(id);
      onOpenSide();
      return;
    }
    setSidebar(sidebar === id ? null : id);
  }
  const otherTools = [
    { label: t("refs"), icon: Library, key: kRefs, active: sidebar === "ref", open: () => side("ref") },
    { label: t("memory"), icon: Brain, key: kMem, active: sidebar === "learn", open: () => side("learn") },
    { label: t("board"), icon: Workflow, key: kBoard, active: harnessBoardOpen, open: () => setHarnessBoardOpen(!harnessBoardOpen) },
    { label: en ? "Guided workflows" : "Geführte Aufgaben", icon: ListChecks, active: sidebar === "workflows", open: () => side("workflows") },
    { label: en ? "Connection and supported inputs" : "Verbindung und unterstützte Eingaben", icon: Cable, active: sidebar === "connection", open: () => side("connection") },
  ];
  const moreLabel = en ? "More tools" : "Weitere Werkzeuge";

  return (
    <nav aria-label={en ? "Tools" : "Werkzeuge"} className="activity-rail flex w-11 shrink-0 flex-col items-center overflow-y-auto border-r border-border bg-surface py-1">
      <IconBtn help="files" label={t("files")} kbd={kFiles} on={sidebar === "files"} onClick={() => side("files")}>
        <FolderTree className="size-4" />
      </IconBtn>
      <IconBtn label={t("search")} kbd={kSearch} on={sidebar === "search"} onClick={() => side("search")}>
        <Search className="size-4" />
      </IconBtn>
      <IconBtn label={t("git")} kbd={kGit} on={sidebar === "git"} onClick={() => side("git")} badge={gitN || undefined}>
        <GitBranch className="size-4" />
      </IconBtn>
      <IconBtn label={t("tests")} kbd={kTests} on={sidebar === "tests"} onClick={() => side("tests")} badge={testFail || undefined} badgeDanger>
        <FlaskConical className="size-4" />
      </IconBtn>
      <IconBtn help="extensions" label={t("extensions")} on={sidebar === "ext"} onClick={() => side("ext")}>
        <Puzzle className="size-4" />
      </IconBtn>
      <IconBtn label={t("mcp")} on={sidebar === "mcp" || mcpOn} onClick={() => side("mcp")} badge={mcpN || undefined}>
        <Unplug className="size-4" />
      </IconBtn>
      <Tip label={moreLabel} side="right">
        <button type="button" aria-label={moreLabel} aria-haspopup="menu" aria-expanded={Boolean(more)}
          className={cn("flex size-10 shrink-0 items-center justify-center rounded-md hover:bg-hover", more || otherTools.some(tool => tool.active) ? "bg-hover text-fg" : "text-muted")}
          onClick={event => setMore(event.currentTarget)}><MoreHorizontal className="size-4" /></button>
      </Tip>
      {more && <FlyAt anchor={more} align="beside" onClose={() => setMore(null)}>
        {otherTools.map(({ label, icon: Icon, key, active, open }) => (
          <button key={label} type="button" role="menuitem" className={cn("flex min-h-9 w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-hover", active ? "bg-hover text-fg" : "text-muted")}
            onClick={() => { setMore(null); open(); }}>
            <Icon className="size-4 shrink-0" /><span className="min-w-0 flex-1">{label}</span>{key && <kbd className="text-xs text-subtle">{key}</kbd>}
          </button>
        ))}
      </FlyAt>}
      {!compact && <>
      <div aria-hidden="true" className="my-1 w-5 shrink-0 border-t border-border" />
      <IconBtn help="agent" label={t("agent")} kbd={kAgent} on={dock ? dock === "agent" : panels.agent} onClick={() => selectDock ? selectDock("agent") : togglePanel("agent")} pulse={agentBusy}>
        <MessageSquare className="size-4" />
      </IconBtn>
      <IconBtn help="trail" label={t("trail")} kbd={kTrail} on={dock ? dock === "trail" : panels.trail} onClick={() => selectDock ? selectDock("trail") : togglePanel("trail")}>
        <Footprints className="size-4" />
      </IconBtn>
      <IconBtn
        label={t("output")}
        help="output"
        kbd={kOut}
        on={panels.output}
        onClick={() => {
          if (outputPopout) focusOutputWindow();
          else togglePanel("output");
        }}
      >
        <Terminal className="size-4" />
      </IconBtn>
      </>}
      <div className="flex-1" />
      <IconBtn help="settings" label={t("settings")} kbd={kSet} on={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}>
        <Settings className="size-4" />
      </IconBtn>
    </nav>
  );
}

function IconBtn({
  help,
  label,
  kbd,
  on,
  onClick,
  badge,
  badgeDanger,
  pulse,
  children,
}: {
  help?: string;
  label: string;
  kbd?: string;
  on: boolean;
  onClick: () => void;
  badge?: number;
  badgeDanger?: boolean;
  pulse?: boolean;
  children: ReactNode;
}) {
  const tips = useIde(s => s.helpPreferences.tips);
  return (
    <Tip label={label} kbd={kbd} side="right" disabled={Boolean(help && tips)}>
      <button
        data-help={help}
        type="button"
        aria-label={label}
        aria-pressed={on}
        onClick={onClick}
        className={cn(
          "relative flex size-10 shrink-0 items-center justify-center rounded-md hover:bg-hover",
          on ? "text-fg" : "text-subtle hover:text-fg",
          pulse && "think-live",
        )}
      >
        {on ? <span className="ui-bar absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" /> : null}
        {children}
        {badge ? (
          <span
            className={cn(
              "ui-badge absolute top-1 right-1 min-w-3.5 rounded-full px-0.5 text-center font-mono text-[9px]",
              badgeDanger ? "bg-danger text-white" : "bg-accent text-accent-fg",
            )}
          >
            {badge}
          </span>
        ) : null}
      </button>
    </Tip>
  );
}
