import { capabilityHasTopic, capabilityTerms } from './capability-search.ts';
import type { AnvilSkill, SkillEnvironment, SkillRecord } from './skill-library.ts';

export const SKILL_PRESELECT_LIMIT = 2;
const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordHit = (query: string, term: string) => Boolean(term.trim()) && new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped(normalize(term).trim())}(?=$|[^\\p{L}\\p{N}_])`, 'u').test(query);

/** Examples are task data. Negative symptoms ("does not work") remain task context. */
function taskText(query: string) {
  let text = query.match(/\n\n(?:Mein Auftrag|My task): ([\s\S]+)$/)?.[1] || query;
  text = text.replace(/```[^\n]*\n[\s\S]*?(?:```|$)|~~~[^\n]*\n[\s\S]*?(?:~~~|$)/g, ' ')
    .replace(/^\s*>[^\n]*/gm, ' ')
    .replace(/\b(?:beispiel(?:text)?|example|zitat|quoted|log|ausgabe|fehlermeldung|prompt)[^\n"„]{0,30}["„][^"“\n]*["“]/gi, ' ')
    .replace(/["„]([^"“\n]*)["“]/g, (all, value: string, index: number, source: string) => /^\$[a-z0-9-]+$/i.test(value) && /(?:nutze|verwende|benutze|use)\s*$/i.test(source.slice(Math.max(0, index - 30), index)) ? value : ' ')
    .replace(/`([^`\n]+)`/g, (all, value: string, index: number, source: string) => /^\$[a-z0-9-]+$/i.test(value) && /(?:nutze|verwende|benutze|use)\s*$/i.test(source.slice(Math.max(0, index - 30), index)) ? value : ' ');
  const excluded: string[] = [];
  const clauses = text.split(/[.!?;\n]+|,\s*(?=(?:not|nicht|ohne|without|kein\w*|no)\b)|\b(?:and|und)\s+(?=(?:not|nicht|kein\w*|no)\b)|\b(?:aber|but|sondern|instead)\b/i).map(clause => {
    const q = clause.toLowerCase().replace(/\b(?:nicht (?:nur|bloß)|not (?:only|just))\b/g, value => ' '.repeat(value.length));
    const useVerb = /\b(?:nutz\w*|verwend\w*|benutz\w*|einsetzen|use|using|run|execute)\b/.test(q);
    const not = /\b(?:nicht|not)\b/.exec(q);
    if (not && (useVerb || /^\s*(?:bitte\s+|please\s+)?(?:nicht|not)\b/.test(q))) {
      excluded.push(clause); return ' ';
    }
    const negative = /\b(?:weder|ohne|without|avoid|kein(?:e|en|em|er|es)?|no|never|do not|don['’]t|dont|not|nicht)\b/.exec(q);
    if (!negative) return clause;
    excluded.push(clause.slice(negative.index));
    return clause.slice(0, negative.index);
  });
  const positive = clauses.join(' ');
  return { positive, query: normalize(positive), clauses: clauses.map(normalize), excluded: normalize(excluded.join(' ')) };
}

/** A planner's task graph is not a request to maintain software packages. */
function packageMaintenance(clauses: string[], excluded: string) {
  const dependency = /\b(?:abhangigkeit\w*|dependenc(?:y|ies))\b/;
  const software = /\b(?:npm|pnpm|yarn|bun|pip|pipenv|poetry|cargo|nuget|maven|gradle|composer|bibliothek\w*|librar(?:y|ies)|paket\w*|packages?|lockfiles?|requirements|pyproject)\b/;
  const maintain = /\b(?:aktualisier\w*|updat\w*|upgrad\w*|pruf\w*|check\w*|review\w*|audit\w*|pfleg\w*|maintain\w*|installier\w*|install\w*|security|sicherheits\w*|vulnerab\w*)\b/;
  const security = /\b(?:sicherheitsupdates?|sicherheitsluck\w*|security updates?|vulnerabilit\w*)\b/;
  const graph = /\b(?:(?:aufgaben|prozess)[- ]?abhangigkeit\w*|(?:task|job|process)[- ]dependenc\w*|zyklisch\w*|cycles?|acyclic|dag|graph)\b|\b(?:abhangigkeit\w*|dependenc(?:y|ies))\b[^\n]{0,80}\b(?:zwischen|von|der|bei|between|among|of)\b[^\n]{0,60}\b(?:aufgabe\w*|tasks?|projekten|projects|prozesse\w*|processes|jobs?)\b/;
  // Prefer an affirmative package/security clause even when the same task also has a task graph.
  if (clauses.some(clause => security.test(clause) || software.test(clause) && maintain.test(clause))) return true;
  const taskGraph = clauses.some(clause => /\b(?:aufgaben|prozess)[- ]?abhangigkeit\w*\b/.test(clause) || dependency.test(clause) && graph.test(clause));
  if (taskGraph || software.test(excluded) || dependency.test(excluded)) return false;
  return clauses.some(clause => dependency.test(clause) && maintain.test(clause));
}

const identityHit = (query: string, skill: SkillRecord) => [skill.id, skill.name].some(name => wordHit(query, name));
const explicitPosition = (query: string, skill: SkillRecord) => new RegExp(`(?:^|[^\\p{L}\\p{N}_$-])\\$${escaped(skill.name)}(?=$|[^\\p{L}\\p{N}_-])`, 'iu').exec(query)?.index ?? -1;
type Ranked = { skill: SkillRecord; definition?: AnvilSkill; hits: string[]; domain: boolean; rank: number; context?: string; explicit: boolean; pinned: boolean; position: number; mention: number };

/** Select short hints only. Skills remain discoverable and bodies are read separately. */
export function routeTaskSkills(query: string, available: SkillRecord[], env: SkillEnvironment, options: { automatic: boolean; pinned: string[]; limit: number }, definitions: AnvilSkill[]) {
  const task = taskText(query), q = task.query;
  if (!q.trim()) return [];
  const web = /\b(?:html|css|react|browser|web|website|frontend|dom)\b|(?:web|browser)(?:oberflache|anwendung)|webapp/.test(q);
  const explanation = /\b(?:erklar(?:e|en|t)?|beschreib(?:e|en|t)?|erlauter(?:e|n|t)?|analysier(?:e|en|t)?|explain\w*|describe\w*|overview|understand\w*|analy[sz]e)\b/.test(q);
  const change = /\b(?:andere|andern|erweitere|erweitern|erstell\w*|implement\w*|baue|build|create|change|edit|refactor\w*|optimier\w*|beheb\w*|reparier\w*)\b/.test(q);
  const scene = /\b(?:szene\w*|scene\w*|doppelsprung|spieler\w*|player|gdscript|prefab\w*|blueprint\w*|kollision\w*|collision\w*)\b/.test(q);
  const cad = !web && capabilityHasTopic(q, 'cad') && /parametr|geometr|bohr|bauteil|volumen|solid|sketch|skizz|\bstep[- ]?(?:export|datei|file)\b|\bstl[- ]?(?:export|datei|file)\b/.test(q);
  const service = (name: string) => env.services.some(row => row.enabled && wordHit(normalize(row.name), name));
  const cadTarget = service('freecad') && (!service('openscad') || /\bstep\b|partdesign|fcstd/.test(q)) ? 'freecad'
    : service('openscad') && (!service('freecad') || /\bscad\b|openscad/.test(q)) ? 'openscad' : '';
  const propertyTerms = /\beigenschaftstest\w*|\beigenschaftsbasiert\w*|\bproperty[- ](?:based|testing)\b|\bfast-check\b|\bhypothesis\b|\bproptest\b|\bfuzz(?:ing)?\b/;
  const propertyCheck = propertyTerms.test(q) || /\b(?:invariant\w*|round[- ]?trip)\b/.test(q) && /\b(?:test\w*|pruf\w*|check\w*|verif\w*|absicher\w*)\b/.test(q);
  const uiTerms = /\b(?:beschriftung\w*|verstandlichkeit|tooltip\w*|tooltipp\w*|fokus|tastaturbedienung|barrierefrei\w*|usability|accessibility|screenreader|formularfehler|fehlertexte)\b|\bui[- ]audit\b/;
  const uiTask = uiTerms.test(q) || /\bbedienung\b/.test(q) && /\b(?:verbesser\w*|optimier\w*|pruf\w*|test\w*|audit)\b/.test(q);
  // Accessibility in a complete app's requirements must not evict its build
  // and functional-check guides. A focused wording/UI task still ranks first.
  const primary = normalize(task.clauses.find(clause => clause.trim()) || '');
  const appPosition = primary.search(/\b(?:browseranwendung\w*|webanwendung\w*|webapp\w*|anwendung\w*|application\w*|app)\b/);
  const uiPosition = primary.search(uiTerms);
  const wholeAppBuild = /\b(?:erstelle\w*|baue\w*|build|create)\b/.test(primary) && appPosition >= 0 && (uiPosition < 0 || appPosition < uiPosition);
  const reactProject = env.frameworks?.includes('react') === true;
  const reactPerformance = /neu[- ]?render|re[- ]?render|\brendering\b|\bzustand\b|\bstate\b|\bkomponent\w*|\bcomponent\w*|\buseeffect\b|\busememo\b|\bprofiler\b/.test(q);

  const ranked: Ranked[] = available.map(skill => {
    const definition = definitions.find(row => row.id === skill.id);
    const requirement = definition?.requirements.find(row => row.kind === 'engine' || row.kind === 'service' && row.match);
    const domain = Boolean(requirement);
    const keywords = definition?.keywords || capabilityTerms(`${skill.name.replaceAll('-', ' ')} ${skill.when}`).words.filter(word => word.length > 2);
    const hits = [...new Set(keywords.filter(keyword => wordHit(q, keyword)))];
    const position = explicitPosition(task.positive, skill), explicit = position >= 0;
    const namedExcluded = identityHit(task.excluded, skill) || Boolean(requirement?.match && wordHit(task.excluded, requirement.match))
      || skill.id === 'anvil-tests' && /\b(?:test|tests|pytest|unittest)\b/.test(task.excluded)
      || skill.id === 'anvil-eigenschaftstests' && propertyTerms.test(task.excluded)
      || skill.id === 'anvil-react' && /\breact\b/.test(task.excluded)
      || skill.id === 'anvil-bedienung-verbessern' && (uiTerms.test(task.excluded) || /\bbedienung\b/.test(task.excluded));
    const pinned = options.pinned.includes(skill.id) && (!namedExcluded || explicit);
    let rank = hits.length ? 20 + Math.min(30, hits.length * 10) : 0;
    let context: string | undefined;
    if (domain) {
      const named = Boolean(requirement?.match && wordHit(q, requirement.match));
      rank = named ? 200 + Math.min(20, hits.length * 2) : 0;
      if (!named && requirement?.kind === 'engine' && hits.length) rank = 150;
      if (!rank && requirement?.kind === 'engine' && !web && scene && env.engines.length === 1 && env.engines[0] === requirement.match) { rank = 120; context = 'engine'; }
      if (!rank && requirement?.kind === 'service' && requirement.match === cadTarget && cad) { rank = 120; context = 'cad'; }
      if (!rank && requirement?.kind === 'service' && requirement.match === 'blender' && !web && !cad && service('blender') && capabilityHasTopic(q, 'blender') && /mesh|\b3d\b|modellier|material/.test(q)) { rank = 100; context = 'service'; }
      if (!rank && requirement?.match === 'github' && service('github') && /\b(?:issue\w*|repositories|repository|repo)\b|pull request/.test(q)) { rank = 100; context = 'service'; }
    } else if (skill.id === 'anvil-projekt-verstehen') {
      if (hits.length || explanation && /projekt|project|architektur|architecture/.test(q)) rank = 75;
    } else if (skill.id === 'anvil-code-aendern') {
      if (!change) rank = 0;
    } else if (skill.id === 'anvil-aenderungen-pruefen') {
      rank = /\breview\b|\bdiff\b|anderungen|bewert\w*|code[- ]review/.test(q) ? 70 : 0;
    } else if (skill.id === 'anvil-fehler-beheben') {
      if (hits.length) rank = 85;
    } else if (skill.id === 'anvil-tests') {
      if (hits.length || capabilityHasTopic(q, 'test')) rank = 70;
    } else if (skill.id === 'anvil-git') {
      rank = /\bgit\b|\bcommit\w*|\bpush\b|\bclone\b|\bbranch\b|versionsverwaltung/.test(q) ? 90 : 0;
    } else if (skill.id === 'anvil-web') {
      if (web) rank = 80;
    } else if (skill.id === 'anvil-auftrag-fortsetzen') {
      if (hits.length || /\b(?:auftrag\w*|aufgabe\w*|task|job)\b/.test(q) && /\b(?:fort|weiter|resume|continue)\b/.test(q)) rank = 95;
    } else if (skill.id === 'anvil-anwendung-pruefen') {
      const target = /\b(?:(?:web|browser)?anwendung\w*|webapp\w*|app|application\w*|programm\w*|browser|einstieg|entrypoint)\b/.test(q);
      const check = /\b(?:pruf\w*|test\w*|verify|check|validat\w*)\b/.test(q);
      if (hits.length || target && check && !explanation) rank = 105;
    } else if (skill.id === 'anvil-assets-uebertragen') {
      rank = !explanation && /\b(?:asset\w*|glb|gltf|fbx|obj|step|stl)\b/.test(q) && /ubertrag|import|export|austausch|transfer/.test(q) ? 95 : 0;
    } else if (skill.id === 'anvil-abhaengigkeiten-pflegen') {
      rank = packageMaintenance(task.clauses, task.excluded) ? 95 : 0;
    } else if (skill.id === 'anvil-eigenschaftstests') {
      rank = propertyCheck ? 125 : 0;
    } else if (skill.id === 'anvil-react') {
      rank = wordHit(q, 'react') ? 118 : reactProject && (reactPerformance || uiTask) ? 115 : 0;
      if (rank && reactProject) context = 'react';
    } else if (skill.id === 'anvil-bedienung-verbessern') {
      rank = uiTask ? wholeAppBuild ? 45 : 122 : 0;
    }
    if (namedExcluded && !explicit) rank = 0;
    const mention = domain && requirement?.match ? new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped(normalize(requirement.match))}(?=$|[^\\p{L}\\p{N}_])`, 'u').exec(q)?.index ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    return { skill, definition, hits, domain, rank, context, explicit, pinned, position, mention };
  });
  const compare = (a: Ranked, b: Ranked) => b.rank - a.rank || a.mention - b.mention || a.skill.id.localeCompare(b.skill.id);
  const selected = ranked.filter(row => row.explicit).sort((a, b) => a.position - b.position);
  for (const pin of options.pinned.slice(0, 3)) {
    const row = ranked.find(row => row.skill.id === pin && row.pinned);
    if (row && !selected.includes(row)) selected.push(row);
  }
  const limit = Math.max(0, Math.min(SKILL_PRESELECT_LIMIT, Math.floor(options.limit) || 0));
  if (options.automatic && selected.length < limit) {
    const automatic = ranked.filter(row => row.rank > 0 && !selected.includes(row)).sort(compare);
    const domain = selected.some(row => row.domain) ? undefined : automatic.find(row => row.domain);
    if (domain) selected.push(domain);
    while (selected.length < limit) {
      const next = automatic.find(row => !row.domain && !selected.includes(row)) || automatic.find(row => !selected.includes(row));
      if (!next) break;
      selected.push(next);
    }
  }
  return selected.map(row => ({ ...row,
    reason: row.explicit ? 'Im Auftrag ausdrücklich genannt.' : row.pinned ? 'Für dieses Projekt angeheftet.' : row.context === 'engine' ? 'Passt zur Szene und zum geöffneten Engine-Projekt.' : row.context === 'cad' ? 'Passt zur Konstruktion und zum eingerichteten CAD-Dienst.' : row.context === 'react' ? 'Passt zum Auftrag und den React-Projektdateien.' : row.context ? 'Passt zum Auftrag und zum eingerichteten Dienst.' : row.hits.length ? `Passt zum Auftrag: ${row.hits.slice(0, 3).join(', ')}.` : 'Passt zum beschriebenen Arbeitsablauf.',
    reasonEn: row.explicit ? 'Explicitly named in the task.' : row.pinned ? 'Pinned for this project.' : row.context === 'engine' ? 'Matches the scene and the open engine project.' : row.context === 'cad' ? 'Matches the geometry task and the configured CAD service.' : row.context === 'react' ? 'Matches the task and the React project files.' : row.context ? 'Matches the task and the configured service.' : row.hits.length ? `Matches the task: ${row.hits.slice(0, 3).join(', ')}.` : 'Matches the described workflow.',
  }));
}
