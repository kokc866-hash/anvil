export type WorkspaceFileQuery = {
  path: string;
  width?: number;
  height?: number;
  versionOnly?: boolean;
};

export type WorkspaceFileProof = {
  version: string;
  sha256: string;
  size: number;
  width?: number;
  height?: number;
};

export type WorkspaceFileVerification =
  | ({ ok: true; path: string } & (WorkspaceFileProof | Pick<WorkspaceFileProof, "version" | "size">))
  | { ok: false; path?: string; error: string; size?: number; width?: number; height?: number };

export type VerifyWorkspaceFile = (query: WorkspaceFileQuery) => Promise<WorkspaceFileVerification>;

export function validWorkspaceFileProof(value: unknown): value is WorkspaceFileProof {
  if (!value || typeof value !== "object") return false;
  const { version, sha256, size, width, height } = value as Partial<WorkspaceFileProof>;
  const digest = (field: unknown) => typeof field === "string" && /^[a-f\d]{64}$/.test(field);
  const dimension = (field: unknown) => Number.isInteger(field) && Number(field) > 0 && Number(field) <= 0x7fffffff;
  return digest(version) && digest(sha256) && Number.isSafeInteger(size) && Number(size) >= 0
    && (width === undefined && height === undefined || dimension(width) && dimension(height));
}
