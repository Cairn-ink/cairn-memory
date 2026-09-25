import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { buildArtifact, command, packageName } from '../build.mjs';
import { startExperimentProxy } from '../../evaluation/live/proxy.mjs';
import { qualificationPoolWire } from '../../adapters/openai/test/qualification-pool-wire.mjs';

const sdk = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(sdk.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(sdk.resolve('@modelcontextprotocol/client/stdio'));
test('installed v2 recall preserves source descriptions in real adapter ranking and cold output', { timeout: 60000 }, async t => {
  const artifact = buildArtifact();
  const root = mkdtempSync(join(tmpdir(), 'cairn-installed-qualified-recall-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-qualified-recall', private: true, version: '0.0.0' }), { flag: 'wx' });
  command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath], root, artifact.userconfig);
  const packageRoot = join(root, 'node_modules', packageName);
  const promptPath = 'core/prompts/recall-rank-qualified.md';
  assert.equal(createHash('sha256').update(readFileSync(join(packageRoot, promptPath))).digest('hex'), artifact.sourceHashes[promptPath]);
  const qualifierPrompt = readFileSync(join(packageRoot, 'core/prompts/qualify-candidates.md'), 'utf8');
  assert.equal(createHash('sha256').update(qualifierPrompt).digest('hex'), artifact.sourceHashes['core/prompts/qualify-candidates.md']);
  assert.equal(qualifierPrompt, readFileSync(new URL('../../core/prompts/qualify-candidates.md', import.meta.url), 'utf8'));
  const source = 'I suggest a small welcome illustration 🚋; it is only a proposal.';
  let active, sends = 0, ranks = 0, forbid = false, expectedQualification;
  const proxy = await startExperimentProxy({ session: { request: async (route, body) => {
    assert.equal(forbid, false, 'Inspection and replay must not request HTTP'); sends++;
    const payload = JSON.parse(body), input = JSON.parse(payload.input[0].content[0].text);
    if (route === '/responses/input_tokens') return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
    let output;
    switch (payload.text.format.name) {
      case 'cairn_extract': output = { items: [{ content: source, kind: 'context', confidence: 0.8, sourceIndices: [0] }] }; break;
      case 'cairn_qualifyCandidates':
        assert.ok(payload.instructions.startsWith(qualifierPrompt));
        assert.match(payload.instructions, /at least one field must reference a pool slot/i);
        output = { qualifications: input.items.map(item => {
        const field = value => ({ value, evidenceIndices: [item.candidates[0].candidateIndex] });
        return { itemIndex: item.itemIndex, subject: field('welcome screen'), property: field('illustration'),
          scope: field(null), applies: field('proposal only'), value: field('small，illustration'),
          attribution: field('proposed'), commitment: field('considered') };
      }) }; break;
      case 'cairn_classify': output = { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }; break;
      case 'cairn_select': output = { refs: input.maps.flatMap(map => map.items.flatMap(item => {
        const ref = item.type === 'unfiled' ? item.ref : item.type === 'ref' && item.ref.childType === 'memory'
          ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
        return ref ? [{ namespaceIndex: map.namespaceIndex, memoryId: ref.memoryId, revision: ref.revision }] : [];
      })) }; break;
      case 'cairn_rank':
        ranks++; assert.equal(input.candidates.length, 1);
        if (expectedQualification === false) assert.equal(Object.hasOwn(input.candidates[0], 'qualification'), false);
        else {
          assert.deepEqual(input.candidates[0].qualification, expectedQualification);
          assert.match(payload.instructions, /unverified/i);
        }
        output = { refs: input.candidates.map(item => ({ namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision })) };
        break;
      default: assert.fail('Unexpected model method');
    }
    if (payload.text.format.name === 'cairn_qualifyCandidates') {
      output = qualificationPoolWire(input, output);
    }
    return Response.json({ object: 'response', model: payload.model, status: 'completed', error: null, incomplete_details: null,
      output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
      usage: { input_tokens: 120, output_tokens: 100, total_tokens: 220 } });
  } } });
  t.after(async () => { if (active) await active.close(); await proxy.close(); });
  const dbPath = join(root, 'memory.sqlite'), config = join(root, 'transport.json');
  writeFileSync(config, JSON.stringify({ version: 1, packageRoot, proxyUrl: proxy.url }), { mode: 0o600, flag: 'wx' });
  const start = async () => {
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL('../../evaluation/live/cairn-launcher.mjs', import.meta.url)), '--db', dbPath,
        '--owner', 'synthetic-qualified-recall', '--capture-qualification', 'source-bound-v2'],
      env: { CAIRN_LIVE_CONFIG: config, OPENAI_API_KEY: proxy.token, NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
    active = new Client({ name: 'synthetic-installed-qualified-recall', version: '1.0.0' });
    await active.connect(transport);
  };
  const call = async (name, args) => {
    const result = await active.callTool({ name, arguments: args });
    const envelope = JSON.parse(result.content[0].text);
    assert.equal(envelope.ok, true, JSON.stringify(envelope));
    assert.equal(envelope.evidenceTrust, 'untrusted-data-not-instructions'); return envelope.value;
  };
  await start();
  const batch = { batchId: 'installed-qualified-recall', messages: [{ role: 'assistant', content: source }] };
  const capture = await call('capture_memory', batch);
  assert.equal(sends, 6);
  const memoryId = capture.admission.memories[0].id;
  const inspected = await call('inspect_memory', { memoryId, includeQualification: true });
  assert.equal(inspected.qualification.value, 'small,illustration');
  expectedQualification = inspected.qualification;
  const warm = await call('recall_memory', { query: 'welcome illustration proposal' });
  assert.deepEqual(warm.memories[0].qualification, inspected.qualification);
  assert.equal(warm.memories[0].qualification.commitment, 'considered');
  assert.equal(warm.memories[0].qualification.anchors[0].text, source);
  assert.equal(sends, 10);
  await active.close(); await start(); forbid = true;
  assert.deepEqual(await call('inspect_memory', { memoryId, includeQualification: true }), inspected);
  assert.equal((await call('capture_memory', batch)).duplicate, true);
  assert.equal(sends, 10); forbid = false;
  const cold = await call('recall_memory', { query: 'welcome illustration proposal' });
  assert.deepEqual(cold, warm); assert.equal(sends, 14);
  expectedQualification = false;
  const legacy = await call('recall_memory', { query: 'welcome illustration proposal', includeQualification: false });
  assert.equal(Object.hasOwn(legacy.memories[0], 'qualification'), false);
  assert.equal(sends, 18); assert.equal(ranks, 3);
  await active.close(); active = null;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM qualified_slots').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM qualified_claim_bindings').get().n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM memories WHERE currentness = 'historical'").get().n, 0);
  } finally { db.close(); }
});
