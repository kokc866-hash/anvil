import { hasAsciiControl } from './text-controls.mjs';

// Native names are checked against AGENT_TOOLS in skill-validation.test.ts.
// They describe Anvil's interface, never the permissions of a particular task.
export const ANVIL_SKILL_TOOL_NAMES = 'select_tools list_files read_file verify_file review_read_baseline review_submit read_tool_output write_file append_file edit_file delete_file mkdir rename run_file see_run play format_file open_preview git_status git_commit git_push git_clone shell fetch_url debug_start debug_continue debug_step debug_stop debug_breakpoint debug_eval debug_state debug_watch memory_list memory_add memory_forget skill_list skill_write skill_read skill_run skill_debug skill_patch skill_outcome set_plan ask_user mcp_list mcp_call mcp_read_resource mcp_read_output engine_detect engine_status engine_run harness_read harness_write graph_write board_read board_open board_reset board_write grep'.split(' ');

/** @typedef {'pass'|'fail'|'unverified'} CheckState */
/** @typedef {{format:'pass'|'fail',references:CheckState,tools:CheckState,behavior:'unverified'}} SkillChecks */
/** @typedef {{resources?:string[]|Record<string,string>,baseDirectory?:string,files?:Record<string,string>,knownTools?:string[]}} SkillCheckOptions */

/** Examples are data, not instructions to validate as live calls or resources.
 * @param {string} text */
function withoutFences(text) {
  let fence = '';
  return text.split(/\r?\n/).map(line => {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (match) {
      if (!fence) fence = match[1];
      else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = '';
      return '';
    }
    return fence ? '' : line;
  }).join('\n');
}

