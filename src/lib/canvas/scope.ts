export function canvasScope(state: {
  workspaceCwd?: string;
  diskName?: string;
  githubRepo?: string;
}) {
  return state.workspaceCwd || state.githubRepo || state.diskName || "workspace";
}
