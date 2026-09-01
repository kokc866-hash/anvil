import { useMemo, useState } from "react";
import { Play, RotateCcw, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { discoverTests, mergeTests, testsPrompt } from "@/lib/test-parse";
import { runAllTests, runFailedTests, runTestFiles } from "@/lib/run-tests";
import { gotoFile } from "@/lib/goto";
import { cn } from "@/lib/cn";
import { useIde } from "@/store/ide";
import { useT } from "@/lib/i18n";
import { CtxMenu } from "./ctx-menu";

export function TestsPane() {
  const t = useT();
  const files = useIde((s) => s.files);
  const results = useIde((s) => s.testResults);
  const running = useIde((s) => s.testsRunning);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; name: string } | null>(null);

  const rows = useMemo(
    () => mergeTests(discoverTests(files), Object.values(results)),
    [files, results],
  );
  const pass = rows.filter((h) => h.ok && !h.skip).length;
  const fail = rows.filter((h) => !h.ok && !h.skip).length;
  const idle = rows.filter((h) => h.skip).length;
  const groups = useMemo(() => {
    const g = new Map<string, typeof rows>();
    for (const h of rows) {
      const list = g.get(h.path) ?? [];
      list.push(h);
      g.set(h.path, list);
    }
    return [...g.entries()];
  }, [rows]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-1">
          <p className="min-w-0 flex-1 text-xs font-medium text-fg">{t("tests")}</p>
          <Button
            variant="quiet"
            className="h-7 px-2 text-[11px]"
            disabled={running}
            tip={t("runAllTests")}
            onClick={() => void runAllTests()}
          >
            <Play className="mr-1 size-3" />
            {running ? t("running") : t("run")}
          </Button>
          <Button
            variant="quiet"
            className="h-7 w-7 p-0"
            disabled={running || !fail}
            tip={t("runFailed")}
            onClick={() => void runFailedTests()}
          >
            <RotateCcw className="size-3" />
          </Button>
          <Button
            variant="quiet"
            className="h-7 w-7 p-0"
            disabled={!fail}
            tip={t("fixFails")}
            onClick={() => {
              useIde.getState().pushAgent(testsPrompt(rows));
              useIde.getState().togglePanel("agent");
            }}
          >
            <Wrench className="size-3" />
          </Button>
        </div>
        <p className="mt-1 font-mono text-[11px] text-muted">
          {rows.length === 0
            ? t("noTestFiles")
            : [
                fail ? `${fail} ${t("fail")}` : null,
                pass ? `${pass} ${t("ok")}` : null,
                idle ? `${idle} ${t("idle")}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {groups.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted">{t("testHint")}</p>
        ) : (
          groups.map(([path, items]) => (
            <div key={path} className="mb-1">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-hover"
                onClick={() => void runTestFiles([path])}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, path, name: items[0]?.name ?? path });
                }}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-subtle">{path}</span>
                <span className="font-mono text-[10px] text-muted">
                  {items.filter((x) => x.ok && !x.skip).length}/{items.length}
                </span>
              </button>
              {items.map((h, i) => {
                const tone = h.skip ? "text-subtle" : h.ok ? "text-ok" : "text-danger";
                return (
                  <button
                    key={`${h.path}:${h.name}:${i}`}
                    type="button"
                    className="flex w-full items-start gap-2 px-3 py-1 pl-5 text-left hover:bg-hover"
                    onClick={() => gotoFile(h.path, h.line)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, path: h.path, name: h.name });
                    }}
                  >
                    <span className={cn("mt-0.5 font-mono text-[10px]", tone)}>{h.skip ? "○" : h.ok ? "●" : "●"}</span>
                    <span className="min-w-0">
                      <span className="block font-mono text-xs text-fg">{h.name}</span>
                      <span className="block truncate font-mono text-[10px] text-muted">
                        {h.path}:{h.line}
                        {h.text ? `  ${h.text}` : ""}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
      {menu ? (
        <CtxMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: t("open"), onClick: () => gotoFile(menu.path, 1) },
            { label: t("run"), onClick: () => void runTestFiles([menu.path]) },
            {
              label: t("fixFails"),
              onClick: () => {
                const hits = rows.filter((h) => h.path === menu.path);
                useIde.getState().pushAgent(testsPrompt(hits.length ? hits : rows));
              },
            },
          ]}
        />
      ) : null}
    </div>
  );
}
