import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createCairnServer } from '../server.mjs';
import { parseConfiguration } from '../cli.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/rationale-review-server.mjs', import.meta.url));
const namespace = { ownerId: 'review-host', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const failure = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code); };
function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-review-host-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, path: join(root, 'memory.sqlite'), mode: join(root, 'mode'), observation: join(root, 'observation') };
}
function run(args, key = '') {
  return spawnSync(process.execPath, ['--import', 'data:text/javascript,globalThis.fetch=()=>{process.exit(91)}', cli, ...args],
    { encoding: 'utf8', timeout: 5000, env: { OPENAI_API_KEY: key, NODE_NO_WARNINGS: '1' } });
}
async function host(t, files, flags = ['--rationale-review', 'replace-reviewed-v1'], fixtureModel = true) {
  const client = new Client({ name: 'rationale-review-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: [fixtureModel ? fixture : cli, '--db', files.path, '--owner', namespace.ownerId, ...flags],
    env: { OPENAI_API_KEY: '', SYNTHETIC_REVIEW_MODE: files.mode,
      SYNTHETIC_REVIEW_OBSERVATION: files.observation, NODE_NO_WARNINGS: '1' }, stderr: 'pipe' }));
  return client;
}
async function call(client, name, args = {}) {
  const response = await client.callTool({ name, arguments: args });
  const result = JSON.parse(response.content[0].text);
  assert.equal(Boolean(response.isError), !result.ok);
  assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions');
  return result;
}
async function invalid(client, name, args) {
  try {
    const response = await client.callTool({ name, arguments: args });
    assert.equal(response.isError, true, JSON.stringify(response));
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    assert.match(String(error), /invalid|validation|unrecognized|required/i);
  }
}
const names = async client => (await client.listTools()).tools.map(item => item.name).sort();

test('MR1/MR4 independent config validates without database/provider and inherited server flag cannot opt in', async t => {
  const files = temporary(t); const args = ['--db', files.path, '--owner', namespace.ownerId];
  assert.equal(parseConfiguration(args).rationaleReview, undefined);
  assert.equal(parseConfiguration([...args, '--rationale-review', 'replace-reviewed-v1']).rationaleReview, 'replace-reviewed-v1');
  for (const extra of [['--rationale-review'], ['--rationale-review', ''], ['--rationale-review', 'wrong'],
    ['--rationale-review', 'replace-reviewed-v1', '--rationale-review', 'replace-reviewed-v1']]) {
    assert.throws(() => parseConfiguration([...args, ...extra]));
    assert.equal(run(['--check-config', ...args, ...extra]).status, 1);
  }
  for (const key of ['', 'synthetic-key']) {
    const result = run(['--check-config', ...args, '--rationale-review', 'replace-reviewed-v1'], key);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.rationaleReview, 'replace-reviewed-v1');
    assert.equal(report.reviewRationale, key ? 'configured-not-verified' : 'model_not_configured');
    assert.equal(report.databaseOpened, false); assert.equal(report.providerContacted, false);
    assert.equal(report.automaticCapture, false); assert.equal(report.captureQualification, undefined);
    assert.equal(existsSync(files.path), false);
  }
  const help = run(['--help']); assert.match(help.stdout, /--rationale-review replace-reviewed-v1/);
  let calls = 0;
  const inherited = Object.assign(Object.create({ get rationaleReview() { calls++; return 'replace-reviewed-v1'; } }),
    { path: files.path, namespace });
  const server = createCairnServer(inherited); await server.close();
  assert.equal(calls, 0);
  for (const [index, value] of ['', null].entries()) {
    const untouched = join(files.root, `invalid-${index}.sqlite`);
    assert.throws(() => createCairnServer({ path: untouched, namespace, rationaleReview: value }));
    assert.equal(existsSync(untouched), false);
  }
});

