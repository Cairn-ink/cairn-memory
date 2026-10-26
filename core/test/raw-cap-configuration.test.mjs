import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../index.mjs';
import { localPlainPort, rawNamespace as namespace, rawRequest, splitRaw } from '../testing/raw-fixtures.mjs';

const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
test('configureCap validates own boolean values before opening a database or invoking host code', t => {
  const workspace = createTestWorkspace(t, { prefix: 'raw-cap-input-' }); let calls = 0;
  const policy = () => { calls++; return { generation: 'synthetic', reason: null }; };
  const options = [null, undefined, 0, 1, 'false', {}, []].map(configureCap => ({ mode: 'off', readPolicy: policy, configureCap }));
  options.push(Object.defineProperty({ mode: 'off', readPolicy: policy }, 'configureCap', { get() { calls++; return false; } }));
  for (const [index, rawConversations] of options.entries()) {
    const path = join(workspace.path, index + '.sqlite');
    assert.throws(() => openMemoryCore({ path, rawConversations }), { code: 'invalid_input' }); assert.equal(existsSync(path), false);
  }
  assert.equal(calls, 0);
});

test('configureCap false preserves existing owner caps and observes another connection decrease; omission preserves administration', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'raw-cap-existing-' }), path = join(workspace.path, 'store.sqlite');
  const open = (capBytes, patch = {}) => {
    const core = openMemoryCore({ path, model: { contextWindow: 8192, countTokens: () => 1, extract: () => ({ items: [] }) },
      rawConversations: { mode: 'raw-v1', capBytes, port: localPlainPort(), readPolicy: () => ({ generation: 'synthetic', reason: null }), ...patch } });
    workspace.defer(() => core.close()); return core;
  };
  const initial = open(1000); ok(await initial.captureRaw(rawRequest(splitRaw('a')[0])));
  const cap = core => ok(core.getRawUsage({ ownerId: namespace.ownerId })).capBytes;
  assert.equal(cap(initial), 1000);
  const administrator = open(20); assert.equal(cap(initial), 20);
  const capture = open(1000, { configureCap: false }); assert.equal(cap(capture), 20);
  const request = rawRequest(splitRaw('x'.repeat(30), { id: 'second', ordinal: 2 })[0]);
  assert.equal(ok(await capture.captureRaw(request)).raw.parts[0].reason, 'quota_reached');
  assert.equal(cap(administrator), 20);
  const omitted = openMemoryCore({ path, rawConversations: { mode: 'off', readPolicy: () => ({ generation: 'synthetic', reason: null }) } });
  workspace.defer(() => omitted.close()); assert.equal(cap(omitted), 20);
  assert.equal(cap(open(800)), 800);
  assert.equal(cap(open(900, { configureCap: true })), 900);
});

test('configureCap false supplies the initial owner cap without reconfiguring another owner', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'raw-cap-new-owner-' }), path = join(workspace.path, 'store.sqlite');
  const make = (capBytes, patch = {}) => {
    const core = openMemoryCore({ path, model: { contextWindow: 8192, countTokens: () => 1, extract: () => ({ items: [] }) },
      rawConversations: { mode: 'raw-v1', capBytes, ...patch, port: localPlainPort(), readPolicy: () => ({ generation: 'synthetic', reason: null }) } });
    workspace.defer(() => core.close()); return core;
  };
  const first = make(10); ok(await first.captureRaw(rawRequest(splitRaw('x')[0])));
  const other = make(30, { configureCap: false }), otherNamespace = { ...namespace, ownerId: 'other-owner' };
  ok(await other.captureRaw(rawRequest(splitRaw('y')[0], { namespace: otherNamespace })));
  assert.equal(ok(other.getRawUsage({ ownerId: otherNamespace.ownerId })).capBytes, 30);
  assert.equal(ok(first.getRawUsage({ ownerId: namespace.ownerId })).capBytes, 10);
});
