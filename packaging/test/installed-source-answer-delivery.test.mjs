import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { command } from '../build.mjs';
import { installPreview } from '../install-preview.mjs';
import { startExperimentProxy } from '../../evaluation/live/proxy.mjs';
import { deliverInstalledSourceAnswer, SOURCE_ANSWER_MODEL } from '../../evaluation/live/installed-source-answer-delivery.mjs';
import { qualificationPoolWire } from '../../adapters/openai/test/qualification-pool-wire.mjs';

const sdk = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(sdk.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(sdk.resolve('@modelcontextprotocol/client/stdio'));
const fixture = JSON.parse(readFileSync(new URL('../../evaluation/live/source-loop-fixture.json', import.meta.url)))
  .cases.find(c => c.id === 'rill-battery');

test('ISAD5 generated installed command captures, restarts and delivers actual MOC receipts to one fake answer',
  { timeout: 120000 }, async t => {
    const directory = join(mkdtempSync(join(tmpdir(), 'cairn-installed-answer-')), 'new');
    const installation = installPreview(['--directory', directory, '--owner', 'synthetic-source-answer',
      '--capture-qualification', 'source-bound-v2'], {
      runCommand: (exe, args, cwd, userconfig) => command(exe, exe === 'npm' ? [...args, '--offline'] : args, cwd, userconfig),
    });
    const receipt = JSON.parse(readFileSync(installation.receiptPath));
    assert.deepEqual(receipt.stdio, installation.stdio);
    const wrong = 'WRONG_GENERATED_INTERPRETATION';
    let extracts = 0, requests = 0, active;
    const methods = [];
    const proxy = await startExperimentProxy({ session: { request: async (route, body) => {
      requests++; const payload = JSON.parse(body);
      if (route === '/responses/input_tokens') return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      const input = JSON.parse(payload.input[0].content[0].text), method = payload.text.format.name;
      methods.push(method); let output;
      switch (method) {
        case 'cairn_extract': extracts++; output = { items: input.messages.map((_, i) => ({
          content: `${wrong} ${extracts}-${i}`, kind: 'context', confidence: 0.9, sourceIndices: [i] })) }; break;
        case 'cairn_qualifyCandidates': output = { qualifications: input.items.map(item => {
          const field = value => ({ value, evidenceIndices: [item.candidates[0].candidateIndex] });
          return { itemIndex: item.itemIndex, subject: field(null), property: field(null), scope: field(null),
            applies: field(null), value: field(null), attribution: field('direct'), commitment: field('adopted') };
        }) }; break;
        case 'cairn_classify': output = { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }; break;
        case 'cairn_select': output = { refs: input.maps.flatMap(map => map.items.filter(item => item.type === 'unfiled')
          .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) }; break;
        case 'cairn_rank':
          assert.equal(JSON.stringify(input).includes(wrong), false);
          output = { refs: input.candidates.map(item => ({ namespaceIndex: item.namespaceIndex,
            memoryId: item.memory.id, revision: item.memory.revision })) }; break;
        default: assert.fail('unexpected model method');
      }
      if (payload.text.format.name === 'cairn_qualifyCandidates') {
        output = qualificationPoolWire(input, output);
      }
      return Response.json({ object: 'response', model: payload.model, status: 'completed', error: null, incomplete_details: null,
        output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } });
    } } });
    t.after(async () => { if (active) await active.close(); await proxy.close(); });
    const preload = `const nativeFetch=globalThis.fetch;globalThis.fetch=(url,options)=>{
      const target=new URL(url);if(target.origin!=='https://api.openai.com'||target.search||target.hash||
      !['/v1/responses','/v1/responses/input_tokens'].includes(target.pathname))throw new Error('test_route_denied');
      return nativeFetch(${JSON.stringify(proxy.url)}+target.pathname,options);};`;
    const env = { OPENAI_API_KEY: proxy.token, NODE_NO_WARNINGS: '1',
      NODE_OPTIONS: `--import=data:text/javascript;base64,${Buffer.from(preload).toString('base64')}` };
    const start = async () => {
      active = new Client({ name: 'synthetic-installed-answer', version: '1.0.0' });
      await active.connect(new StdioClientTransport({ ...receipt.stdio, env, stderr: 'ignore' }));
    };
    const call = async (name, args) => {
      const result = await active.callTool({ name, arguments: args });
      const envelope = JSON.parse(result.content[0].text);
      assert.equal(envelope.ok, true, JSON.stringify(envelope)); return { result, envelope };
    };
    await start();
    const capturedIds = [];
    for (const [i, window] of fixture.windows.entries()) {
      const { envelope } = await call('capture_memory', { batchId: `source-answer-${i}`,
        messages: window.map(({ role, content }) => ({ role, content })) });
      capturedIds.push(...envelope.value.admission.memories.map(m => m.id));
    }
    const args = { query: fixture.query, limit: 6, contextMode: 'source-evidence' };
    const warm = await call('recall_memory', args);
    await active.close(); const beforeRestart = requests; await start(); assert.equal(requests, beforeRestart);
    const cold = await call('recall_memory', args);
    assert.deepEqual(cold.envelope, warm.envelope);
    assert.deepEqual(new Set(cold.envelope.value.memories.map(item => item.memory.id)), new Set(capturedIds));
    const excerpts = cold.envelope.value.memories.flatMap(item => item.receipts.map(r => r.excerpt));
    for (const message of fixture.windows.flat()) assert.ok(excerpts.includes(message.content));
    let completions = 0;
    const answer = await deliverInstalledSourceAnswer({ question: fixture.query, toolResult: cold.result, complete: async body => {
      completions++; const context = JSON.parse(body.messages[1].content);
      assert.deepEqual(context.memory.sources, cold.envelope.value.memories);
      assert.equal(JSON.stringify(context).includes(wrong), false);
      assert.equal(JSON.stringify(context).includes('"qualification"'), false);
      assert.equal(JSON.stringify(context).includes('"basis"'), false);
      assert.equal(Object.hasOwn(body, 'tools'), false);
      assert.ok(JSON.stringify(context).includes('I have not selected a different bike.'));
      return { object: 'chat.completion', model: SOURCE_ANSWER_MODEL,
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Synthetic response: wiring only.' } }] };
    } });
    assert.equal(completions, 1); assert.equal(answer.status, 'generated-unassessed');
    assert.equal(methods.filter(m => m === 'cairn_select').length, 2);
    assert.equal(methods.filter(m => m === 'cairn_rank').length, 2);
    assert.equal(extracts, fixture.windows.length);
  });
