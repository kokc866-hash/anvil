import assert from 'node:assert/strict';
import { test } from 'node:test';
import { librarySeeds, selectTaskSkills, skillToolHints, type SkillEnvironment } from './skill-library.ts';
import { ToolSession } from './tool-compat.ts';
import { AGENT_TOOLS } from './agent-tools.ts';

const project: SkillEnvironment = { project: true, saved: true, execution: true, engines: [], services: [] };
const choose = (prompt: string, environment = project, automatic = true) => selectTaskSkills(prompt, librarySeeds(), environment, { automatic, pinned: [], limit: 2 });

test('specific testing methods and UI wording have their own discoverable instructions', () => {
  assert.ok(choose('Prüfe den JSON-Roundtrip mit eigenschaftsbasierten Tests.').some(item => item.id === 'anvil-eigenschaftstests'));
  assert.ok(choose('Verbessere die Beschriftungen und Tastaturbedienung der Oberfläche.').some(item => item.id === 'anvil-bedienung-verbessern'));
});

test('React project context helps a relevant task without turning every task into React work', () => {
  const react = { ...project, frameworks: ['react'] };
  assert.ok(choose('Verringere unnötige Neurenderings der Komponenten.', react).some(item => item.id === 'anvil-react'));
  assert.equal(choose('Verringere unnötige Neurenderings der Komponenten.').some(item => item.id === 'anvil-react'), false);
  assert.equal(choose('Erkläre die Git-Historie.', react).some(item => item.id === 'anvil-react'), false);
  assert.ok(choose('Optimiere die React-Komponenten.').some(item => item.id === 'anvil-react'));
});

test('new specialist guides respect exclusions, automatic switch and explicit requests', () => {
  for (const [prompt, id] of [
    ['Keine Eigenschaftstests. Führe nur die vorhandenen Unit-Tests aus.', 'anvil-eigenschaftstests'],
    ['Nutze kein React. Verbessere die CSS-Animation.', 'anvil-react'],
    ['Keine Änderungen an der Bedienung. Prüfe nur den JSON-Export.', 'anvil-bedienung-verbessern'],
  ]) assert.equal(choose(prompt, { ...project, frameworks: ['react'] }).some(item => item.id === id), false, prompt);
  assert.deepEqual(choose('Prüfe die React-Komponenten mit Eigenschaftstests.', project, false), []);
  assert.deepEqual(choose('$anvil-eigenschaftstests $anvil-react $anvil-bedienung-verbessern', project, false).map(item => item.id), ['anvil-eigenschaftstests', 'anvil-react', 'anvil-bedienung-verbessern']);
});

test('a named CAD or engine specialist still fits within the automatic two-skill budget', () => {
  for (const prompt of ['Prüfe Godot-Invarianten mit Eigenschaftstests.', 'Prüfe FreeCAD-Solids und ihre Invarianten mit Eigenschaftstests.']) {
    const result = choose(prompt, { ...project, frameworks: ['react'], engines: ['godot'] });
    assert.ok(result.length <= 2);
    assert.ok(result.some(item => item.id === (prompt.includes('FreeCAD') ? 'anvil-freecad' : 'anvil-godot')));
    assert.ok(result.some(item => item.id === 'anvil-eigenschaftstests'));
  }
});

test('incidental UI requirements do not replace the main guides for building a complete application', () => {
  const whole = choose('Erstelle eine vollständige Browseranwendung. Baue die Datenverwaltung und Speicherung. Prüfe anschließend die Funktionen und Tastaturbedienung.');
  assert.deepEqual(whole.map(item => item.id), ['anvil-anwendung-pruefen', 'anvil-web']);
  const focused = choose('Erstelle verständliche Beschriftungen in der Browseranwendung.');
  assert.ok(focused.some(item => item.id === 'anvil-bedienung-verbessern'));
});

test('selected native skills make their existing tools discoverable without executing anything', () => {
  const hints = skillToolHints(choose('Nutze FreeCAD und prüfe die Geometrie.'));
  assert.ok(hints.includes('mcp_list'));
  assert.ok(hints.includes('mcp_call'));
  const session = new ToolSession('compact', '', ['skill_read', ...hints]);
  const offered = session.tools(AGENT_TOOLS).map(tool => tool.function.name);
  assert.ok(offered.includes('mcp_call'));
  assert.deepEqual(skillToolHints([{ id: 'imported-untrusted-guide' }]), []);
});

test('skill tool hints stay bounded and never expose forbidden execution schemas', () => {
  const hints = skillToolHints(librarySeeds());
  assert.ok(hints.length > 0 && hints.length <= 8);
  assert.equal(new Set(hints).size, hints.length);
  const allowed = AGENT_TOOLS.filter(tool => ['select_tools', 'list_files', 'read_file', 'grep', 'skill_read', 'skill_list'].includes(tool.function.name));
  const session = new ToolSession('standard', '', hints);
  const offered = session.tools(allowed).map(tool => tool.function.name);
  assert.ok(offered.every(name => allowed.some(tool => tool.function.name === name)));
  assert.equal(offered.includes('shell'), false);
  assert.equal(offered.includes('mcp_call'), false);
});
