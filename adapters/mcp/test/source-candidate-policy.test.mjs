import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseConfiguration } from '../cli.mjs';
import { createCairnServer } from '../server.mjs';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { openMemoryCore } from '../../../core/contract.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const policy = 'bounded-keyset-v1';
const denyNetwork = 'data:text/javascript,globalThis.fetch=()=>{process.exit(91)}';
function run(args) {
  return spawnSync(process.execPath, ['--import', denyNetwork, cli, ...args], {
    encoding: 'utf8', timeout: 5000, env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' },
  });
}

test('Z1–Z2 exact optional policy is syntax-only, omitted by default, and independent of other modes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-source-policy-config-'));
  const base = ['--db', join(directory, 'memory.sqlite'), '--owner', 'synthetic-owner'];
  const omitted = run(['--check-config', ...base]);
  assert.equal(omitted.status, 0, omitted.stderr);
  assert.equal(Object.hasOwn(JSON.parse(omitted.stdout), 'sourceCandidatePolicy'), false);
  for (const extras of [[], ['--recall-context', 'source-evidence'],
    ['--source-snapshot', 'current-admitted-v1']]) {
    const args = [...base, ...extras, '--source-candidate-policy', policy];
    assert.equal(parseConfiguration(args).sourceCandidatePolicy, policy);
    const checked = run(['--check-config', ...args]);
    assert.equal(checked.status, 0, checked.stderr);
    const report = JSON.parse(checked.stdout);
    assert.equal(report.sourceCandidatePolicy, policy);
    assert.equal(report.databaseOpened, false);
    assert.equal(report.providerContacted, false);
    assert.equal(report.modelKeyPresent, false);
    assert.deepEqual(readdirSync(directory), []);
  }
  for (const tail of [[], [''], ['bounded-keyset-v2'], ['BOUNDED-KEYSET-V1'],
    [policy, '--source-candidate-policy', policy], [policy, '--owner', 'duplicate']]) {
    const result = run(['--check-config', ...base, '--source-candidate-policy', ...tail]);
    assert.equal(result.status, 1, JSON.stringify(tail));
    assert.equal(result.stdout, '');
    assert.deepEqual(readdirSync(directory), []);
  }
  assert.match(run(['--help']).stdout, /--source-candidate-policy bounded-keyset-v1/);
});

test('Z1 programmatic policy is own-data and rejected before storage/model access', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-source-policy-constructor-'));
  const base = { path: join(directory, 'memory.sqlite'),
    namespace: { ownerId: 'synthetic-owner', scope: 'personal', projectId: null } };
  for (const value of [undefined, null, false, 1, '', 'bounded-keyset-v2', {}]) {
    assert.throws(() => createCairnServer({ ...base, sourceCandidatePolicy: value }), /invalid_mcp_configuration/);
    assert.deepEqual(readdirSync(directory), []);
  }
  let getterCalls = 0;
  for (const options of [
    { ...base, get sourceCandidatePolicy() { getterCalls++; return policy; } },
    Object.create({ sourceCandidatePolicy: policy }, Object.getOwnPropertyDescriptors(base)),
  ]) {
    assert.throws(() => createCairnServer(options), /invalid_mcp_configuration/);
    assert.equal(getterCalls, 0);
    assert.deepEqual(readdirSync(directory), []);
  }
});

