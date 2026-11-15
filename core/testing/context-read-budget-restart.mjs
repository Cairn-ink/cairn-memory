// Synthetic child: each invocation is a fresh process/day ledger on one store.
import { openMemoryCore } from '../index.mjs';
import { createFakeEmbedder } from '../context-read-embedder.mjs';
import { host, refresh, policy, ok } from './context-read-core-fixture.mjs';

const [path, fail, batch] = process.argv.slice(2), batchSize = Number(batch);
const trusted = host(), base = createFakeEmbedder({ dimensions: 8 });
let calls = 0, texts = 0;
const embedder = { ...base, id: 'synthetic-restart-budget', revision: '1', async embed(input, controls) {
  calls++; texts += input.length;
  if (fail === 'interrupt' && calls === 2) throw Object.assign(Error('provider_error'), { code: 'provider_error' });
  return base.embed(input, controls);
} };
const core = openMemoryCore({ path, contextRead: { version: 'context-read-v1', authority: trusted.authority,
  embedder, policy: policy({ family: 'hosted' }) } });
try {
  const run = maxItems => trusted.call(core, 'refreshContextIndex', refresh({ budget: { maxItems, maxMs: 5000 } }));
  if (fail === 'interrupt') {
    const first = ok(await run(batchSize));
    if (first.progress.embedded !== batchSize) throw Error('first_batch_not_committed');
    const second = ok(await run(batchSize));
    if (!second.channels.semantic.causes.includes('provider_error')) throw Error('interruption_not_observed');
  } else {
    const final = ok(await run(1024));
    if (final.status !== 'complete') throw Error('restart_did_not_complete');
  }
} finally { core.close(); }
console.log(JSON.stringify({ calls, texts }));
