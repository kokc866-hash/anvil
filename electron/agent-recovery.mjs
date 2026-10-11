/** A skipped action stays unknown. Skipping neither confirms it nor permits replay. */
export const uncertainOperation = op => op?.external === true && ['unclear', 'started'].includes(op.status);

/** Native effects are blocked by tool, even if a worker changes its arguments. */
export function recoveryAction(name, target) {
  if (name === 'mcp_call') return `mcp:${target}`;
  if (name === 'shell') return 'shell';
  if (name === 'engine_run') return 'engine:run';
  if (name.startsWith('git_')) return `git:${name.slice(4)}`;
  const knowledge = { memory_add: 'add', memory_forget: 'forget', skill_write: 'write', skill_patch: 'patch', skill_outcome: 'outcome' };
  if (knowledge[name]) return `knowledge:${knowledge[name]}`;
  if (name.startsWith('debug_')) return `debug:${name.slice(6)}`;
}

export function workflowRecoveryBlocks(workflow) {
  return [...new Set((workflow?.operations || []).filter(op => uncertainOperation(op) && op.recovery?.mode === 'skip')
    .map(op => recoveryAction(op.name, op.target)).filter(Boolean))];
}

export function nativeRecoveryAction(op) {
  if (op.kind === 'mcp') return op.action === 'call' || op.action === undefined && op.name ? `mcp:${op.name}` : undefined;
  if (op.kind === 'shell') return 'shell';
  if (['git', 'engine', 'knowledge', 'debug'].includes(op.kind)) return `${op.kind}:${op.action || '*'}`;
}

export function recoveryVerification(state) {
  return state.verification?.state === 'failed' || !state.recoveryBlockedActions?.length ? state.verification : { state: 'stale' };
}