test('Z3–Z5 server snapshots policy, selects only visible source labels, and rejects per-call spoofing',
  { timeout: 60000 }, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'cairn-source-policy-flow-'));
    const path = join(directory, 'memory.sqlite');
    const namespace = { ownerId: 'synthetic-source-policy', scope: 'personal', projectId: null };
    const core = openMemoryCore({ path });
    const admitted = [];
    try {
      for (let index = 0; index < 1025; index++) {
        const source = `policymarker${String(index).padStart(5, '0')} retained source`;
        const saved = core.admit({ namespace,
          memory: { content: `Generic synthetic entry ${String(index).padStart(5, '0')}`, kind: 'fact' },
          receipts: [{ client: 'synthetic', sessionId: 'snapshot', eventId: `event-${index}`,
            role: 'user', excerpt: source }] });
        assert.equal(saved.ok, true, JSON.stringify(saved));
        admitted.push({ id: saved.value.memory.id, source });
      }
    } finally { core.close(); }
    const target = admitted.toSorted((a, b) => a.id.localeCompare(b.id)).at(-1);
    const query = target.source.split(' ')[0];
    const seen = [];
    const model = { countTokens: () => 1, contextWindow: 16384,
      select: ({ input }) => {
        seen.push({ stage: 'select', query: input.query, visible: input.maps.flatMap(page => page.items
          .map(item => item.label)) });
        return { refs: input.maps.flatMap(page => page.items.filter(item =>
          item.label?.split(/\s+/u).includes(input.query)).map(item => ({ namespaceIndex: page.namespaceIndex,
          ...(item.type === 'unfiled' ? item.ref : { memoryId: item.ref.childId,
            revision: item.ref.childRevision }) }))).slice(0, input.maxRefs) };
      },
      rank: ({ input }) => {
        seen.push({ stage: 'rank' });
        return { refs: input.candidates.filter(item => item.receipts?.some(receipt =>
          receipt.excerpt.split(/\s+/u).includes(input.query))).map(item => ({
          namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision })) };
      } };
    const start = async (sourceCandidatePolicy, recallContext) => {
      const options = { path, namespace, model,
        ...(sourceCandidatePolicy ? { sourceCandidatePolicy } : {}),
        ...(recallContext ? { recallContext } : {}) };
      const server = createCairnServer(options);
      // Mutate the very object supplied to createCairnServer after construction.
      options.sourceCandidatePolicy = sourceCandidatePolicy ? 'invalid-after-start' : policy;
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      const client = new Client({ name: 'synthetic-policy-test', version: '1.0.0' });
      await client.connect(clientTransport);
      t.after(() => client.close()); t.after(() => server.close());
      return client;
    };
    const call = async (client, args) => {
      const response = await client.callTool({ name: 'recall_memory', arguments: args });
      return JSON.parse(response.content[0].text);
    };
    const ordinary = await start(undefined);
    assert.equal((await ordinary.listTools()).tools.length, 5);
    assert.equal((await call(ordinary, { query, contextMode: 'source-evidence', limit: 1 })).value.memories.length, 0);
    await ordinary.close();
    const opted = await start(policy);
    assert.equal((await call(opted, { query, limit: 1 })).value.memories.length, 0, 'body-only stays old');
    for (const contextMode of ['source-evidence', 'rationale-evidence']) {
      const result = await call(opted, { query, contextMode, limit: 1 });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.value.memories[0]?.memory.id, target.id);
      assert.equal(result.value.memories[0]?.receipts[0]?.excerpt, target.source);
      assert.ok(seen.some(event => event.stage === 'select' && event.visible.some(label => label.includes(query))));
    }
    const beforeSpoof = seen.length;
    for (const spoof of [{ sourceCandidatePolicy: policy }, { ownerId: 'foreign' },
      { namespace: { ownerId: 'foreign' } }, { path: '/tmp/foreign.sqlite' },
      { contextMode: 'source-evidence', includeQualification: true }]) {
      try {
        const response = await opted.callTool({ name: 'recall_memory', arguments: { query, ...spoof } });
        assert.equal(response.isError, true);
      } catch (error) { if (error instanceof assert.AssertionError) throw error; }
      assert.equal(seen.length, beforeSpoof, 'invalid tool call must not invoke model');
    }
    await opted.close();
    const preference = await start(policy, 'source-evidence');
    assert.equal((await call(preference, { query, limit: 1 })).value.memories[0]?.memory.id, target.id);
    assert.equal((await call(preference, { query, includeQualification: false, limit: 1 })).value.memories[0]?.memory.id,
      target.id);
    assert.equal((await call(preference, { query, contextMode: 'rationale-evidence', limit: 1 })).value.memories[0]?.memory.id,
      target.id);
    await preference.close();
  });
