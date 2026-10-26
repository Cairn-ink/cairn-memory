import test from 'node:test';
import assert from 'node:assert/strict';
import { contextProviderConfiguration, parseContextRefresh } from '../../mcp/context-read-configuration.mjs';
import { prepareContextEmbedding, localCheckConfiguration, contextEmbeddingPort } from '../../mcp/context-read-provider.mjs';
import { parseModelCommand, modelCommand } from '../../mcp/model-command.mjs';
const local = ['--context-embedder','local','--context-embed-model','bge-m3','--context-embed-dimensions','1024','--context-embed-pack','/nonexistent/pack','--context-embed-max-requests','5'];
const map = args => new Map(Array.from({ length: args.length / 2 }, (_, i) => [args[i * 2], args[i * 2 + 1]]));
test('L01/L02 local discriminator, exact resource defaults and hosted grammar remain independent', () => {
  assert.equal(contextProviderConfiguration(new Map()), undefined);
  const c = contextProviderConfiguration(map(local));
  assert.deepEqual(c, { provider: 'local', model: 'bge-m3', dimensions: 1024, packPath: '/nonexistent/pack', maxRequests: 5, threads: 4 });
  assert.deepEqual(localCheckConfiguration(c), { packStatus: 'not-inspected', revision: null, runtimeLoaded: false, childStarted: false, networkAccessed: false, qualification: localCheckConfiguration(c).qualification, maxConcurrent: 1, maxBatchDocuments: 1, interOpThreads: 1 });
  for (const change of [['--context-embed-max-usd','0'],['--context-embed-model','other'],['--context-embed-dimensions','1536'],['--context-embed-pack','relative'],['--context-embed-threads','65']]) {
    const v = map(local); v.set(...change); assert.throws(() => contextProviderConfiguration(v), /invalid_mcp_configuration/);
  }
  for (let i = 0; i < local.length; i += 2) { const v = map(local); v.delete(local[i]); assert.throws(() => contextProviderConfiguration(v), /invalid_mcp_configuration/); }
  const hosted = map(['--context-embedder','openai','--context-embed-model','text-embedding-3-small','--context-embed-dimensions','1536','--context-embed-max-requests','5','--context-embed-max-usd','.1']);
  assert.deepEqual(contextProviderConfiguration(hosted), { provider:'openai', model:'text-embedding-3-small', dimensions:1536, maxRequests:5, maxUsd:.1 });
  for (const flag of ['--context-embed-pack','--context-embed-threads']) { const v = new Map(hosted); v.set(flag,'4'); assert.throws(() => contextProviderConfiguration(v), /invalid_mcp_configuration/); }
});
test('L02 management and refresh arity/order/duplicates/adjacent booleans cause no operations', async () => {
  let operations = 0; const outputs = [];
  await modelCommand(['verify','bge-m3','--check-config','--dir','/nonexistent/pack'], { verify() { operations++; }, output: v => outputs.push(v) });
  assert.equal(operations,0); assert.equal(outputs[0].packStatus,'not-inspected');
  for (const args of [[],['remove','bge-m3','--dir','/pack'],['install','other','--dir','/pack'],['verify','bge-m3','--dir','relative'],['verify','bge-m3','--dir','--check-config'],['verify','bge-m3','--dir','/a','--dir','/b'],['verify','bge-m3','--dir','/a','--check-config','--check-config']]) assert.throws(() => parseModelCommand(args), { code:'invalid_model_configuration' });
  const args = ['refresh','--db','/store','--owner','owner','--types','memory','--intent','current','--max-items','5','--max-ms','5000',...local];
  assert.equal(parseContextRefresh([...args,'--check-config']).provider.threads,4);
  for (const extra of [['--context-read','context-read-v1'],['--max-ms','2'],['--context-embed-threads','--check-config'],['unexpected']]) assert.throws(() => parseContextRefresh([...args,...extra]), /invalid_mcp_configuration/);
});
test('L12 unavailable provider uses only catalog identity, never keys or unverified metadata', async () => {
  const env = Object.defineProperty({}, 'OPENAI_API_KEY', { get() { assert.fail('key lookup'); } });
  const hash = 'a'.repeat(64);
  const handle = await prepareContextEmbedding(contextProviderConfiguration(map(local)), env, { catalog:[{packId:'bge-m3',manifestHash:hash}],
    createLocal: async () => { throw Object.assign(Error('CANARY_PATH'),{code:'model_pack_integrity'}); } });
  assert.equal(handle.embedder.revision,'sha256:'+hash); assert.deepEqual(handle.localStatus(),{state:'unavailable',reason:'model_pack_integrity'});
  await assert.rejects(handle.embedder.embed(['synthetic']),{code:'provider_error'});
  assert.deepEqual(Object.keys(contextEmbeddingPort(handle)).sort(),['embedder','localStatus','policy']); await handle.close();
});
