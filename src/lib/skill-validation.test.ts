import assert from 'node:assert/strict';
import { test } from 'node:test';
import { debugSkill } from './skill-debug.ts';
import { ANVIL_SKILL_TOOL_NAMES, skillReferencePaths } from '../../electron/knowledge-skill-check.mjs';
import { AGENT_TOOLS } from './agent-tools.ts';

const skill = (body: string) => ({ name: 'valid-workflow', when: 'Prüft einen vorhandenen Export', body });

test('skill validation distinguishes unknown references from missing or present files', () => {
  const source = skill('Read [the procedure](references/check.md), then inspect the requested export.');
  const unknown = debugSkill(source);
  assert.equal(unknown.checks.references, 'unverified');
  assert.equal(unknown.checks.behavior, 'unverified');
  assert.ok(unknown.warnings.length);
  const present = debugSkill(source, { resources: ['references/check.md'] });
  assert.equal(present.checks.references, 'pass');
  assert.equal(present.ok, true);
  const missing = debugSkill(source, { resources: [] });
  assert.equal(missing.checks.references, 'fail');
  assert.equal(missing.ok, false);
  assert.ok(missing.issues.some(issue => issue.includes('references/check.md')));
});

test('a resource declaration alone cannot prove a missing project file exists', () => {
  const source = skill('Read references/check.md before checking the export.');
  const options = { baseDirectory: '.anvil/skills/export-check', resources: ['.anvil/skills/export-check/references/check.md'] };
  assert.equal(debugSkill(source, { ...options, files: {} }).checks.references, 'fail');
  assert.equal(debugSkill(source, { ...options, files: { '.anvil/skills/export-check/references/check.md': 'Actual resource' } }).checks.references, 'pass');
  assert.equal(debugSkill(source, { resources: { 'references/check.md': 'Actual bundled resource' } }).checks.references, 'pass');
});

test('reference discovery ignores external links and fenced examples and rejects escaping paths', () => {
  const source = 'Use [actual](references/actual.md#section).\n```md\nRead references/example.md\n```\nSee [docs](https://example.com/guide.md).';
  assert.deepEqual(skillReferencePaths(source), ['references/actual.md']);
  assert.equal(debugSkill(skill('Read [outside](../outside.md).'), { resources: [] }).checks.references, 'fail');
  assert.equal(debugSkill(skill('Read references/../../outside.md.'), { resources: [] }).checks.references, 'fail');
});

test('known native tools, invented tools and dynamic service tools have different checks', () => {
  assert.equal(debugSkill(skill('Use `read_file` to inspect the file.')).checks.tools, 'pass');
  const invented = debugSkill(skill('Rufe das Werkzeug teleport_project auf und prüfe seine Ausgabe.'));
  assert.equal(invented.ok, false);
  assert.equal(invented.checks.tools, 'fail');
  assert.ok(invented.issues.some(issue => issue.includes('teleport_project')));
  const dynamic = debugSkill(skill('Mit `mcp_list` den aktuellen MCP-Katalog lesen. Nur dort angebotene `execute_code` verwenden.'));
  assert.equal(dynamic.ok, true);
  assert.equal(dynamic.checks.tools, 'unverified');
  assert.ok(dynamic.warnings.some(warning => /Katalog/.test(warning)));
});

test('feedback and code examples do not invalidate a sound skill or claim behavior was tested', () => {
  const result = debugSkill({ ...skill('Inspect the requested export and report observed differences.'), fails: 12 });
  assert.equal(result.ok, true);
  assert.equal(result.checks.behavior, 'unverified');
  assert.equal(debugSkill(skill('Example:\n```js\nteleport_project();\n```\nUse `read_file` for the real file.')).checks.tools, 'pass');
});

test('invalid raw values are not coerced into a successful format check', () => {
  const source = { name: 'valid-workflow', when: 'Prüft einen Export', body: { invalid: true } };
  assert.equal(debugSkill(source as unknown as Parameters<typeof debugSkill>[0]).checks.format, 'fail');
});

test('the native-tool validation catalog matches the real agent schemas', () => {
  assert.deepEqual([...ANVIL_SKILL_TOOL_NAMES].sort(), AGENT_TOOLS.map(tool => tool.function.name).sort());
});

