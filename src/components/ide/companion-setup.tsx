import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyMini } from "@/components/ui/copy-btn";
import {
  companionPing,
  companionLspPull,
  companionLspCheck,
  companionToolchain,
  companionToolPull,
  companionSetHome,
  pairCompanion,
  setCompanionToken,
  DEFAULT_COMPANION,
  DEFAULT_ENGINE_MCP,
  type LspPack,
  type ToolchainInfo,
  type ToolPull,
} from "@/lib/companion";
import { loadSecrets } from "@/lib/secrets";
import { newMcpId } from "@/lib/mcp";
import { holdCompanion, releaseCompanion } from "@/lib/companion-life";
import { nativeHelper } from "@/lib/helper-local";
import { confirmApp } from "@/lib/confirm";
import { useIde } from "@/store/ide";
import { useT } from "@/lib/i18n";

const COMPILER_BINS = ["go", "rustc", "cargo", "javac", "java", "cc", "cxx", "php", "ruby", "dotnet", "python", "tsc"] as const;

type Ping = {
  ok: boolean;
  error?: string;
  bins?: Record<string, string | null>;
  version?: string;
  lsp?: LspPack[];
  installer?: string | null;
  toolchains?: ToolchainInfo[];
  toolHome?: string;
  lspHome?: string;
  packages?: { home: string; toolchains: string; lsp: string };
};

