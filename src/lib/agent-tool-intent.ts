type Args = Record<string, unknown>;

/** Recognize opaque mutation-capable tools in an explicitly observation-only
 * task. This is a task contract, not an OS sandbox for executed programs. */
export function changesTaskState(name: string, args: Args): boolean {
  if (/^(write_file|append_file|edit_file|delete_file|rename|mkdir|format_file|git_clone|git_commit|git_push|harness_write|graph_write|board_write|board_reset|memory_add|memory_forget|skill_write|skill_patch|skill_outcome|debug_eval)$/.test(name)) return true;
  if (name === 'mcp_call') {
    const tool = String(args.name || '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
    if (/(?:^|[._-])(?:execute|exec|run_code|run_script|eval|repair|fix|create|update|edit|write|delete|remove|save|add|set|import|export|move|rotate|transform|recompute|open|close)(?:[._-]|$)/.test(tool)) return true;
    // Discover a purpose-built reader rather than passing arbitrary code to a
    // CAD service under a no-changes instruction. Server metadata is not a new
    // authorization from the human and cannot override this task restriction.
    return !/(?:^|[._-])(?:get|list|read|search|query|inspect|describe|check|test|validate|status|health|ping|fetch|find|lookup|count|preview)(?:[._-]|$)/.test(tool);
  }
  if (name === 'shell') {
    const command = String(args.command || '');
    return /\b(?:node|python[\d.]*)\b[^\n]*\s(?:-e|-c|--eval|--print)\b/i.test(command)
      || /\b(?:powershell|pwsh|cmd)\b[^\n]*\s(?:-command|-c|\/c)\b/i.test(command)
      || /(?:^|[;&|]\s*|\s)(?:rm|del|erase|rmdir|ren|rename|move|mv|copy|cp|mkdir|touch|patch|remove-item|move-item|copy-item|new-item|set-item|set-content|add-content|clear-content|out-file)\b/i.test(command)
      || /\bgit\s+(?:commit|push|reset|restore|clean|checkout|switch|merge|rebase|cherry-pick|apply|am|revert)\b/i.test(command)
      || /\bsed\s+[^\n]*(?:-i|--in-place)\b/i.test(command)
      || /(?<!>)>{1,2}(?![>&])\s*[^\s&|]/.test(command)
      || /\b(?:npm|pip|pip3|pnpm|yarn)\s+(?:install|add|remove|uninstall)\b/i.test(command);
  }
  return false;
}