// Exact examples captured from the pinned sources in skills-research-2026-10-29.
// They stay inline so the regression suite also runs without ignored artifacts.
test('upstream Python and Godot function examples are not invented Anvil tools', () => {
  const examples = [
    // trailofbits/skills@2be6433b39e0 property-based-testing/SKILL.md
    '| Easy to verify | `is_sorted(sort(x))` | Complex algorithms with cheap checkers |',
    // gamedev-skills/awesome-gamedev-agent-skills@19d93f97c9c1
    'non-zero on `push_error()` by itself — the runner must count failures and call',
    'Use an `assert_eq()`-style helper that records the failure and keeps going.',
  ];
  for (const example of examples) {
    const result = debugSkill(skill(example));
    assert.equal(result.ok, true, result.issues.join('; '));
    assert.equal(result.checks.tools, 'unverified');
    assert.equal(result.checks.behavior, 'unverified');
  }
  const nativeAndCode = debugSkill(skill('Use `read_file` to inspect the helper `is_sorted()` and the test function `assert_eq()`.'));
  assert.equal(nativeAndCode.checks.tools, 'pass');
  assert.deepEqual(nativeAndCode.warnings, []);
});

test('the Microsoft directory template link resolves against actual package descendants', () => {
  // microsoft/skills@00d66a64919e react-flow-node-ts/SKILL.md
  const source = skill('Copy templates from [assets/](assets/) and replace placeholders:');
  const resources = ['assets/template.tsx', 'assets/types.template.ts'];
  assert.equal(debugSkill(source, { resources }).checks.references, 'pass');
  assert.equal(debugSkill(source, { resources: { 'assets/template.tsx': 'Actual template' } }).checks.references, 'pass');
  assert.equal(debugSkill(source, { resources: [] }).checks.references, 'fail');
  assert.equal(debugSkill(source).checks.references, 'unverified');
  assert.deepEqual(skillReferencePaths(source.body), ['assets/']);
});

test('directory references require bounded real file descendants when a files map is supplied', () => {
  const source = skill('Read [assets/](assets/) before using the template.');
  const baseDirectory = '.anvil/skills/template-guide';
  const resources = [`${baseDirectory}/assets/nested/template.tsx`];
  assert.equal(debugSkill(source, { baseDirectory, resources, files: {} }).checks.references, 'fail');
  assert.equal(debugSkill(source, { baseDirectory, resources, files: { [`${baseDirectory}/assets/nested/template.tsx`]: '' } }).checks.references, 'pass');
  assert.equal(debugSkill(source, { resources: ['assets-other/template.tsx'] }).checks.references, 'fail');
  assert.equal(debugSkill(source, { resources: ['assets/'] }).checks.references, 'fail');
  assert.equal(debugSkill(source, { resources: ['assets/../elsewhere.tsx'] }).checks.references, 'fail');
});

test('trailing-slash support preserves unsafe-path rejection for directory links', () => {
  for (const path of ['../assets/', 'assets/../', 'assets/..', 'assets/.', 'assets//', 'assets\\nested/', 'assets/nested:stream/']) {
    const result = debugSkill(skill(`Read [templates](${path}) before proceeding.`), { resources: ['assets/template.tsx'] });
    assert.equal(result.checks.references, 'fail', path);
    assert.equal(result.ok, false, path);
    assert.deepEqual(skillReferencePaths(`Read [templates](${path}).`), [], path);
  }
});

test('native-tool claims remain strict even in a guide that also mentions MCP', () => {
  for (const body of [
    'Use the Anvil tool `teleport_project()` to complete the export.',
    'Nutze das Anvil-Werkzeug `teleport_project` und prüfe anschließend den MCP-Katalog.',
    'Use native tool `teleport_project` after checking the MCP catalog.',
  ]) {
    const result = debugSkill(skill(body));
    assert.equal(result.ok, false, body);
    assert.equal(result.checks.tools, 'fail', body);
  }
  const service = debugSkill(skill('Use MCP tool `execute_code` only when it is present in the current catalog.'));
  assert.equal(service.ok, true);
  assert.equal(service.checks.tools, 'unverified');
});
