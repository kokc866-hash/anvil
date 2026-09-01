import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CtxMenu } from "@/components/ide/ctx-menu";
import { stripZipRoot, unzipFiles } from "@/lib/archive";
import { cloneGithub, pushGithub } from "@/lib/github";
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
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; path?: string; commit?: string } | null>(null);
  const dirtyPaths = Object.keys(dirty).filter(Boolean);

  async function cloneRepo() {
    if (!githubRepo.trim()) return;
    setBusy(true);
    try {
      const r = await cloneGithub({ data: { url: githubRepo, token: githubToken } });
      const raw = atob(r.zipB64);
      const buf = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
      const pack = stripZipRoot(await unzipFiles(buf.buffer));
      applyFiles(pack);
      const first = Object.keys(pack).sort()[0];
      if (first) openFile(first);
      setNotice(`${Object.keys(pack).length} Dateien von GitHub`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Clone fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function pushRepo() {
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-10 items-center px-3 text-xs font-medium tracking-wide text-muted uppercase">Git</div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-4">
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

        <p className="mb-1 text-xs text-muted">Geändert{dirtyPaths.length ? ` · ${dirtyPaths.length}` : ""}</p>
        {dirtyPaths.length === 0 ? (
          <p className="mb-3 text-xs text-subtle">Nichts zu committen</p>
        ) : (
          <>
            <ul className="mb-2 space-y-0.5">
              {dirtyPaths.map((p) => (
                <li key={p}>
                  <button
                    type="button"
                    className="block w-full truncate rounded-sm px-1 py-0.5 text-left font-mono text-xs text-fg hover:bg-hover"
                    onClick={() => openFile(p)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, path: p });
                    }}
                  >
                    M {p}
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
            commit(msg);
            setMsg("");
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
              disabled={!dirtyPaths.length || busy}
              onClick={() => {
                setBusy(true);
                const snip = dirtyPaths
                  .slice(0, 5)
                  .map((p) => `${p}\n${(files[p] ?? "").slice(0, 200)}`)
                  .join("\n");
                void import("@/lib/brain")
                  .then((b) => b.brainCommitMessage(dirtyPaths, snip))
                  .then((m) => setMsg(m))
                  .finally(() => setBusy(false));
              }}
            >
              Nachricht vorschlagen
            </Button>
            <Button type="submit" className="h-8 flex-1 text-xs" variant="primary" disabled={!msg.trim()}>
              Commit
            </Button>
          </div>
        </form>

        <p className="mt-4 mb-1 text-xs text-muted">Verlauf</p>
        {commits.length === 0 ? (
          <p className="text-xs text-subtle">Noch keine Commits</p>
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