/** @param {string} text */
function resourceReferences(text) {
  const clean = withoutFences(text), paths = new Set();
  /** @param {string} value
   * @param {boolean} [prose] */
  const add = (value, prose = false) => {
    let path = value.trim().replace(/^<|>$/g, '').split(/[?#]/)[0].replace(/^\.\//, '');
    // Sentence punctuation may follow an unquoted path. A literal dot segment
    // must survive normalization so traversal is rejected rather than repaired.
    if (prose) path = path.replace(/[.!?,;:]+$/, (suffix, offset) => path.slice(0, offset).endsWith('/') ? suffix : '');
    if (path && !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(path)) paths.add(path);
  };
  for (const match of clean.matchAll(/\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^)]*)?\)/g)) add(match[1] || match[2]);
  for (const match of clean.matchAll(/(?:^|[\s`"'(:=])((?:\.\/)?(?:references|assets|scripts)\/[^\s`"'<>()[\]{};,]+)/g)) add(match[1], true);
  return [...paths];
}

/** @param {string} path */
function safeResource(path) {
  const relative = path.endsWith('/') ? path.slice(0, -1) : path;
  return !/[\\:]/.test(path) && !hasAsciiControl(path, true) && !path.startsWith('/') && relative.split('/').every(part => part && part !== '.' && part !== '..');
}

/** Literal package-relative resources used by the live instructions; fenced examples excluded.
 * Unsafe paths are diagnosed by debugKnowledgeSkill and never returned as usable resources.
 * @param {string} body
 * @returns {string[]} */
export function skillReferencePaths(body) { return resourceReferences(String(body || '')).filter(safeResource); }

/** @param {{name?:string,when?:string,body?:string,fails?:number,resources?:string[],baseDirectory?:string}} skill
 * @param {SkillCheckOptions} [options]
 * @returns {{ok:boolean,issues:string[],warnings:string[],checks:SkillChecks}} */
export function debugKnowledgeSkill(skill, options = {}) {
  const issues = [], warnings = [];
  const name = String(skill?.name || '').trim(), when = String(skill?.when || '').trim(), body = String(skill?.body || '').trim();
  /** @type {SkillChecks} */
  const checks = { format: 'pass', references: 'pass', tools: 'pass', behavior: 'unverified' };
  if (typeof skill?.name !== 'string' || typeof skill?.when !== 'string' || typeof skill?.body !== 'string') issues.push('Name, Beschreibung und Anleitung müssen Text sein.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) issues.push('Name benötigt kleine Buchstaben/Ziffern und Bindestriche, maximal 64 Zeichen.');
  if (!when || when.length > 1024) issues.push('Beschreibung darf nicht leer sein und höchstens 1024 Zeichen umfassen.');
  if (body.length < 8) issues.push('Anweisung fehlt oder ist zu kurz.');
  if (issues.length) checks.format = 'fail';

  const references = resourceReferences(body), base = String(options.baseDirectory || skill?.baseDirectory || '').replace(/\/$/, '');
  const resources = options.resources ?? skill?.resources;
  const declared = resources === undefined ? undefined : new Map((Array.isArray(resources) ? resources.map(path => [path, undefined]) : Object.entries(resources)).map(([key, content]) => {
    const path = String(key).replaceAll('\\', '/');
    const relative = base && path.startsWith(base + '/') ? path.slice(base.length + 1) : path.replace(/^\.\//, '');
    return [relative, typeof content === 'string'];
  }));
  for (const resource of references) {
    if (!safeResource(resource)) { issues.push(`Unsicherer Ressourcenpfad: ${resource}`); checks.references = 'fail'; continue; }
    if (!declared) {
      if (checks.references !== 'fail') checks.references = 'unverified';
      continue;
    }
    const candidates = resource.endsWith('/')
      ? [...declared.keys()].filter(path => path.startsWith(resource) && !path.endsWith('/') && safeResource(path))
      : [resource];
    const exists = candidates.some(path => declared.has(path) && (!options.files || declared.get(path) || Object.hasOwn(options.files, base ? `${base}/${path}` : path)));
    if (!exists) { issues.push(`Referenz fehlt im Skill-Paket: ${resource}`); checks.references = 'fail'; }
  }
  if (checks.references === 'unverified') warnings.push('Referenzen noch nicht geprüft: Es fehlt der aktuelle Ressourcenindex des Skills.');

  const known = new Set(options.knownTools || ANVIL_SKILL_TOOL_NAMES), clean = withoutFences(body);
  const dynamic = /\bMCP\b|mcp_(?:list|call)|Werkzeugkatalog|Dienstwerkzeug|current catalog|service tool/i.test(clean);
  const fields = new Set(['expected_exit_code', 'overwrite_reason', 'project_root', 'base_directory', 'solid_count', 'input_schema', 'inputSchema', 'is_error', 'bl_idname', 'use_selection', 'use_active_scene']);
  /** @type {Map<string,boolean>} */
  const names = new Map();
  for (const match of clean.matchAll(/`([^`\n]+)`/g)) {
    const code = match[1].trim(), nameMatch = code.match(/^([a-z][a-z0-9_]*)(?:\s*\(|$)/);
    if (!nameMatch || fields.has(nameMatch[1])) continue;
    const tool = nameMatch[1];
    // An inline function call may be Python, GDScript or project code. Only an
    // actual tool claim below is explicit; underscore spelling proves nothing.
    if (known.has(tool) || dynamic && tool.includes('_')) names.set(tool, false);
  }
  for (const match of clean.matchAll(/(?:Werkzeug|Tool)\s+`?([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`?/gi)) names.set(match[1], true);
  const nativeClaims = new Set([...clean.matchAll(/\b(?:Anvil(?:['’]s|s)?[- ](?:Werkzeug|Tool)|native[nrs]?\s+(?:Werkzeug|Tool)|(?:Werkzeug|Tool)\s+(?:von|in)\s+Anvil)\s+`?([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`?/gi)].map(match => match[1]));
  for (const tool of nativeClaims) names.set(tool, true);
  if (!names.size) checks.tools = 'unverified';
  for (const [tool, explicit] of names) {
    if (known.has(tool)) continue;
    if (!nativeClaims.has(tool) && (dynamic || !explicit)) {
      if (checks.tools !== 'fail') checks.tools = 'unverified';
      warnings.push(dynamic ? `Dienstwerkzeug ${tool}: Name und Parameter im aktuellen Katalog prüfen.` : `Kennung ${tool}: Als Werkzeug nicht geprüft.`);
    } else { issues.push(`Unbekanntes Anvil-Werkzeug: ${tool}`); checks.tools = 'fail'; }
  }
  return { ok: issues.length === 0, issues, warnings: [...new Set(warnings)], checks };
}
