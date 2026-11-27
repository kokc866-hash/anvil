import { nativeHelper } from "./helper-local";
import type { RestoreDiskPlan } from "./restore-plan";
import type { WorkspaceFileQuery, WorkspaceFileVerification } from "./workspace-file-proof";

export type WorkspaceResultFile = { path: string; size: number; modified: number };
export type WorkspaceResults = { ok: true; outputFolder: string; results: WorkspaceResultFile[]; entries?: WorkspaceResultFile[]; directories?: string[]; truncated: boolean };

export type WorkspaceDiskRequest = { root: string } & (
  | { action: "tree" }
  | { action: "results" }
  | ({ action: "verifyFile" } & WorkspaceFileQuery)
  | { action: "resultDestination"; path: string; directory: boolean }
  | { action: "resultReveal"; path: string }
  | { action: "empty" }
  | { action: "read"; paths: string[] }
  | { action: "write"; path: string; content: string; expected?: string | null }
  | { action: "move"; from: string; to: string }
  | { action: "mkdir" | "remove"; path: string }
  | ({ action: "restore" } & RestoreDiskPlan)
);

type WorkspaceTree = { ok: true; cwd: string; files: Record<string, string>; dirs: string[]; n: number; skipped: number; empty?: boolean };
type WorkspaceRead = { ok: true; files: Record<string, string | null> };
type WorkspaceRestore = { ok: true; removedDirs: string[] };
type WorkspaceResult = { ok: true } | { ok: false; error: string };

export async function verifyWorkspaceDiskFile(root: string, query: WorkspaceFileQuery): Promise<WorkspaceFileVerification> {
  const disk = nativeHelper()?.workspaceDisk;
  if (!disk) return { ok: false, error: "Lokaler Projektzugriff ist in dieser Anvil-Version nicht verfügbar." };
  return await disk({ root, action: "verifyFile", ...query }) as WorkspaceFileVerification;
}

export function workspaceDisk(request: Extract<WorkspaceDiskRequest, { action: "tree" }>): Promise<WorkspaceTree>;
export function workspaceDisk(request: Extract<WorkspaceDiskRequest, { action: "results" }>): Promise<WorkspaceResults>;
export function workspaceDisk(request: Extract<WorkspaceDiskRequest, { action: "resultDestination" }>): Promise<{ ok: true; path: string }>;
export function workspaceDisk(request: Extract<WorkspaceDiskRequest, { action: "empty" }>): Promise<{ ok: true; empty: boolean }>;
export function workspaceDisk(request: Extract<WorkspaceDiskRequest, { action: "read" }>): Promise<WorkspaceRead>;
export function workspaceDisk(request: Extract<WorkspaceDiskRequest, { action: "restore" }>): Promise<WorkspaceRestore>;
export function workspaceDisk(request: WorkspaceDiskRequest): Promise<{ ok: true }>;
export async function workspaceDisk(request: WorkspaceDiskRequest): Promise<WorkspaceResult> {
  const disk = nativeHelper()?.workspaceDisk;
  if (!disk) throw new Error("Lokaler Projektzugriff ist in dieser Anvil-Version nicht verfügbar.");
  const result = await disk(request);
  if (!result.ok) throw new Error(result.error || "Der lokale Projektordner ist nicht verfügbar.");
  return result;
}
