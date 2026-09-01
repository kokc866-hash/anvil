import { createServerFn } from "@tanstack/react-start";
import { sameOriginMiddleware } from "@/lib/auth/middleware";

function parseRepo(url: string): { owner: string; repo: string; branch: string } {
  const u = url.trim().replace(/\.git$/, "");
  const m =
    u.match(/github\.com[/:]([^/]+)\/([^/#?]+)/i) ||
    u.match(/^([^/]+)\/([^/#?]+)$/);
  if (!m) throw new Error("GitHub-URL oder owner/repo erwartet.");
  const branchM = u.match(/tree\/([^/]+)/);
  return { owner: m[1], repo: m[2], branch: branchM?.[1] ?? "main" };
}

export const cloneGithub = createServerFn({ method: "POST" })
  .middleware([sameOriginMiddleware])
  .validator((input: { url: string; token?: string }) => input)
  .handler(async ({ data }) => {
    const { owner, repo, branch } = parseRepo(data.url);
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (data.token?.trim()) headers.Authorization = `Bearer ${data.token.trim()}`;
    let used = branch;
    let res = await fetch(`https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${used}`, { headers });
    if (!res.ok && used === "main") {
      used = "master";
      res = await fetch(`https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${used}`, { headers });
    }
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`GitHub ${res.status}: ${t.slice(0, 180)}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > 8_000_000) throw new Error("Repo zu groß (max 8 MB Zip).");
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return { ok: true as const, owner, repo, branch: used, zipB64: btoa(bin) };
  });

export const pushGithub = createServerFn({ method: "POST" })
  .middleware([sameOriginMiddleware])
  .validator((input: { repo: string; token: string; message: string; files: Record<string, string>; branch?: string }) => input)
  .handler(async ({ data }) => {
    const { owner, repo } = parseRepo(data.repo);
    const token = data.token.trim();
    if (!token) throw new Error("GitHub-Token fehlt.");
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const branch = data.branch || "main";
    const api = (path: string, init?: RequestInit) =>
      fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, { ...init, headers: { ...headers, ...(init?.headers as object) } });

    const refRes = await api(`/git/ref/heads/${branch}`);
    if (!refRes.ok) {
      const t = await refRes.text();
      throw new Error(`Branch ${branch}: ${t.slice(0, 180)}`);
    }
    const ref = (await refRes.json()) as { object: { sha: string } };
    const commitRes = await api(`/git/commits/${ref.object.sha}`);
    const commit = (await commitRes.json()) as { tree: { sha: string }; sha: string };
    const treeRes = await api(`/git/trees`, {
      method: "POST",
      body: JSON.stringify({
        base_tree: commit.tree.sha,
        tree: Object.entries(data.files).map(([path, content]) => ({
          path,
          mode: "100644",
          type: "blob",
          content,
        })),
      }),
    });
    if (!treeRes.ok) throw new Error(`Tree: ${(await treeRes.text()).slice(0, 180)}`);
    const tree = (await treeRes.json()) as { sha: string };
    const nextRes = await api(`/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: data.message || "Anvil commit",
        tree: tree.sha,
        parents: [commit.sha],
      }),
    });
    if (!nextRes.ok) throw new Error(`Commit: ${(await nextRes.text()).slice(0, 180)}`);
    const next = (await nextRes.json()) as { sha: string };
    const patch = await api(`/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: next.sha }),
    });
    if (!patch.ok) throw new Error(`Push: ${(await patch.text()).slice(0, 180)}`);
    return { ok: true as const, sha: next.sha, repo: `${owner}/${repo}` };
  });
