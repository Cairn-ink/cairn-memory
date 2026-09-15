import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createCairnServer } from '../server.mjs';
import { parseConfiguration } from '../cli.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/staged-server.mjs', import.meta.url));
const owner = 'synthetic-staged-mcp';
const namespace = { ownerId: owner, scope: 'personal', projectId: null };
const database = () => join(mkdtempSync(join(tmpdir(), 'cairn-mcp-staged-')), 'memory.sqlite');
const staging = ['--capture-qualification', 'source-bound-v2', '--capture-evidence', 'staged-v1'];
const access = ['--capture-evidence-access', 'staged-v1'];
const batch = (patch = {}) => ({ batchId: 'batch', messages: [{ role: 'assistant', content: 'Synthetic staged source quotation.' }], ...patch });
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const error = (result, code) => { assert.equal(result.ok, false); assert.equal(result.error.code, code); };
const evidence = async (host, batchId = 'batch') => ok(await call(host, 'inspect_capture_evidence', { batchId })).evidence;
async function host(t, path, { flags = staging, fake = true, project, ownerId = owner, fail = false, forbid = false, release } = {}) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fake ? fixture : cli, '--db', path, '--owner', ownerId, ...(project ? ['--project', project] : []), ...flags],
    env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1', SYNTHETIC_FAIL_QUALIFICATION: fail ? '1' : '0',
      SYNTHETIC_FORBID_MODEL: forbid ? '1' : '0', ...(release ? { SYNTHETIC_RELEASE_FILE: release } : {}) }, stderr: 'pipe' });
  let stderr = '';
  transport.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const client = new Client({ name: 'synthetic-staged-client', version: '1.0.0' });
  t.after(() => client.close()); await client.connect(transport);
  return { client, close: () => client.close(), calls: () => [...stderr.matchAll(/synthetic_model:(\w+)/g)].map(match => match[1]),
    extracted: () => new Promise((resolve, reject) => {
      const interval = setInterval(() => { if (stderr.includes('synthetic_model:extract')) { clearInterval(interval); clearTimeout(timeout); resolve(); } }, 10);
      const timeout = setTimeout(() => { clearInterval(interval); reject(new Error('Synthetic extraction did not start')); }, 5000);
    }) };
}
async function call(host, name, args = {}) {
  const response = await host.client.callTool({ name, arguments: args });
  const result = JSON.parse(response.content[0].text);
  assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions');
  assert.equal(Boolean(response.isError), !result.ok); return result;
}
async function invalid(host, name, args) {
  try { assert.equal((await host.client.callTool({ name, arguments: args })).isError, true); }
  catch (error) { if (error instanceof assert.AssertionError) throw error; assert.match(String(error), /invalid|validation|required|unrecognized/i); }
}

test('staged CLI and constructor reject malformed opt-ins before creating databases', () => {
  const bad = [['--capture-evidence', 'staged-v1'], ['--capture-qualification', 'source-bound-v1', '--capture-evidence', 'staged-v1'],
    ['--capture-evidence-access', 'unknown'], [...access, ...access], ['--capture-evidence-access'],
    [...staging, '--capture-evidence', 'staged-v1']];
  for (const flags of bad) {
    const path = database(); assert.throws(() => parseConfiguration(['--db', path, '--owner', owner, ...flags]));
    assert.equal(existsSync(path), false);
  }
  for (const config of [{ captureEvidence: 'staged-v1' }, { captureEvidenceAccess: 'unknown' },
    { captureEvidenceAccess: null }, { captureEvidence: null },
    { captureEvidence: 'staged-v1', captureQualification: 'source-bound-v1' }]) {
    const path = database(); assert.throws(() => createCairnServer({ path, namespace, ...config })); assert.equal(existsSync(path), false);
  }
});

