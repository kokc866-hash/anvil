import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readChatClipboard } from '../electron/clipboard.mjs';

const denied = async () => { throw Error('Synthetic clipboard unavailable'); };
const item = formats => ({ types: Object.keys(formats), getType: async type => {
  const payload = formats[type];
  if (payload instanceof Error) throw payload;
  return payload;
} });

test('native asynchronous clipboard resolves long text before structured IPC cloning', async () => {
  const text = 'FreeCAD instructions\n'.repeat(600);
  const result = await readChatClipboard({ read: async () => [item({ 'text/plain': new Blob([text]) })], readText: denied });
  assert.deepEqual(structuredClone(result), { text, image: '' });
});

test('native clipboard converts image Blobs to cloneable data URLs and keeps plain text', async () => {
  const result = await readChatClipboard({ read: async () => [item({
    'image/png': new Blob([new Uint8Array([0, 1, 2, 255])], { type: 'image/png' }),
    'text/plain': new Blob(['CAD drawing']),
  })], readText: denied });
  assert.deepEqual(structuredClone(result), { text: 'CAD drawing', image: 'data:image/png;base64,AAEC/w==' });
});

test('native clipboard still reads text if an image representation is unavailable', async () => {
  const result = await readChatClipboard({ read: async () => [item({
    'image/png': Error('Unreadable image'), 'text/plain': new Blob(['CAD']),
  })], readText: denied });
  assert.deepEqual(result, { text: 'CAD', image: '' });
});

test('native clipboard awaits the plain-text fallback if rich reading fails', async () => {
  assert.deepEqual(await readChatClipboard({ read: denied, readText: async () => 'plain text' }), { text: 'plain text', image: '' });
});

test('native image-only clipboard remains readable if text access fails', async () => {
  assert.deepEqual(await readChatClipboard({ read: async () => [item({ 'image/png': new Blob(['image']) })], readText: denied }),
    { text: '', image: 'data:image/png;base64,aW1hZ2U=' });
});

test('native empty clipboard and denied clipboard access remain distinct', async () => {
  assert.deepEqual(await readChatClipboard({ read: async () => [], readText: denied }), { text: '', image: '' });
  await assert.rejects(readChatClipboard({ read: denied, readText: denied }), /Clipboard access unavailable/);
});
