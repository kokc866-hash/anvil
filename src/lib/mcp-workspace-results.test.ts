import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localMcpFiles, workspaceMcpArguments } from './mcp-schema.ts';

const destination = (path: string, directory: boolean) => `/project/${directory || path.includes('/') ? '' : 'Ergebnis/'}${path}`;
const string = { type: 'string' };

test('local save and export use declared destinations and existing schemas', async () => {
  const schema = { type: 'object', properties: { action: string, path: string }, required: ['action', 'path'], additionalProperties: false };
  const out = await workspaceMcpArguments('manage_scene', schema, { action: 'save', path: 'park.unity' }, undefined, undefined, destination);
  assert.deepEqual(out, { action: 'save', path: '/project/Ergebnis/park.unity' });
  assert.deepEqual(await workspaceMcpArguments('manage_scene', schema, { action: 'load', path: 'park.unity' }, undefined, undefined, destination), { action: 'load', path: 'park.unity' });
  assert.deepEqual(await workspaceMcpArguments('export_scene', schema, { action: 'export', path: 'Assets/park.glb' }, undefined, undefined, destination), { action: 'export', path: '/project/Assets/park.glb' });
});

test('separate filename and directory stay separate and receive a default directory', async () => {
  const schema = { type: 'object', properties: { filename: string, output_dir: string }, required: ['filename', 'output_dir'] };
  assert.deepEqual(await workspaceMcpArguments('render', schema, {filename:'view.png'}, undefined, undefined, destination), {
    filename:'view.png', output_dir:'/project/Ergebnis',
  });
  await assert.rejects(workspaceMcpArguments('render', schema, {filename:'subfolder/view.png'}, undefined, undefined, destination));
});

test('remote connections and free-form code receive no automatic local paths', async () => {
  assert.equal(localMcpFiles({transport:'stdio'}), true);
  assert.equal(localMcpFiles({url:'http://127.0.0.1:9876/mcp'}), true);
  assert.equal(localMcpFiles({url:'https://example.org/mcp'}), false);
  assert.equal(localMcpFiles({url:'http://192.168.56.40:8877/mcp'}), false);
  const args = {code:'print("scene")'};
  const schema = {type:'object',properties:{code:string},additionalProperties:false};
  assert.deepEqual(await workspaceMcpArguments('execute_blender_code', schema, args, undefined, undefined, () => { throw Error('unexpected destination'); }), args);
});
