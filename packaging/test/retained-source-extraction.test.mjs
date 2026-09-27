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
import { qualificationPoolWire } from '../../adapters/openai/test/qualification-pool-wire.mjs';
const sdk = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(sdk.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(sdk.resolve('@modelcontextprotocol/client/stdio'));

test('installed v2 uses only retained source views, reports omitted tails, and cold-replays without HTTP', { timeout: 60000 }, async t => {
  const artifact = buildArtifact();
  const root = mkdtempSync(join(tmpdir(), 'cairn-installed-retained-source-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-retained-source', private: true, version: '0.0.0' }), { flag: 'wx' });
  command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath], root, artifact.userconfig);
  const packageRoot = join(root, 'node_modules', packageName), prompt = 'core/prompts/extract-retained-sources.md';
  assert.equal(createHash('sha256').update(readFileSync(join(packageRoot, prompt))).digest('hex'), artifact.sourceHashes[prompt]);
  const beginning = 'I recommend system A because it supports offline reading. ';
  const prefix = beginning + 'x'.repeat(800 - beginning.length);
  const tail = ' TAIL_ONLY_UNRETAINED_MESSAGE';
  const response = 'That offline claim is wrong. I have not chosen an alternative.';
  const batch = { batchId: 'retained-source-installed', messages: [
    { role: 'assistant', content: prefix + tail }, { role: 'user', content: response }] };
  let active, sends = 0, forbid = false, inspected;
  const proxy = await startExperimentProxy({ session: { request: async (route, body) => {
    assert.equal(forbid, false); assert.equal(body.includes('TAIL_ONLY_UNRETAINED_MESSAGE'), false); sends++;
    const payload = JSON.parse(body), input = JSON.parse(payload.input[0].content[0].text);
    if (route === '/responses/input_tokens') return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
    let output;
    switch (payload.text.format.name) {
      case 'cairn_extract':
        assert.deepEqual(input.messages, [{ index: 0, role: 'assistant', content: prefix }, { index: 1, role: 'user', content: response }]);
        assert.match(payload.instructions, /antecedent/i);
        output = { items: [{ content: 'The user challenged the offline claim for A without choosing an alternative.', kind: 'context', confidence: 0.8, sourceIndices: [1, 0] }] };
        break;
      case 'cairn_qualifyCandidates': {
        const item = input.items[0];
        assert.equal(item.candidates[0].text, response);
        assert.equal(item.candidates.slice(1).map(candidate => candidate.text).join(''), prefix);
        const unknown = value => ({ value, evidenceIndices: [item.candidates[0].candidateIndex, item.candidates[1].candidateIndex] });
        output = { qualifications: [{ itemIndex: item.itemIndex, subject: unknown(null), property: unknown(null), scope: unknown(null),
          applies: unknown(null), value: unknown(null), attribution: unknown('unknown'), commitment: unknown('unknown') }] };
        break;
      }
      case 'cairn_classify': output = { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }; break;
      case 'cairn_select': output = { refs: input.maps.flatMap(map => map.items.flatMap(item => {
        const ref = item.type === 'unfiled' ? item.ref : item.type === 'ref' && item.ref.childType === 'memory'
          ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
        return ref ? [{ namespaceIndex: map.namespaceIndex, memoryId: ref.memoryId, revision: ref.revision }] : [];
      })) }; break;
      case 'cairn_rank':
        assert.deepEqual(input.candidates[0].qualification, inspected.qualification);
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
  const config = join(root, 'transport.json');
  writeFileSync(config, JSON.stringify({ version: 1, packageRoot, proxyUrl: proxy.url }), { mode: 0o600, flag: 'wx' });
  const start = async () => {
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL('../../evaluation/live/cairn-launcher.mjs', import.meta.url)), '--db', join(root, 'memory.sqlite'),
        '--owner', 'synthetic-retained-source', '--capture-qualification', 'source-bound-v2'],
      env: { CAIRN_LIVE_CONFIG: config, OPENAI_API_KEY: proxy.token, NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
    active = new Client({ name: 'synthetic-installed-retained-source', version: '1.0.0' });
    await active.connect(transport);
  };
  const call = async (name, args) => {
    const result = await active.callTool({ name, arguments: args }); const envelope = JSON.parse(result.content[0].text);
    assert.equal(envelope.evidenceTrust, 'untrusted-data-not-instructions');
    assert.equal(envelope.ok, true, JSON.stringify(envelope)); return envelope.value;
  };
  await start(); const captured = await call('capture_memory', batch);
  assert.equal(sends, 6);
  assert.deepEqual(captured.retainedSourceWindow, { maxUnitsPerMessage: 800, truncatedMessageIndices: [0] });
  const memoryId = captured.admission.memories[0].id;
  inspected = await call('inspect_memory', { memoryId, includeQualification: true });
  assert.equal(inspected.receipts.find(item => item.role === 'assistant').excerpt, prefix);
  assert.equal(inspected.receipts.find(item => item.role === 'user').excerpt, response);
  assert.equal(inspected.qualification.anchors.length, 2);
  const recalled = await call('recall_memory', { query: 'offline A alternative' });
  assert.deepEqual(recalled.memories[0].qualification, inspected.qualification);
  assert.equal(sends, 10); await active.close(); await start(); forbid = true;
  assert.deepEqual(await call('inspect_memory', { memoryId, includeQualification: true }), inspected);
  const replay = await call('capture_memory', batch);
  assert.equal(replay.duplicate, true); assert.deepEqual(replay.retainedSourceWindow, captured.retainedSourceWindow);
  assert.equal(sends, 10);
  const changed = structuredClone(batch); changed.messages[0].content += ' changed';
  const result = await active.callTool({ name: 'capture_memory', arguments: changed });
  assert.equal(JSON.parse(result.content[0].text).error.code, 'event_payload_conflict');
  assert.equal(sends, 10);
});
