import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { command } from '../build.mjs';
import { installPreview } from '../install-preview.mjs';
import { startExperimentProxy } from '../../evaluation/live/proxy.mjs';

const sdk = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(sdk.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(sdk.resolve('@modelcontextprotocol/client/stdio'));
function install(mode) {
  const directory = join(mkdtempSync(join(tmpdir(), 'cairn-qualified-receipt-')), 'new');
  const report = installPreview(['--directory', directory, '--owner', 'synthetic-receipt-owner',
    ...(mode ? ['--capture-qualification', mode] : [])], {
    runCommand: (executable, args, cwd, userconfig) => command(executable,
      executable === 'npm' ? [...args, '--offline'] : args, cwd, userconfig),
  });
  const receipt = JSON.parse(readFileSync(report.receiptPath, 'utf8'));
  assert.deepEqual(receipt.stdio, report.stdio); return receipt;
}
async function start(t, receipt, env) {
  const client = new Client({ name: 'synthetic-install-receipt', version: '1.0.0' });
  t.after(() => client.close());
  // Consume the generated command and args unchanged, including its mode flag.
  await client.connect(new StdioClientTransport({ command: receipt.stdio.command,
    args: receipt.stdio.args, env, stderr: 'ignore' }));
  return client;
}
async function call(client, name, args) {
  const response = await client.callTool({ name, arguments: args });
  const result = JSON.parse(response.content[0].text);
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(Boolean(response.isError), false);
  assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions'); return result.value;
}
test('I3 exact installed qualified receipt supports capture, both recall contexts, inspection and zero-HTTP cold replay',
  { timeout: 120000 }, async t => {
    const receipt = install('source-bound-v2');
    assert.equal(receipt.captureQualification, 'source-bound-v2');
    assert.equal(receipt.stdio.args.filter(arg => arg === '--capture-qualification').length, 1);
    const messages = [{ role: 'assistant', content: 'You could take the tram 🚋.' },
      { role: 'user', content: 'Does it have space for luggage?' }];
    const wrong = 'The user adopted the tram for luggage transport.';
    let requests = 0, forbid = false, context = 'source';
    const assertSources = item => {
      assert.deepEqual(Object.keys(item).filter(key => key !== 'namespaceIndex').sort(),
        ['interpretationStatus', 'memory', 'receiptCount', 'receipts', 'sourceSelectionCoverage'].sort());
      assert.deepEqual(Object.keys(item.memory).sort(), ['currentness', 'id', 'revision']);
      assert.equal(item.interpretationStatus, 'omitted'); assert.equal(item.sourceSelectionCoverage, 'unassessed');
      assert.equal(item.receiptCount, 2);
      assert.deepEqual(item.receipts.map(({ role, excerpt }) => ({ role, content: excerpt }))
        .sort((a, b) => a.role.localeCompare(b.role)), messages);
      assert.equal(JSON.stringify(item).includes(wrong), false);
    };
    const proxy = await startExperimentProxy({ session: { request: async (route, body) => {
      assert.equal(forbid, false, 'Cold inspection and duplicate replay must not request model HTTP'); requests++;
      const payload = JSON.parse(body), input = JSON.parse(payload.input[0].content[0].text);
      if (route === '/responses/input_tokens') return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      let output;
      switch (payload.text.format.name) {
        case 'cairn_extract':
          assert.deepEqual(input.messages.map(({ role, content }) => ({ role, content })), messages);
          output = { items: [{ content: wrong, kind: 'decision', confidence: 0.9, sourceIndices: [0, 1] }] }; break;
        case 'cairn_qualifyCandidates':
          output = { qualifications: input.items.map(item => {
            const field = value => ({ value, evidenceIndices: [item.candidates[0].candidateIndex] });
            return { itemIndex: item.itemIndex, subject: field(null), property: field(null), scope: field(null),
              applies: field(null), value: field(null), attribution: field('direct'), commitment: field('adopted') };
          }) }; break;
        case 'cairn_classify': output = { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }; break;
        case 'cairn_select': output = { refs: input.maps.flatMap(map => map.items.filter(item => item.type === 'unfiled')
          .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) }; break;
        case 'cairn_rank':
          assert.equal(input.candidates.length, 1);
          if (context === 'source') assertSources(input.candidates[0]);
          else assert.equal(input.candidates[0].qualification.commitment, 'adopted');
          output = { refs: input.candidates.map(item => ({ namespaceIndex: item.namespaceIndex,
            memoryId: item.memory.id, revision: item.memory.revision })) }; break;
        default: assert.fail('Unexpected model method');
      }
      if (payload.text.format.name === 'cairn_qualifyCandidates') {
        output.qualifications = Object.fromEntries(output.qualifications.map(item => ['item_' + item.itemIndex, item]));
      }
      return Response.json({ object: 'response', model: payload.model, status: 'completed', error: null, incomplete_details: null,
        output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } });
    } } });
    t.after(() => proxy.close());
    // Test-only preload replaces HTTP routing, not installed CLI arguments or
    // startup. Native external fetch is unreachable; only the parent proxy runs.
    const preload = `const nativeFetch=globalThis.fetch;globalThis.fetch=(url,options)=>{
      const target=new URL(url);if(target.origin!=='https://api.openai.com'||target.search||target.hash||
      !['/v1/responses','/v1/responses/input_tokens'].includes(target.pathname))throw new Error('test_route_denied');
      return nativeFetch(${JSON.stringify(proxy.url)}+target.pathname,options);};`;
    const env = { OPENAI_API_KEY: proxy.token, NODE_NO_WARNINGS: '1',
      NODE_OPTIONS: `--import=data:text/javascript;base64,${Buffer.from(preload).toString('base64')}` };
    const client = await start(t, receipt, env);
    assert.equal((await client.listTools()).tools.length, 6);
    const batch = { batchId: 'synthetic-install-capture', messages };
    const captured = await call(client, 'capture_memory', batch); assert.equal(requests, 6);
    assert.deepEqual(captured.retainedSourceWindow, { maxUnitsPerMessage: 800, truncatedMessageIndices: [] });
    const memoryId = captured.admission.memories[0].id;
    const query = 'What did the user ask about the tram?';
    const sourceRecall = await call(client, 'recall_memory', { query, contextMode: 'source-evidence' });
    assertSources(sourceRecall.memories[0]); assert.equal(requests, 10);
    context = 'qualified';
    const qualified = await call(client, 'recall_memory', { query });
    assert.equal(qualified.memories[0].qualification.commitment, 'adopted'); assert.equal(requests, 14);
    const inspection = await call(client, 'inspect_memory', { memoryId, includeQualification: true });
    assert.equal(inspection.memory.content, wrong); assert.equal(inspection.qualification.commitment, 'adopted');
    await client.close(); forbid = true;
    const cold = await start(t, receipt, env);
    assert.deepEqual(await call(cold, 'inspect_memory', { memoryId, includeQualification: true }), inspection);
    const replay = await call(cold, 'capture_memory', batch);
    assert.equal(replay.duplicate, true); assert.deepEqual(replay.retainedSourceWindow, captured.retainedSourceWindow);
    await cold.close(); assert.equal(requests, 14);
    const keyless = await start(t, receipt, { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1',
      NODE_OPTIONS: '--import=data:text/javascript,globalThis.fetch=()=>{throw%20new%20Error(%22no_http%22)}' });
    assert.equal((await call(keyless, 'capture_memory', batch)).duplicate, true);
    await keyless.close(); assert.equal(requests, 14);
  });

test('I3 absent installer mode keeps generated receipt and actual installed five-tool default', { timeout: 120000 }, async t => {
  const receipt = install(); assert.equal(Object.hasOwn(receipt, 'captureQualification'), false);
  assert.equal(receipt.stdio.args.includes('--capture-qualification'), false);
  const client = await start(t, receipt, { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' });
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 5); assert.equal(tools.some(tool => tool.name === 'capture_memory'), false);
});
