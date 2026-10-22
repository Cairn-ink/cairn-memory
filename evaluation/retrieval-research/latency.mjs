import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCLI, environment, loadSelection, configurations, defaultEmbedder, configurationName, checkSelectionHashes, isolationFixture } from './run.mjs';
import { createArm, includeForArm } from './lib/arms.mjs';
import { OPENAI_MODELS, publicErrorCode } from './lib/embed-openai.mjs';
import { createApiLedger } from './lib/api-ledger.mjs';
import { frozenA0Stores } from './lib/a0-core.mjs';

// Frozen xorshift32 / Fisher–Yates; randomize full request passes, not averages.
export function shuffled(values, seed) {
  let state = seed >>> 0 || 1;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 2 ** 32; };
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
// Nearest-rank empirical request-level percentiles, no interpolation.
export function percentile(samples, p) {
  if (!samples.length) return null;
  const values = [...samples].sort((a, b) => a - b);
  return values[Math.max(0, Math.ceil(p * values.length) - 1)];
}
export async function measureLatency({ queries, search, passes = 5, seed = 0x485231 }) {
  if (passes !== 5) throw new Error('hr1_requires_five_latency_passes');
  const samples = [];
  for (let pass = 0; pass < passes; pass++) for (const query of shuffled(queries, seed + pass)) {
    const started = performance.now();
    try {
      await search(query, { bypassCache: true });
      samples.push({ queryId: query.queryId, pass, ms: performance.now() - started });
    } catch (error) { samples.push({ queryId: query.queryId, pass, ms: null, elapsedMs: performance.now() - started, error: publicErrorCode(error) }); }
  }
  const successful = samples.filter(sample => !sample.error).map(sample => sample.ms);
  return { samples, p50: percentile(successful, 0.5), p95: percentile(successful, 0.95),
    failures: samples.length - successful.length, passes, batchSize: 1, seed, queryCache: 'bypassed', percentileMethod: 'nearest-rank' };
}
export async function runLatency(options, { fixtureAPI, embedderFactory = defaultEmbedder } = {}) {
  const { selection, lexical } = await loadSelection(options), configs = configurations(options, selection);
  const api = fixtureAPI ?? await import('./lib/fixture.mjs');
  const isolationVariant = options.isolationVariant ?? 'with-foreign';
  const fixture = isolationFixture(await api.loadFixture(options.fixtureDir), isolationVariant);
  checkSelectionHashes(selection, fixture.hashes);
  const queries = api.armQueries(fixture, { split: options.split });
  if (!queries.length) throw new Error('no_projected_queries');
  const project = (intent, include) => api.armDocuments(fixture, { namespace: 'target', scale: options.scale, intent, include });
  const ledger = configs.some(config => OPENAI_MODELS[config.model]) ? createApiLedger(options.ledgerPath) : null;
  const embedders = new Map(), runs = [], startedAt = new Date().toISOString();
  let stores;
  try {
    for (const config of configs) {
      const indexes = new Map(), before = ledger?.summary();
      try {
        if (config.model && !embedders.has(config.model)) embedders.set(config.model, await embedderFactory(config.model, options, ledger));
        const embedder = embedders.get(config.model);
        if (config.arm.startsWith('A0-') && !stores) stores = frozenA0Stores({ directory: options.storeDir, scale: options.scale,
          history: project('history', 'body'), current: project('current', 'body'), spans: project('history', 'spans') });
        const variants = config.arm.startsWith('A0-') ? stores.map((store, index) => ({ store, index })) : [{ store: null, index: null }];
        const indexStart = performance.now();
        if (!config.arm.startsWith('A0-')) for (const intent of new Set(queries.map(q => q.intent)))
          indexes.set(intent, await createArm({ ...config, documents: project(intent, includeForArm(config.arm)), embedder, lexical }));
        const indexBuildMs = performance.now() - indexStart;
        for (const variant of variants) {
          const search = variant.store ? query => {
            const result = variant.store.search(query, { paged: config.arm === 'A0-paged' });
            if (result.errors.length) throw new Error(`a0_timing_${result.errors[0].code}`); return result;
          } :
            (query, requestOptions) => indexes.get(query.intent).search(query, requestOptions);
          // Untimed warm-up: document indexing is done, and each intent executes
          // a batch-one request before measurement. Hosted warm-ups also bill.
          for (const intent of new Set(queries.map(q => q.intent))) await search(queries.find(q => q.intent === intent), { bypassCache: true });
          const timing = await measureLatency({ queries, search });
          const after = ledger?.summary();
          runs.push({ format: 'hr1-latency-v1', run: { arm: config.arm, config: configurationName(config),
            model: config.model, scale: options.scale, split: options.split, store: variant.index, isolationVariant, lexical,
            fixtureHashes: fixture.hashes, env: environment(), startedAt, finishedAt: new Date().toISOString() },
            ...config, store: variant.index, lexical, ...timing, queryCacheEnabled: false, indexBuildMs,
            embedDocs: [...indexes.values()].reduce((n, index) => n + index.costs.embedDocs, 0),
            embedMsPerDoc: (() => { const list = [...indexes.values()]; return list.reduce((n, index) => n + index.costs.embedDocs * index.costs.embedMsPerDoc, 0) / Math.max(1, list.reduce((n, index) => n + index.costs.embedDocs, 0)); })(),
            coldLoadMs: embedder?.metadata.coldLoadMs ?? 0, modelMetadata: embedder?.metadata ?? null,
            device: embedder?.metadata.device ?? 'cpu', threads: embedder?.metadata.threads ?? 1,
            peakRssBytes: process.resourceUsage().maxRSS * 1024,
            costs: after ? { apiTokens: after.apiTokens - before.apiTokens, apiSpendUsd: after.apiSpendUsd - before.apiSpendUsd,
              apiCommittedUsd: after.committedUsd - before.committedUsd, ledger: after } : { apiTokens: 0, apiSpendUsd: 0 },
            gatePassed: timing.failures === 0 && timing.p95 !== null && timing.p95 < (OPENAI_MODELS[config.model] ? 1000 : 200) });
        }
      } catch (error) { runs.push({ format: 'hr1-latency-v1', run: { arm: config.arm, config: configurationName(config),
        model: config.model, scale: options.scale, split: options.split, store: null, isolationVariant, status: 'unavailable',
        fixtureHashes: fixture.hashes, env: environment(), startedAt, finishedAt: new Date().toISOString() },
        ...config, samples: [], error: publicErrorCode(error), gatePassed: false, costs: ledger?.summary() ?? null }); }
      finally { for (const index of indexes.values()) index.close(); }
    }
    const output = { format: 'hr1-latency-v1', env: environment(), fixtureHashes: fixture.hashes, scale: options.scale,
      split: options.split, startedAt, finishedAt: new Date().toISOString(), peakRssBytes: process.resourceUsage().maxRSS * 1024, runs };
    const multiple = runs.length > 1, files = [];
    await mkdir(multiple ? options.out : dirname(options.out), { recursive: true });
    for (const record of runs) {
      const r = record.run;
      const path = multiple ? join(options.out, [r.arm, r.model, r.store === null ? null : `store${r.store}`].filter(x => x !== null).join('--') + '.json') : options.out;
      await writeFile(path, JSON.stringify(record, null, 2) + '\n'); files.push(path);
    }
    return { ...output, files };
  } finally {
    for (const store of stores ?? []) store.close();
    for (const embedder of embedders.values()) await embedder.close?.();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => runLatency(parseCLI())).then(result => { console.log(`latency runs: ${result.runs.length}`);
    if (result.runs.some(run => run.error || run.failures)) process.exitCode = 1;
  }).catch(error => { console.error(publicErrorCode(error)); process.exitCode = 1; });
}