test('check-config distinguishes keyless access and staging without opening a database or contacting a provider', () => {
  for (const flags of [access, staging]) {
    const path = database();
    const result = spawnSync(process.execPath, ['--import', 'data:text/javascript,globalThis.fetch=()=>{process.exit(91)}',
      cli, '--check-config', '--db', path, '--owner', owner, ...flags], { encoding: 'utf8', timeout: 5000,
      env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' } });
    assert.equal(result.status, 0, result.stderr); const report = JSON.parse(result.stdout);
    assert.equal(report.databaseOpened, false); assert.equal(report.providerContacted, false);
    assert.equal(report.captureEvidenceAccess, 'staged-v1');
    assert.equal(report.captureEvidence, flags === staging ? 'staged-v1' : undefined);
    assert.equal(existsSync(path), false);
  }
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', timeout: 5000, env: {} });
  assert.equal(help.status, 0); assert.match(help.stdout, /--capture-evidence-access/); assert.match(help.stdout, /24.hour/i);
  assert.match(help.stdout, /all staged/i);
});

test('discovery preserves defaults and exposes only strict bound local management tools with explicit access', { timeout: 30000 }, async t => {
  for (const flags of [[], ['--capture-qualification', 'source-bound-v1'], ['--capture-qualification', 'source-bound-v2'], access, staging]) {
    const h = await host(t, database(), { flags, fake: false }); const tools = (await h.client.listTools()).tools;
    assert.equal(tools.length, flags === access ? 7 : flags === staging ? 8 : flags.length ? 6 : 5);
    if (flags === access || flags === staging) for (const name of ['inspect_capture_evidence', 'discard_capture_evidence']) {
      const tool = tools.find(tool => tool.name === name);
      assert.deepEqual(Object.keys(tool.inputSchema.properties), ['batchId']); assert.equal(tool.inputSchema.additionalProperties, false);
      assert.equal(tool.annotations.openWorldHint, false);
      assert.equal(tool.annotations.readOnlyHint, name.startsWith('inspect'));
      assert.equal(tool.annotations.destructiveHint, name.startsWith('discard'));
    }
    for (const name of ['correct_memory', 'forget_memory']) {
      const tool = tools.find(tool => tool.name === name); assert.equal(tool.annotations.destructiveHint, true);
      assert.match(tool.description, /all staged/i);
    }
    await h.close();
  }
});

test('failed capture survives keyless access-only restart, retains canonical IDs, and discard closes staged and off-mode replay', { timeout: 30000 }, async t => {
  const path = database(), warm = await host(t, path, { fail: true });
  const secret = 'sk-' + 'a'.repeat(48);
  const submitted = batch({ messages: [{ role: 'assistant', content: `  Ａ ${secret} ` + 'x'.repeat(900) }] });
  assert.equal((await call(warm, 'capture_memory', submitted)).ok, false);
  const saved = await evidence(warm); assert.equal(saved.state, 'failed');
  assert.deepEqual(saved.view.messages, [{ id: createHash('sha256').update(JSON.stringify(['cairn.mcp.submitted-message.v1', 'batch', 0])).digest('hex'),
    role: 'assistant', content: 'A [REDACTED] ' + 'x'.repeat(787) }]);
  assert.deepEqual(saved.view.retainedSourceWindow.truncatedMessageIndices, [0]);
  assert.deepEqual(warm.calls(), ['extract', 'qualifyCandidates']);
  assert.deepEqual(ok(await call(warm, 'inspect_memory')).memories, []);
  await warm.close();
  const cold = await host(t, path, { flags: access, fake: false });
  assert.deepEqual(await evidence(cold), saved);
  assert.deepEqual(ok(await call(cold, 'inspect_memory')).memories, []);
  assert.deepEqual(ok(await call(cold, 'discard_capture_evidence', { batchId: 'batch' })), { discarded: true });
  assert.deepEqual(ok(await call(cold, 'discard_capture_evidence', { batchId: 'batch' })), { discarded: false });
  assert.equal((await evidence(cold)).view, null); assert.deepEqual(cold.calls(), []);
  for (const flags of [staging, ['--capture-qualification', 'source-bound-v2']]) {
    const replay = await host(t, path, { flags, forbid: true });
    error(await call(replay, 'capture_memory', submitted), 'capture_evidence_closed'); assert.deepEqual(replay.calls(), []);
    await replay.close();
  }
});

test('management rejects authority injection and isolates same-owner projects and other owners without model calls', { timeout: 30000 }, async t => {
  const path = database(), first = await host(t, path, { project: 'first', fail: true });
  await call(first, 'capture_memory', batch());
  const otherProject = await host(t, path, { flags: access, project: 'second', forbid: true });
  const otherOwner = await host(t, path, { flags: access, project: 'first', ownerId: 'other-owner', forbid: true });
  for (const other of [otherProject, otherOwner]) {
    assert.equal(await evidence(other), null);
    assert.deepEqual(ok(await call(other, 'discard_capture_evidence', { batchId: 'batch' })), { discarded: false });
    assert.deepEqual(other.calls(), []);
  }
  const before = await evidence(first);
  for (const method of ['inspect_capture_evidence', 'discard_capture_evidence']) {
    for (const field of ['namespace', 'ownerId', 'projectId', 'client', 'eventId', 'view', 'messages']) {
      await invalid(first, method, { batchId: 'batch', [field]: 'forged' });
    }
    for (const args of [{}, { batchId: '' }, { batchId: 'x'.repeat(201) }]) await invalid(first, method, args);
  }
  assert.deepEqual(await evidence(first), before); assert.deepEqual(first.calls(), ['extract', 'qualifyCandidates']);
});

test('missing or stale mutations preserve staged source and ordinary recall receives only admitted memories', { timeout: 30000 }, async t => {
  const h = await host(t, database(), { fail: true });
  await call(h, 'capture_memory', batch({ messages: [{ role: 'user', content: 'STAGED_ONLY_SENTINEL private synthetic source.' }] }));
  const target = ok(await call(h, 'remember_memory', { content: 'Synthetic admitted survivor' })).memory;
  const before = await evidence(h);
  assert.equal(ok(await call(h, 'forget_memory', { memoryId: 'missing', expectedRevision: 1 })).forgotten, false);
  assert.equal((await call(h, 'correct_memory', { memoryId: target.id, expectedRevision: target.revision + 1,
    content: 'Rejected correction' })).ok, false);
  assert.deepEqual(await evidence(h), before);
  const recalled = ok(await call(h, 'recall_memory', { query: 'Synthetic memory' }));
  assert.deepEqual(recalled.memories.map(item => item.memory.id), [target.id]);
  assert.equal(JSON.stringify(recalled).includes('STAGED_ONLY_SENTINEL'), false);
  assert.deepEqual(h.calls(), ['extract', 'qualifyCandidates', 'select', 'rank']);
});

test('discard of admitted staged evidence preserves admitted memory and successful duplicate uses no model', { timeout: 30000 }, async t => {
  const h = await host(t, database());
  const result = ok(await call(h, 'capture_memory', batch())); const memoryId = result.admission.memories[0].id;
  const before = h.calls(); assert.equal((await evidence(h)).state, 'admitted');
  assert.equal(ok(await call(h, 'capture_memory', batch())).duplicate, true); assert.deepEqual(h.calls(), before);
  error(await call(h, 'capture_memory', batch({ messages: [{ role: 'assistant', content: 'Changed evidence' }] })), 'event_payload_conflict');
  ok(await call(h, 'discard_capture_evidence', { batchId: 'batch' }));
  assert.equal((await evidence(h)).view, null);
  assert.equal(ok(await call(h, 'inspect_memory', { memoryId })).memory.id, memoryId);
  error(await call(h, 'capture_memory', batch()), 'capture_evidence_closed'); assert.deepEqual(h.calls(), before);
});

for (const action of ['discard', 'correct', 'forget']) test(`${action} during deferred stdio extraction fences qualification and admission`, { timeout: 30000 }, async t => {
  const path = database(), release = join(mkdtempSync(join(tmpdir(), 'cairn-mcp-release-')), 'release');
  t.after(() => { if (!existsSync(release)) writeFileSync(release, 'release', { flag: 'wx' }); });
  const warm = await host(t, path, { release });
  const cold = await host(t, path, { flags: access, fake: false });
  const target = ok(await call(cold, 'remember_memory', { content: 'Explicit mutation target' })).memory;
  const survivor = ok(await call(cold, 'remember_memory', { content: 'Unrelated survivor' })).memory;
  const pending = call(warm, 'capture_memory', batch()); await warm.extracted();
  assert.equal((await evidence(cold)).state, 'pending');
  assert.equal(ok(await call(warm, 'capture_memory', batch())).processing, true);
  if (action === 'discard') ok(await call(cold, 'discard_capture_evidence', { batchId: 'batch' }));
  else ok(await call(cold, `${action}_memory`, { memoryId: target.id, expectedRevision: target.revision,
    ...(action === 'correct' ? { content: 'Explicit corrected target' } : {}) }));
  writeFileSync(release, 'release', { flag: 'wx' });
  error(await pending, 'capture_evidence_closed'); assert.deepEqual(warm.calls(), ['extract']);
  const saved = await evidence(cold); assert.equal(saved.view, null);
  assert.equal(saved.state, action === 'discard' ? 'discarded' : 'forgotten');
  assert.equal(ok(await call(cold, 'inspect_memory', { memoryId: survivor.id })).memory.content, 'Unrelated survivor');
});