export function CompanionSetup({ compact }: { compact?: boolean }) {
  const t = useT();
  const url = useIde((s) => s.companionUrl);
  const setUrl = useIde((s) => s.setCompanionUrl);
  const engineLink = useIde((s) => s.engineLink);
  const setEngineLink = useIde((s) => s.setEngineLink);
  const servers = useIde((s) => s.mcpServers);
  const setMcp = useIde((s) => s.setMcpServers);
  const setNotice = useIde((s) => s.setNotice);
  const keep = useIde((s) => s.companionKeep);
  const setKeep = useIde((s) => s.setCompanionKeep);
  const netCompiler = useIde((s) => s.netCompiler);
  const setNetCompiler = useIde((s) => s.setNetCompiler);
  const [tok, setTok] = useState(() => loadSecrets().companionToken);
  const [showTok, setShowTok] = useState(false);
  const [ping, setPing] = useState<Ping | null>(null);
  const [busy, setBusy] = useState(false);
  const [pullId, setPullId] = useState("");
  const [checkId, setCheckId] = useState("");
  const [checkNote, setCheckNote] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState("");
  const [toolPull, setToolPull] = useState<ToolPull | null>(null);
  const [pkgPath, setPkgPath] = useState("");
  const lspEnabled = useIde((s) => s.lspEnabled);
  const setLspEnabled = useIde((s) => s.setLspEnabled);
  const lspTimeout = useIde((s) => s.lspTimeout);
  const setLspTimeout = useIde((s) => s.setLspTimeout);
  const lspMaxFiles = useIde((s) => s.lspMaxFiles);
  const setLspMaxFiles = useIde((s) => s.setLspMaxFiles);
  const lspLog = useIde((s) => s.lspLog);
  const clearLspLog = useIde((s) => s.clearLspLog);
  const electron = Boolean(nativeHelper()?.companionEnsure);
  const port = portOf(url);

  useEffect(() => {
    void nativeHelper()?.companionToken?.().then((n) => {
      if (n && !tok) {
        setTok(n);
        setCompanionToken(n);
      }
    });
    void check(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!installing) {
      setToolPull(null);
      return;
    }
    let on = true;
    const tick = async () => {
      const p = await companionToolPull(url || DEFAULT_COMPANION).catch(() => null);
      if (on) setToolPull(p);
    };
    void tick();
    const id = setInterval(() => void tick(), 400);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, [installing, url]);

  async function check(notice = true) {
    setBusy(true);
    try {
      await holdCompanion();
      const p = await companionPing(url || DEFAULT_COMPANION);
      setPing(p);
      if (p.packages?.home) setPkgPath(p.packages.home);
      else if (p.toolHome) setPkgPath(p.toolHome.replace(/[/\\]toolchains[/\\]?$/, ""));
      const hit = useIde.getState().engineLink;
      setEngineLink(hit ? { ...hit, ok: p.ok } : p.ok ? { label: "Companion", ok: true } : null);
      if (notice && !compact) setNotice(p.ok ? t("compOk") : p.error || t("compOff"));
      if (p.ok && !useIde.getState().mcpServers.some((s) => s.url.includes("7845"))) {
        setMcp([...useIde.getState().mcpServers, { id: newMcpId(), name: "Companion", url: DEFAULT_ENGINE_MCP, enabled: true }]);
      }
      if (!useIde.getState().companionKeep && !useIde.getState().runPopout) await releaseCompanion();
    } finally {
      setBusy(false);
    }
  }

  function setPort(raw: string) {
    const n = raw.replace(/\D/g, "").slice(0, 5);
    try {
      const u = new URL(url || DEFAULT_COMPANION);
      u.port = n || "7845";
      setUrl(u.toString().replace(/\/$/, ""));
    } catch {
      setUrl(`http://127.0.0.1:${n || "7845"}`);
    }
  }

  async function toggleKeep(on: boolean) {
    setKeep(on);
    if (on) {
      await holdCompanion();
      await check(false);
    } else if (!useIde.getState().runPopout) {
      await releaseCompanion();
    }
  }

  const bins = ping?.bins ?? {};
  const tools = ping?.toolchains?.length
    ? ping.toolchains
    : COMPILER_BINS.map((id) => ({
        id,
        label: id,
        about: "",
        kind: id,
        ready: Boolean(bins[id]),
        via: bins[id] ? "path" : "",
        path: bins[id] || null,
      }));
  const found = tools.filter((x) => x.ready);
  const cmd = "node companion/server.mjs";

  async function pullTool(row: (typeof tools)[number]) {
    if (row.ready && row.via === "path") {
      setNotice(`${row.label}: ${row.path || t("compViaPath")}`);
      return;
    }
    if (row.ready && row.via === "anvil") {
      const drop = await confirmApp(`${row.label}: ${t("compRemove")}?`, { ok: t("compRemove"), danger: true });
      if (!drop) return;
      setInstalling(row.kind);
      try {
        await holdCompanion();
        await companionToolchain(row.id, "remove", url || DEFAULT_COMPANION);
        setNotice(t("compRemove") + " · " + row.label);
        await check(false);
      } finally {
        setInstalling("");
        if (!useIde.getState().companionKeep && !useIde.getState().runPopout) await releaseCompanion();
      }
      return;
    }
    if (!ping?.ok) {
      setNotice(t("compNeed"));
      return;
    }
    const ok = await confirmApp(`${row.label}: ${t("compPullHint")} ${row.about}`.trim(), { ok: t("compPull") });
    if (!ok) return;
    setInstalling(row.kind);
    try {
      await holdCompanion();
      const r = await companionToolchain(row.id, "pull", url || DEFAULT_COMPANION);
      if (r.ok) {
        setNotice(t("compPulled", { name: r.label || row.label }));
        await check(false);
      } else {
        setNotice(`${t("compPullFail")}: ${r.error || ""}`.slice(0, 220));
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : t("compPullFail"));
    } finally {
      setInstalling("");
      if (!useIde.getState().companionKeep && !useIde.getState().runPopout) await releaseCompanion();
    }
  }

  async function abortTool() {
    await companionToolchain("", "abort", url || DEFAULT_COMPANION);
    setNotice(t("compAborted"));
  }
  const status = ping?.ok
    ? `${t("compOk")}${ping.version ? ` · v${ping.version}` : ""}`
    : ping
      ? ping.error || t("compOff")
      : t("compIdle");

  return (
    <div className={compact ? "" : "py-1"}>
      {!compact ? <p className="mb-1 text-xs text-muted">{t("compHint")}</p> : null}
      <p className={`py-2 text-[12px] ${ping?.ok ? "text-ok" : ping && !ping.ok ? "text-danger" : "text-muted"}`}>
        {status}
        {engineLink?.label ? ` · ${engineLink.label}` : ""}
        {electron ? ` · ${t("compViaApp")}` : ` · ${t("compViaCmd")}`}
      </p>

      <Field label={t("compKeep")} hint={t("compKeepH")}>
        <Switch on={keep} onChange={(v) => void toggleKeep(v)} />
      </Field>
      <Field label={t("compNetBackup")} hint={t("compNetBackupH")}>
        <Switch on={netCompiler} onChange={setNetCompiler} />
      </Field>

      {!electron ? (
        <Field label={t("compStart")} hint={t("compStartH")}>
          <div className="flex items-center gap-1">
            <code className="rounded-md border border-border bg-bg px-2 py-1 font-mono text-[11px] text-fg">{cmd}</code>
            <CopyMini text={cmd} />
          </div>
        </Field>
      ) : (
        <p className="py-2 text-xs text-muted">{t("compStartNative")}</p>
      )}

      <Field label={t("compUrl")} hint={t("compUrlH")}>
        <input
          value={url}
          placeholder={DEFAULT_COMPANION}
          className="h-8 w-56 rounded-md border border-border bg-bg px-2 text-sm text-fg"
          onChange={(e) => setUrl(e.target.value)}
        />
      </Field>
      <Field label={t("compPort")} hint={t("compPortH")}>
        <input
          inputMode="numeric"
          value={port}
          className="h-8 w-24 rounded-md border border-border bg-bg px-2 font-mono text-sm text-fg"
          onChange={(e) => setPort(e.target.value)}
        />
      </Field>
      <Field label={t("compToken")} hint={t("compPairH")}>
        <div className="flex items-center gap-1">
          <input
            type={showTok ? "text" : "password"}
            value={tok}
            placeholder="x-anvil-token"
            className="h-8 w-56 rounded-md border border-border bg-bg px-2 font-mono text-xs text-fg"
            onChange={(e) => {
              setTok(e.target.value);
              setCompanionToken(e.target.value);
            }}
          />
          <Button variant="quiet" className="h-8 px-2 text-[11px]" onClick={() => setShowTok((v) => !v)}>
            {showTok ? t("hide") : t("show")}
          </Button>
        </div>
      </Field>
      <div className="flex flex-wrap gap-1.5 py-2">
        <Button className="h-8" disabled={busy} onClick={() => void check(true)}>
          {t("compCheck")}
        </Button>
        <Button
          className="h-8"
          variant="quiet"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void pairCompanion(url || DEFAULT_COMPANION)
              .then((tkn) => {
                setTok(tkn);
                setCompanionToken(tkn);
                setNotice(t("compPaired"));
                return check(true);
              })
              .catch((err) => setNotice(err instanceof Error ? err.message : t("compPairFail")))
              .finally(() => setBusy(false));
          }}
        >
          {t("pair")}
        </Button>
      </div>

      <p className="mt-3 text-sm text-fg">{t("pkgHome")}</p>
      <p className="mt-0.5 text-xs text-muted">{t("pkgHomeH")}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <input
          value={pkgPath}
          placeholder="~/.anvil"
          className="h-8 min-w-[12rem] flex-1 rounded-md border border-border bg-bg px-2 font-mono text-[11px] text-fg"
          onChange={(e) => setPkgPath(e.target.value)}
        />
        {nativeHelper()?.pathsPick ? (
          <Button
            variant="quiet"
            className="h-8 px-2 text-[11px]"
            onClick={() => {
              void nativeHelper()
                ?.pathsPick?.("packages")
                .then((p) => {
                  const dir = p.packages || "";
                  if (!dir) return;
                  setPkgPath(dir);
                  return companionSetHome(dir, url || DEFAULT_COMPANION).then((s) => {
                    setPkgPath(s.home);
                    setNotice(t("pkgHomeOk", { path: s.home }));
                    return check(false);
                  });
                })
                .catch((err) => setNotice(err instanceof Error ? err.message : t("compOff")));
            }}
          >
            {t("pickFolder")}
          </Button>
        ) : null}
        <Button
          className="h-8"
          disabled={busy || !pkgPath.trim()}
          onClick={() => {
            setBusy(true);
            void companionSetHome(pkgPath.trim(), url || DEFAULT_COMPANION)
              .then((s) => {
                setPkgPath(s.home);
                setNotice(t("pkgHomeOk", { path: s.home }));
                return check(false);
              })
              .catch((err) => setNotice(err instanceof Error ? err.message : t("compOff")))
              .finally(() => setBusy(false));
          }}
        >
          {t("pkgHomeApply")}
        </Button>
      </div>
      {ping?.packages ? (
        <p className="mt-1 font-mono text-[10px] text-subtle">
          {t("pkgToolchain")}: {ping.packages.toolchains}
          <br />
          {t("pkgLsp")}: {ping.packages.lsp}
        </p>
      ) : ping?.toolHome ? (
        <p className="mt-1 font-mono text-[10px] text-subtle">{ping.toolHome}</p>
      ) : null}

      <p className="mt-2 text-sm text-fg">{t("compBins")}</p>
      <p className="mt-0.5 text-xs text-muted">{t("compBinsH")}</p>
      <div className="mt-1.5 divide-y divide-border rounded-md border border-border">
        {tools.map((row) => {
          const wait = installing === row.kind;
          const via = row.via === "path" ? t("compViaPath") : row.via === "anvil" ? t("compViaAnvil") : "";
          const mb =
            wait && toolPull && toolPull.total > 0
              ? t("compMb", { got: (toolPull.got / 1e6).toFixed(1), total: (toolPull.total / 1e6).toFixed(0) }) +
                (toolPull.pct ? ` · ${toolPull.pct}%` : "")
              : "";
          return (
            <div key={row.kind} className="flex items-center gap-2 px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="text-[12px] text-fg">
                  {row.label}
                  {via ? <span className={`ml-1.5 text-[10px] ${row.via === "path" ? "text-ok" : "text-accent"}`}>{via}</span> : null}
                </p>
                <p className="truncate font-mono text-[10px] text-subtle">
                  {wait
                    ? mb ||
                      (toolPull?.phase && toolPull.phase !== "done"
                        ? `${t("compPulling", { name: row.label })} ${toolPull.phase}`
                        : t("compPulling", { name: row.label }))
                    : row.ready
                      ? row.path
                      : row.about}
                </p>
                {wait && toolPull && toolPull.total > 0 ? (
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-border">
                    <div className="h-full bg-accent" style={{ width: `${toolPull.pct}%` }} />
                  </div>
                ) : null}
              </div>
              <Button
                className="h-7 px-2 text-[11px]"
                variant="quiet"
                disabled={busy || (Boolean(installing) && !wait)}
                onClick={() => (wait ? void abortTool() : void pullTool(row))}
              >
                {wait ? t("compAbort") : row.ready ? (row.via === "anvil" ? t("compRemove") : t("compViaPath")) : t("compPull")}
              </Button>
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] text-subtle">
        {ping?.ok ? t("compBinsN", { n: found.length, net: netCompiler ? t("compNetOn") : t("compNetOff") }) : t("compBinsNeed")}
        {ping?.toolHome ? ` · ${ping.toolHome}` : ""}
      </p>

      <p className="mt-3 text-sm text-fg">{t("lspTitle")}</p>
      <p className="mt-0.5 text-xs text-muted">{t("lspHint")}</p>
      <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-muted">
        <label className="flex items-center gap-1.5">
          {t("lspTimeout")}
          <select
            className="rounded-md border border-border bg-bg px-1.5 py-0.5 text-fg"
            value={lspTimeout}
            onChange={(e) => {
              setLspTimeout(Number(e.target.value));
              void import("@/lib/companion-lint").then((m) => m.scheduleCompanionLint());
            }}
          >
            {[5, 8, 12, 20].map((n) => (
              <option key={n} value={n}>
                {n}s
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          {t("lspMaxFiles")}
          <select
            className="rounded-md border border-border bg-bg px-1.5 py-0.5 text-fg"
            value={lspMaxFiles}
            onChange={(e) => {
              setLspMaxFiles(Number(e.target.value));
              void import("@/lib/companion-lint").then((m) => m.scheduleCompanionLint());
            }}
          >
            {[12, 24, 40].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ul className="mt-1.5 space-y-1">
        {(ping?.lsp ?? []).map((s) => {
          const on = lspEnabled[s.id] !== false;
          return (
            <li key={s.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1">
              <button
                type="button"
                role="switch"
                aria-checked={on}
                className={`relative h-5 w-8 shrink-0 rounded-full border ${on ? "border-accent bg-accent" : "border-border bg-bg"}`}
                onClick={() => {
                  setLspEnabled(s.id, !on);
                  void import("@/lib/companion-lint").then((m) => m.scheduleCompanionLint());
                }}
              >
                <span className={`absolute top-0.5 left-0.5 size-3.5 rounded-full bg-fg ${on ? "translate-x-[0.7rem] bg-accent-fg" : ""}`} />
              </button>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-fg">{s.label}</span>
                <span className="block text-[10px] text-subtle">
                  {s.langs} · {s.license}
                  {s.ready ? ` · ${t("lspReady")}` : ""}
                  {checkNote[s.id] ? ` · ${checkNote[s.id]}` : ""}
                </span>
              </span>
              {s.ready ? (
                <Button
                  className="h-7 shrink-0 px-2 text-[11px]"
                  variant="quiet"
                  disabled={!ping?.ok || checkId === s.id}
                  onClick={() => {
                    setCheckId(s.id);
                    void companionLspCheck(s.id, url || DEFAULT_COMPANION)
                      .then((r) => {
                        const note = r.ok ? r.version || t("lspCheckOk") : r.error || t("lspCheckFail");
                        setCheckNote((m) => ({ ...m, [s.id]: note }));
                        useIde.getState().pushLspLog(r.ok, `${s.label}: ${note}${r.hint ? ` · ${r.hint}` : ""}`);
                        setNotice(r.ok ? t("lspCheckOk") : r.error || t("lspCheckFail"));
                      })
                      .finally(() => setCheckId(""));
                  }}
                >
                  {checkId === s.id ? t("lspChecking") : t("lspCheck")}
                </Button>
              ) : (
                <Button
                  className="h-7 shrink-0 px-2 text-[11px]"
                  disabled={!ping?.ok || busy || pullId === s.id}
                  onClick={() => {
                    setPullId(s.id);
                    void companionLspPull(s.id, url || DEFAULT_COMPANION)
                      .then((r) => {
                        if (r.ok) {
                          setPing((p) => (p ? { ...p, lsp: r.servers } : p));
                          setNotice(t("lspPulled", { name: s.label }));
                          useIde.getState().pushLspLog(true, `${s.label} geholt`);
                          void import("@/lib/companion-lint").then((m) => m.refreshCompanionLint());
                        } else {
                          setNotice(r.error || t("lspPullFail"));
                          useIde.getState().pushLspLog(false, r.error || t("lspPullFail"));
                        }
                      })
                      .finally(() => setPullId(""));
                  }}
                >
                  {pullId === s.id ? t("lspPulling") : t("lspPull")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {!ping?.ok ? <p className="mt-1 text-[11px] text-subtle">{t("lspNeedComp")}</p> : null}
      {lspLog.length ? (
        <div className="mt-2">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[11px] text-muted">{t("lspLog")}</p>
            <button type="button" className="text-[10px] text-subtle hover:text-fg" onClick={() => clearLspLog()}>
              {t("lspLogClear")}
            </button>
          </div>
          <ul className="max-h-24 space-y-0.5 overflow-y-auto font-mono text-[10px]">
            {lspLog.slice(0, 6).map((l, i) => (
              <li key={`${l.at}-${i}`} className={l.ok ? "text-muted" : "text-danger"}>
                {l.text}
              </li>
            ))}
          </ul>
          <Button
            className="mt-1 h-7 px-2 text-[11px]"
            variant="quiet"
            disabled={!ping?.ok}
            onClick={() => void import("@/lib/companion-lint").then((m) => m.refreshCompanionLint())}
          >
            {t("lspRetry")}
          </Button>
        </div>
      ) : null}

      {!compact ? (
        <Field label="MCP" hint={t("compMcpH")}>
          <Button
            className="h-8"
            variant="quiet"
            onClick={() => {
              if (servers.some((s) => s.url.includes("7845"))) {
                setNotice(t("compMcpHave"));
                return;
              }
              setMcp([...servers, { id: newMcpId(), name: "Companion", url: DEFAULT_ENGINE_MCP, enabled: true }]);
              setNotice(t("compMcpOk"));
            }}
          >
            {t("compMcp")}
          </Button>
        </Field>
      ) : null}
    </div>
  );
}

function portOf(url: string) {
  try {
    return new URL(url || DEFAULT_COMPANION).port || "7845";
  } catch {
    return "7845";
  }
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm text-fg">{label}</p>
        {hint ? <p className="mt-0.5 text-xs text-muted text-pretty">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`relative h-7 w-11 rounded-full border ${on ? "border-accent bg-accent" : "border-border bg-bg"}`}
      onClick={() => onChange(!on)}
    >
      <span className={`ui-switch-knob absolute top-0.5 left-0.5 size-5 rounded-full bg-fg ${on ? "translate-x-[1.15rem] bg-accent-fg" : ""}`} />
    </button>
  );
}
