import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CtxMenu } from "@/components/ide/ctx-menu";
import { stripZipRoot, unzipFiles } from "@/lib/archive";
import { companionGit, companionInstall, companionTree, type GitStatus } from "@/lib/companion";
import { holdCompanion, releaseCompanion } from "@/lib/companion-life";
import { cloneGithub, pushGithub } from "@/lib/github";
import { openOsWorkspace } from "@/lib/workspace-open";
import { useIde } from "@/store/ide";

export function GitPane() {
  const commits = useIde((s) => s.commits);
  const pending = useIde((s) => s.pendingDiffs);
  const dirty = useIde((s) => s.dirty);
  const files = useIde((s) => s.files);
  const commit = useIde((s) => s.commit);
  const checkout = useIde((s) => s.checkout);
  const revertFile = useIde((s) => s.revertFile);
  const acceptAllDiffs = useIde((s) => s.acceptAllDiffs);
  const rejectAllDiffs = useIde((s) => s.rejectAllDiffs);
  const rejectDiff = useIde((s) => s.rejectDiff);
  const acceptDiff = useIde((s) => s.acceptDiff);
  const openFile = useIde((s) => s.openFile);
  const applyFiles = useIde((s) => s.applyFiles);
  const githubRepo = useIde((s) => s.githubRepo);
  const githubToken = useIde((s) => s.githubToken);
  const setGithubRepo = useIde((s) => s.setGithubRepo);
  const setGithubToken = useIde((s) => s.setGithubToken);
  const setNotice = useIde((s) => s.setNotice);
  const workspaceCwd = useIde((s) => s.workspaceCwd);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; path?: string; commit?: string } | null>(null);
  const [live, setLive] = useState<GitStatus | null>(null);
  const [branchName, setBranchName] = useState("");
  const dirtyPaths = Object.keys(dirty).filter(Boolean);
  const liveOn = Boolean(workspaceCwd && live?.ok && live.repo);

  async function refreshLive(cwd = workspaceCwd) {
    if (!cwd) {
      setLive(null);
      return;
    }
    await holdCompanion();
    const st = await companionGit("status", { cwd });
    setLive(st);
    if (!useIde.getState().companionKeep) await releaseCompanion();
  }

  useEffect(() => {
    void refreshLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceCwd]);

  async function pickWorkspace() {
    setBusy(true);
    try {
      const r = await openOsWorkspace();
      if (!r.ok) {
        if (r.error && r.error !== "Kein Ordner") setNotice(r.error);
        return;
      }
      if (r.skipped) setNotice(`${r.n} Dateien, ${r.skipped} übersprungen`);
      else if (r.n) setNotice(`${r.n} Dateien von ${r.cwd}`);
      await refreshLive(r.cwd);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Ordner fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function liveCommit() {
    if (!msg.trim() || !workspaceCwd) return;
    setBusy(true);
    try {
      await holdCompanion();
      const r = await companionGit("commit", { cwd: workspaceCwd, message: msg.trim() });
      if (!r.ok) setNotice(r.error || "Commit fehlgeschlagen");
      else {
        commit(msg.trim());
        setMsg("");
        setLive(r);
        setNotice("Commit");
      }
    } finally {
      if (!useIde.getState().companionKeep) await releaseCompanion();
      setBusy(false);
    }
  }

  async function cloneRepo() {
    if (!githubRepo.trim()) return;
    setBusy(true);
    try {
      let cwd = workspaceCwd;
      if (!cwd) {
        const r = await openOsWorkspace();
        if (!r.ok || !r.cwd) {
          if (r.error && r.error !== "Kein Ordner") setNotice(r.error);
          return;
        }
        cwd = r.cwd;
      }
      await holdCompanion();
      const g = await companionGit("clone", { cwd, url: githubRepo.trim() });
      if (g.ok && g.cwd) {
        useIde.getState().setWorkspaceCwd(g.cwd);
        const tree = await companionTree(g.cwd);
        if (tree.ok && tree.files) applyFiles(tree.files, tree.dirs);
        setLive(g);
        setNotice(`Clone ${g.branch || ""}`.trim());
        return;
      }
      if (g.error && /git fehlt/i.test(g.error)) {
        const inst = await companionInstall("git");
        setNotice(inst.ok ? "Git geholt. Clone nochmal." : g.error);
        return;
      }
      const r = await cloneGithub({ data: { url: githubRepo, token: githubToken } });
      const raw = atob(r.zipB64);
      const buf = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
      const pack = stripZipRoot(await unzipFiles(buf.buffer));
      applyFiles(pack);
      const first = Object.keys(pack).sort()[0];
      if (first) openFile(first);
      setNotice(`${Object.keys(pack).length} Dateien von GitHub (Zip)`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Clone fehlgeschlagen");
    } finally {
      if (!useIde.getState().companionKeep) await releaseCompanion();
      setBusy(false);
    }
  }

  async function pushRepo() {
    if (liveOn) {
      setBusy(true);
      try {
        await holdCompanion();
        const r = await companionGit("push", { cwd: workspaceCwd });
        setNotice(r.ok ? "Push" : r.error || "Push fehlgeschlagen");
        if (r.ok) await refreshLive();
      } finally {
        if (!useIde.getState().companionKeep) await releaseCompanion();
        setBusy(false);
      }
      return;
    }
    if (!githubRepo.trim() || !githubToken.trim()) {
      setNotice("Repo und Token eintragen");
      return;
    }
    setBusy(true);
    try {
      const r = await pushGithub({
        data: {
          repo: githubRepo,
          token: githubToken,
          message: msg.trim() || "Anvil commit",
          files,
        },
      });
      commit(msg.trim() || "Anvil commit");
      setMsg("");
      setNotice(`Push ${r.sha.slice(0, 7)} → ${r.repo}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Push fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  const changed = liveOn ? live?.files ?? [] : dirtyPaths.map((p) => ({ path: p, kind: "M" as const }));

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-10 items-center justify-between gap-2 px-3 text-xs font-medium tracking-wide text-muted uppercase">
        <span>Git</span>
        {liveOn ? (
          <span className="truncate font-mono text-[10px] normal-case text-ok">{live?.branch}</span>
        ) : (
          <Button className="h-7 px-2 text-[11px] font-normal normal-case" variant="quiet" disabled={busy} onClick={() => void pickWorkspace()}>
            Ordner
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-4">
        {workspaceCwd ? (
          <p className="mb-2 truncate font-mono text-[10px] text-subtle" title={workspaceCwd}>
            {workspaceCwd}
          </p>
        ) : (
          <p className="mb-2 text-xs text-subtle">Ordner wählen (Desktop) für echtes Git. Sonst Anvil-Schnappschuss.</p>
        )}
        {live?.error ? <p className="mb-2 text-xs text-danger">{live.error}</p> : null}
        {live?.error && /git fehlt/i.test(live.error) ? (
          <Button
            className="mb-3 h-8 text-xs"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void holdCompanion()
                .then(() => companionInstall("git"))
                .then((r) => {
                  setNotice(r.ok ? "Git geholt. Status neu laden." : r.stderr || "Git-Install fehlgeschlagen");
                  if (r.ok) void refreshLive();
                })
                .finally(() => {
                  setBusy(false);
                  if (!useIde.getState().companionKeep) void releaseCompanion();
                });
            }}
          >
            Git holen
          </Button>
        ) : null}
        {live && !live.repo && live.ok ? (
          <Button
            className="mb-3 h-8 text-xs"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void holdCompanion()
                .then(() => companionGit("init", { cwd: workspaceCwd }))
                .then((r) => {
                  if (r.ok) setLive(r);
                  else setNotice(r.error || "git init fehlgeschlagen");
                })
                .finally(() => {
                  setBusy(false);
                  if (!useIde.getState().companionKeep) void releaseCompanion();
                });
            }}
          >
            git init
          </Button>
        ) : null}

        {pending.length > 0 ? (
          <div className="mb-4">
            <p className="mb-2 text-xs text-muted">Agent-Änderungen</p>
            {pending.map((d) => (
              <div key={d.path} className="mb-2 rounded-md border border-border bg-bg p-2">
                <button type="button" className="font-mono text-xs text-fg" onClick={() => openFile(d.path)}>
                  {d.path}
                </button>
                <div className="mt-1 flex gap-1">
                  <Button className="h-7 px-2 text-xs" variant="primary" onClick={() => acceptDiff(d.path)}>
                    Übernehmen
                  </Button>
                  <Button className="h-7 px-2 text-xs" onClick={() => rejectDiff(d.path)}>
                    Verwerfen
                  </Button>
                </div>
              </div>
            ))}
            <div className="flex gap-1">
              <Button className="h-8 text-xs" variant="primary" onClick={acceptAllDiffs}>
                Alle übernehmen
              </Button>
              <Button className="h-8 text-xs" onClick={rejectAllDiffs}>
                Alle verwerfen
              </Button>
            </div>
          </div>
        ) : null}

        {liveOn && (live?.branches?.length ?? 0) > 1 ? (
          <label className="mb-2 block text-xs text-muted">
            Branch
            <select
              className="mt-1 h-8 w-full rounded-md border border-border bg-bg px-2 font-mono text-xs text-fg"
              value={live?.branch}
              onChange={(e) => {
                const b = e.target.value;
                setBusy(true);
                void holdCompanion()
                  .then(() => companionGit("checkout", { cwd: workspaceCwd, branch: b }))
                  .then((r) => {
                    if (r.ok) {
                      setLive(r);
                      if (r.cwd) void companionTree(r.cwd).then((t) => t.ok && t.files && applyFiles(t.files, t.dirs));
                    } else setNotice(r.error || "Checkout fehlgeschlagen");
                  })
                  .finally(() => {
                    setBusy(false);
                    if (!useIde.getState().companionKeep) void releaseCompanion();
                  });
              }}
            >
              {(live?.branches ?? []).map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <p className="mb-1 text-xs text-muted">Geändert{changed.length ? ` · ${changed.length}` : ""}</p>
        {changed.length === 0 ? (
          <p className="mb-3 text-xs text-subtle">Nichts zu committen</p>
        ) : (
          <>
            <ul className="mb-2 space-y-0.5">
              {changed.map((row) => (
                <li key={row.path}>
                  <button
                    type="button"
                    className="block w-full truncate rounded-sm px-1 py-0.5 text-left font-mono text-xs text-fg hover:bg-hover"
                    onClick={() => openFile(row.path)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, path: row.path });
                    }}
                  >
                    {row.kind} {row.path}
                  </button>
                </li>
              ))}
            </ul>
            <Button className="mb-3 h-8 text-xs" onClick={() => void import("@/lib/fix-agent").then((m) => m.askGit())}>
              Diff → Agent
            </Button>
          </>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!msg.trim()) return;
            if (liveOn) void liveCommit();
            else {
              commit(msg);
              setMsg("");
            }
          }}
        >
          <input
            value={msg}
            placeholder="Commit-Nachricht"
            className="h-9 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none placeholder:text-subtle focus:ring-2 focus:ring-ring"
            onChange={(e) => setMsg(e.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <Button
              className="h-8 flex-1 text-xs"
              disabled={!changed.length || busy}
              onClick={() => {
                setBusy(true);
                const snip = changed
                  .slice(0, 5)
                  .map((p) => `${p.path}\n${(files[p.path] ?? "").slice(0, 200)}`)
                  .join("\n");
                void import("@/lib/brain")
                  .then((b) => b.brainCommitMessage(changed.map((x) => x.path), snip))
                  .then((m) => setMsg(m))
                  .finally(() => setBusy(false));
              }}
            >
              Nachricht vorschlagen
            </Button>
            <Button type="submit" className="h-8 flex-1 text-xs" variant="primary" disabled={!msg.trim() || busy}>
              Commit
            </Button>
          </div>
        </form>

        {liveOn ? (
          <div className="mt-2 flex gap-1">
            <Button
              className="h-8 flex-1 text-xs"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void holdCompanion()
                  .then(() => companionGit("pull", { cwd: workspaceCwd }))
                  .then((r) => {
                    setNotice(r.ok ? "Pull" : r.error || "Pull fehlgeschlagen");
                    if (r.ok) setLive(r);
                  })
                  .finally(() => {
                    setBusy(false);
                    if (!useIde.getState().companionKeep) void releaseCompanion();
                  });
              }}
            >
              Pull
            </Button>
            <Button className="h-8 flex-1 text-xs" variant="primary" disabled={busy} onClick={() => void pushRepo()}>
              Push
            </Button>
          </div>
        ) : null}

        {liveOn ? (
          <div className="mt-2 flex gap-1">
            <Button
              className="h-8 flex-1 text-xs"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void holdCompanion()
                  .then(() => companionGit("stash", { cwd: workspaceCwd, message: msg.trim() }))
                  .then((r) => {
                    if (r.ok) {
                      setLive(r);
                      setNotice("Stash");
                    } else setNotice(r.error || "Stash fehlgeschlagen");
                  })
                  .finally(() => {
                    setBusy(false);
                    if (!useIde.getState().companionKeep) void releaseCompanion();
                  });
              }}
            >
              Stash
            </Button>
            <Button
              className="h-8 flex-1 text-xs"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void holdCompanion()
                  .then(() => companionGit("stash-pop", { cwd: workspaceCwd }))
                  .then((r) => {
                    if (r.ok) {
                      setLive(r);
                      if (r.cwd) void companionTree(r.cwd).then((t) => t.ok && t.files && applyFiles(t.files, t.dirs));
                      setNotice("Stash holen");
                    } else setNotice(r.error || "Stash pop fehlgeschlagen");
                  })
                  .finally(() => {
                    setBusy(false);
                    if (!useIde.getState().companionKeep) void releaseCompanion();
                  });
              }}
            >
              Stash holen
            </Button>
          </div>
        ) : null}

        {liveOn ? (
          <form
            className="mt-2 flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!branchName.trim()) return;
              setBusy(true);
              void holdCompanion()
                .then(() => companionGit("branch", { cwd: workspaceCwd, branch: branchName.trim() }))
                .then((r) => {
                  if (r.ok) {
                    setLive(r);
                    setBranchName("");
                    if (r.cwd) void companionTree(r.cwd).then((t) => t.ok && t.files && applyFiles(t.files, t.dirs));
                  } else setNotice(r.error || "Branch fehlgeschlagen");
                })
                .finally(() => {
                  setBusy(false);
                  if (!useIde.getState().companionKeep) void releaseCompanion();
                });
            }}
          >
            <input
              value={branchName}
              placeholder="Neuer Branch"
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 font-mono text-xs text-fg"
              onChange={(e) => setBranchName(e.target.value)}
            />
            <Button type="submit" className="h-8 px-2 text-xs" disabled={busy || !branchName.trim()}>
              Branch
            </Button>
          </form>
        ) : null}

        <p className="mt-4 mb-1 text-xs text-muted">Verlauf</p>
        {(liveOn ? live?.log ?? [] : commits).length === 0 ? (
          <p className="text-xs text-subtle">Noch keine Commits</p>
        ) : liveOn ? (
          <ul className="space-y-2">
            {(live?.log ?? []).map((c) => (
              <li key={c.hash} className="text-xs">
                <p className="text-fg">{c.message}</p>
                <p className="font-mono text-subtle tabular-nums">
                  {c.hash.slice(0, 7)} · {new Date(c.at).toLocaleString("de")}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="space-y-2">
            {[...commits].reverse().map((c) => (
              <li key={c.id} className="text-xs">
                <button
                  type="button"
                  className="block w-full rounded-sm px-1 py-0.5 text-left hover:bg-hover"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, commit: c.id });
                  }}
                >
                  <p className="text-fg">{c.message}</p>
                  <p className="font-mono text-subtle tabular-nums">
                    {new Date(c.at).toLocaleString("de")}
                    {c.paths?.length ? ` · ${c.paths.length} Dateien` : ""}
                  </p>
                </button>
                {c.snap ? (
                  <button type="button" className="px-1 text-muted hover:text-fg" onClick={() => checkout(c.id)}>
                    Wiederherstellen
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <details className="mt-5">
          <summary className="cursor-pointer text-xs text-muted">GitHub</summary>
          <div className="mt-2">
            <input
              value={githubRepo}
              placeholder="owner/repo oder URL"
              className="mb-1.5 h-9 w-full rounded-md border border-border bg-bg px-2 font-mono text-xs text-fg outline-none placeholder:text-subtle"
              onChange={(e) => setGithubRepo(e.target.value)}
            />
            <input
              type="password"
              value={githubToken}
              placeholder="Token (privat / Push)"
              className="mb-2 h-9 w-full rounded-md border border-border bg-bg px-2 font-mono text-xs text-fg outline-none placeholder:text-subtle"
              onChange={(e) => setGithubToken(e.target.value)}
            />
            <div className="flex gap-1">
              <Button className="h-8 flex-1 text-xs" disabled={busy || !githubRepo.trim()} onClick={() => void cloneRepo()}>
                Clone
              </Button>
              <Button className="h-8 flex-1 text-xs" variant="primary" disabled={busy} onClick={() => void pushRepo()}>
                Push
              </Button>
            </div>
          </div>
        </details>
      </div>
      {menu ? (
        <CtxMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={
            menu.path
              ? [
                  { label: "Öffnen", onClick: () => openFile(menu.path!) },
                  { label: "Pfad kopieren", onClick: () => void navigator.clipboard.writeText(menu.path!) },
                  { label: "Diff an den Agenten", onClick: () => void import("@/lib/fix-agent").then((m) => m.askGit()) },
                  { sep: true, label: "" },
                  { label: "Änderung verwerfen", danger: true, onClick: () => revertFile(menu.path!) },
                ]
              : menu.commit
                ? [
                    {
                      label: "Wiederherstellen",
                      onClick: () => checkout(menu.commit!),
                    },
                    {
                      label: "Nachricht kopieren",
                      onClick: () => {
                        const c = commits.find((x) => x.id === menu.commit);
                        if (c) void navigator.clipboard.writeText(c.message);
                      },
                    },
                  ]
                : []
          }
        />
      ) : null}
    </div>
  );
}