test('MR2/MR3/MR5 actual SDK tool is explicit, scoped, source-only and persists correction across cold keyless restart',
  { timeout: 30000 }, async t => {
    const files = temporary(t); writeFileSync(files.mode, 'wrong');
    const defaultHost = await host(t, files, [], false);
    assert.deepEqual(await names(defaultHost), ['correct_memory', 'forget_memory', 'inspect_memory', 'recall_memory', 'remember_memory']);
    await defaultHost.close();
    const combined = await host(t, files, ['--capture-qualification', 'source-bound-v2',
      '--capture-rationale', 'source-bound-v1', '--rationale-review', 'replace-reviewed-v1']);
    const combinedNames = await names(combined);
    assert.equal(combinedNames.filter(name => name === 'inspect_rationale').length, 1);
    assert.ok(combinedNames.includes('capture_memory')); assert.ok(combinedNames.includes('review_rationale'));
    await combined.close();
    const client = await host(t, files);
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['correct_memory', 'forget_memory', 'inspect_memory',
      'inspect_rationale', 'recall_memory', 'remember_memory', 'review_rationale']);
    const review = tools.find(tool => tool.name === 'review_rationale');
    assert.deepEqual(review.annotations, { readOnlyHint: false, destructiveHint: true, openWorldHint: true });
    assert.equal(review.inputSchema.additionalProperties, false);
    assert.equal(review.inputSchema.properties.refs.items.additionalProperties, false);
    const inspect = tools.find(tool => tool.name === 'inspect_rationale');
    assert.equal(inspect.annotations.readOnlyHint, true);
    const save = async content => ok(await call(client, 'remember_memory', { content }));
    const decision = (await save('I chose A for offline work.')).memory;
    const challenge = (await save('The old note says A cannot work offline.')).memory;
    const crossing = (await save('Separate crossing source.')).memory;
    const ref = memory => ({ memoryId: memory.id, revision: memory.revision });
    const refs = [ref(decision), ref(challenge)];
    const original = await call(client, 'inspect_memory', { memoryId: decision.id });
    ok(await call(client, 'review_rationale', { refs }));
    assert.equal(ok(await call(client, 'inspect_rationale', ref(decision))).status, 'reconfirmation-suggested');
    writeFileSync(files.mode, 'crossing');
    ok(await call(client, 'review_rationale', { refs: [ref(decision), ref(crossing)] }));
    const before = ok(await call(client, 'inspect_rationale', ref(decision)));
    assert.equal(before.edges.length, 3);
    const beforeInvalidCalls = JSON.parse(readFileSync(files.observation, 'utf8')).calls;
    for (const bad of [{ refs: [] }, { refs: [ref(decision), ref(decision)] },
      { refs: [{ ...ref(decision), revision: 0 }] }, { refs, namespace },
      { refs: [{ ...ref(decision), extra: true }] }, { refs: Array(7).fill(ref(decision)) }]) {
      await invalid(client, 'review_rationale', bad);
    }
    const foreignCore = openMemoryCore({ path: files.path });
    const foreign = ok(foreignCore.admit({ namespace: { ...namespace, ownerId: 'other' },
      memory: { content: 'Foreign synthetic evidence', kind: 'fact' }, receipts: [{ client: 'test',
        sessionId: 'test', eventId: 'foreign', role: 'user', excerpt: 'Foreign synthetic evidence' }] })).memory;
    foreignCore.close();
    failure(await call(client, 'review_rationale', { refs: [ref(decision), ref(foreign)] }), 'memory_not_found');
    failure(await call(client, 'review_rationale', { refs: [{ ...ref(decision), revision: 999 }] }), 'revision_conflict');
    assert.equal(JSON.parse(readFileSync(files.observation, 'utf8')).calls, beforeInvalidCalls);
    assert.deepEqual(ok(await call(client, 'inspect_rationale', ref(decision))), before);
    writeFileSync(files.mode, 'failed');
    failure(await call(client, 'review_rationale', { refs }), 'rationale_failed');
    writeFileSync(files.mode, 'support');
    const result = ok(await call(client, 'review_rationale', { refs }));
    assert.equal(result.removed, 1); assert.equal(result.inserted, 0);
    assert.equal(result.writeMode, 'replace-reviewed');
    const payload = JSON.parse(readFileSync(files.observation, 'utf8')).input;
    assert.deepEqual(payload, { memories: [
      { index: 0, receipts: [{ index: 0, role: 'user', excerpt: 'I chose A for offline work.' }] },
      { index: 1, receipts: [{ index: 0, role: 'user', excerpt: 'The old note says A cannot work offline.' }] },
    ] });
    assert.equal(ok(await call(client, 'inspect_rationale', ref(decision))).status, 'unassessed');
    assert.deepEqual(await call(client, 'inspect_memory', { memoryId: decision.id }), original);
    await client.close();
    const cold = await host(t, files, ['--rationale-review', 'replace-reviewed-v1'], false);
    const persisted = ok(await call(cold, 'inspect_rationale', ref(decision)));
    assert.equal(persisted.status, 'unassessed'); assert.equal(persisted.edges.length, 2);
    failure(await call(cold, 'review_rationale', { refs }), 'model_not_configured');
    writeFileSync(files.mode, 'empty');
    await cold.close();
    const emptyHost = await host(t, files);
    const empty = ok(await call(emptyHost, 'review_rationale', { refs }));
    assert.equal(empty.removed, 1); assert.equal(empty.inserted, 0);
    const repeat = ok(await call(emptyHost, 'review_rationale', { refs }));
    assert.equal(repeat.removed, 0); assert.equal(repeat.inserted, 0);
    assert.equal(repeat.indexRevision, empty.indexRevision);
    assert.equal(ok(await call(emptyHost, 'inspect_rationale', ref(decision))).status, 'unassessed');
  });
