import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildArtifact, command, packageName } from '../build.mjs';
import { startExperimentProxy } from '../../evaluation/live/proxy.mjs';

const sdk = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(sdk.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(sdk.resolve('@modelcontextprotocol/client/stdio'));

test('installed source context omits deliberately wrong interpretations from rank and final output', { timeout: 60000 }, async t => {
  const artifact = buildArtifact(), root = mkdtempSync(join(tmpdir(), 'cairn-installed-source-context-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-source-context', private: true, version: '0.0.0' }), { flag: 'wx' });
  command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath], root, artifact.userconfig);
  const packageRoot = join(root, 'node_modules', packageName);
  const promptPath = 'core/prompts/recall-rank-source-evidence.md';
  const prompt = readFileSync(join(packageRoot, promptPath), 'utf8');
  assert.equal(createHash('sha256').update(prompt).digest('hex'), artifact.sourceHashes[promptPath]);
  const messages = [{ role: 'assistant', content: 'You could take the overnight train.' },
    { role: 'user', content: 'Do those compartments have secure luggage lockers?' }];
  const wrong = 'The user chose the overnight train with secure luggage lockers.';
  let active, sends = 0, forbid = false, sourceMode = true;
  const assertSources = item => {
    assert.deepEqual(Object.keys(item).filter(key => key !== 'namespaceIndex').sort(),
      ['interpretationStatus', 'memory', 'receiptCount', 'receipts', 'sourceSelectionCoverage'].sort());
    assert.deepEqual(Object.keys(item.memory).sort(), ['currentness', 'id', 'revision']);
    assert.equal(item.interpretationStatus, 'omitted'); assert.equal(item.sourceSelectionCoverage, 'unassessed');
    assert.equal(item.receiptCount, 2);
    assert.deepEqual(item.receipts.map(r => ({ role: r.role, content: r.excerpt })).sort((a,b) => a.role.localeCompare(b.role)), messages);
    for (const receipt of item.receipts) assert.deepEqual(Object.keys(receipt).sort(), ['excerpt', 'id', 'role']);
    assert.ok(!JSON.stringify(item).includes(wrong));
    assert.ok(!JSON.stringify(item).includes('adopted'));
  };
  const proxy = await startExperimentProxy({ session: { request: async (route, body) => {
    assert.equal(forbid, false); sends++;
    const payload = JSON.parse(body), input = JSON.parse(payload.input[0].content[0].text);
    if (route === '/responses/input_tokens') return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
    let output;
    switch (payload.text.format.name) {
      case 'cairn_extract': output = { items: [{ content: wrong, kind: 'decision', confidence: 0.99, sourceIndices: [0,1] }] }; break;
      case 'cairn_qualifyCandidates': output = { qualifications: input.items.map(item => {
        const field = value => ({ value, evidenceIndices: [item.candidates[0].candidateIndex] });
        return { itemIndex: item.itemIndex, subject: field('user'), property: field('travel choice'),
          scope: field(null), applies: field(null), value: field('overnight train'),
          attribution: field('direct'), commitment: field('adopted') };
      }) }; break;
      case 'cairn_classify': output = { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }; break;
      case 'cairn_select': output = { refs: input.maps.flatMap(map => map.items.filter(item => item.type === 'unfiled')
        .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) }; break;
      case 'cairn_rank':
        assert.equal(input.candidates.length, 1);
        if (sourceMode) { assertSources(input.candidates[0]); assert.equal(payload.instructions, prompt); }
        else { assert.equal(input.candidates[0].memory.content, wrong); assert.equal(input.candidates[0].qualification.commitment, 'adopted'); }
        output = { refs: input.candidates.map(item => ({ namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision })) }; break;
      default: assert.fail('Unexpected method');
    }
    return Response.json({ object: 'response', model: payload.model, status: 'completed', error: null, incomplete_details: null,
      output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
      usage: { input_tokens: 120, output_tokens: 100, total_tokens: 220 } });
  } } });
  t.after(async () => { if (active) await active.close(); await proxy.close(); });
  const config = join(root, 'transport.json');
  writeFileSync(config, JSON.stringify({ version: 1, packageRoot, proxyUrl: proxy.url }), { mode: 0o600, flag: 'wx' });
  const start = async () => {
    active = new Client({ name: 'synthetic-source-context', version: '1.0.0' });
    await active.connect(new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL('../../evaluation/live/cairn-launcher.mjs', import.meta.url)),
        '--db', join(root, 'memory.sqlite'), '--owner', 'synthetic-source-context', '--capture-qualification', 'source-bound-v2'],
      env: { CAIRN_LIVE_CONFIG: config, OPENAI_API_KEY: proxy.token, NODE_NO_WARNINGS: '1' }, stderr: 'ignore' }));
  };
  const call = async (name, args) => {
    const r = await active.callTool({ name, arguments: args }), envelope = JSON.parse(r.content[0].text);
    assert.equal(envelope.ok, true, JSON.stringify(envelope));
    assert.equal(envelope.evidenceTrust, 'untrusted-data-not-instructions'); return envelope.value;
  };
  await start();
  const batch = { batchId: 'synthetic-source-context', messages };
  const captured = await call('capture_memory', batch); assert.equal(sends, 6);
  const memoryId = captured.admission.memories[0].id;
  const inspection = await call('inspect_memory', { memoryId, includeQualification: true });
  assert.equal(inspection.memory.content, wrong); assert.equal(inspection.qualification.commitment, 'adopted');
  const query = { query: 'What did the user ask about the train?', contextMode: 'source-evidence' };
  const warm = await call('recall_memory', query); assertSources(warm.memories[0]); assert.equal(sends, 10);
  await active.close(); await start(); forbid = true;
  assert.deepEqual(await call('inspect_memory', { memoryId, includeQualification: true }), inspection);
  assert.equal((await call('capture_memory', batch)).duplicate, true); assert.equal(sends, 10); forbid = false;
  const cold = await call('recall_memory', query); assert.deepEqual(cold, warm); assert.equal(sends, 14);
  sourceMode = false;
  const legacy = await call('recall_memory', { query: query.query });
  assert.equal(legacy.memories[0].memory.content, wrong); assert.equal(sends, 18);
});
