import type { ReactNode } from "react";
import {
  Brain,
  FlaskConical,
  FolderTree,
  GitBranch,
  Footprints,
  Library,
  MessageSquare,
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
import { useT } from "@/lib/i18n";
import { useKbd } from "@/lib/use-kbd";

export function ActivityBar() {
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
    setSidebar(sidebar === id ? null : id);
  }

  return (
    <nav className="flex w-11 shrink-0 flex-col items-center border-r border-border bg-surface py-1">
      <IconBtn label={t("files")} kbd={kFiles} on={sidebar === "files"} onClick={() => side("files")}>
        <FolderTree className="size-4" />
      </IconBtn>
      <IconBtn label={t("refs")} kbd={kRefs} on={sidebar === "ref"} onClick={() => side("ref")}>
        <Library className="size-4" />
      </IconBtn>
      <IconBtn label={t("search")} kbd={kSearch} on={sidebar === "search"} onClick={() => side("search")}>
        <Search className="size-4" />
      </IconBtn>
      <IconBtn label={t("git")} kbd={kGit} on={sidebar === "git"} onClick={() => side("git")} badge={gitN || undefined}>
        <GitBranch className="size-4" />
      </IconBtn>
      <IconBtn label={t("memory")} kbd={kMem} on={sidebar === "learn"} onClick={() => side("learn")}>
        <Brain className="size-4" />
      </IconBtn>
      <IconBtn label={t("tests")} kbd={kTests} on={sidebar === "tests"} onClick={() => side("tests")} badge={testFail || undefined} badgeDanger>
        <FlaskConical className="size-4" />
      </IconBtn>
      <IconBtn label={t("board")} kbd={kBoard} on={harnessBoardOpen} onClick={() => setHarnessBoardOpen(!harnessBoardOpen)}>
        <Workflow className="size-4" />
      </IconBtn>
      <IconBtn label={t("extensions")} on={sidebar === "ext"} onClick={() => side("ext")}>
        <Puzzle className="size-4" />
      </IconBtn>
      <IconBtn label={t("mcp")} on={sidebar === "mcp" || mcpOn} onClick={() => side("mcp")} badge={mcpN || undefined}>
        <Unplug className="size-4" />
      </IconBtn>
      <IconBtn label={t("agent")} kbd={kAgent} on={panels.agent} onClick={() => togglePanel("agent")} pulse={agentBusy}>
        <MessageSquare className="size-4" />
      </IconBtn>
      <IconBtn label={t("trail")} kbd={kTrail} on={panels.trail} onClick={() => togglePanel("trail")}>
        <Footprints className="size-4" />
      </IconBtn>
      <IconBtn
        label={t("output")}
        kbd={kOut}
        on={panels.output}
        onClick={() => {
          if (outputPopout) focusOutputWindow();
          else togglePanel("output");
        }}
      >
        <Terminal className="size-4" />
      </IconBtn>
      <div className="flex-1" />
      <IconBtn label={t("settings")} kbd={kSet} on={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}>
        <Settings className="size-4" />
      </IconBtn>
    </nav>
  );
}

function IconBtn({
  label,
  kbd,
  on,
  onClick,
  badge,
  badgeDanger,
  pulse,
  children,
}: {
  label: string;
  kbd?: string;
  on: boolean;
  onClick: () => void;
  badge?: number;
  badgeDanger?: boolean;
  pulse?: boolean;
  children: ReactNode;
}) {
  return (
    <Tip label={label} kbd={kbd} side="right">
      <button
        type="button"
        aria-label={label}
        aria-pressed={on}
        onClick={onClick}
        className={cn(
          "relative flex size-10 items-center justify-center rounded-md hover:bg-hover",
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
