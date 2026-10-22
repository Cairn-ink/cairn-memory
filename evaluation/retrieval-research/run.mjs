import { parseArgs } from 'node:util';
import { cpus, totalmem, platform, release, availableParallelism } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { CONFIRMATORY } from './lib/fusion.mjs';
import { createArm, isFused, needsModel, includeForArm, FUSION_CONFIGS } from './lib/arms.mjs';
import { createLocalEmbedder, LOCAL_MODELS, MODEL_CACHE } from './lib/embed-local.mjs';
import { createOpenAIEmbedder, OPENAI_MODELS } from './lib/embed-openai.mjs';
import { createApiLedger } from './lib/api-ledger.mjs';
import { frozenA0Stores } from './lib/a0-core.mjs';

export function environment() {
  const processors = cpus();
  return { node: process.version, cpu: processors[0]?.model, logicalCores: processors.length,
    availableThreads: availableParallelism(), ramBytes: totalmem(), platform: platform(), os: release(), arch: process.arch };
}
export function parseCLI(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: Object.fromEntries([
    'fixture-dir', 'split', 'scale', 'arms', 'models', 'out', 'ledger', 'selection', 'lexical', 'threads', 'cache-dir', 'store-dir',
  ].map(key => [key, { type: 'string' }])) });
  for (const key of ['fixture-dir', 'split', 'scale', 'arms', 'out']) if (!values[key]) throw new Error(`missing_--${key}`);
  if (!['dev', 'test'].includes(values.split) || !['S300', 'S1000'].includes(values.scale)) throw new Error('invalid_split_or_scale');
  const arms = values.arms.split(',').flatMap(arm => arm === 'grid' ? Object.keys(FUSION_CONFIGS).filter(name => name.startsWith('G-')) : [arm]);
  const models = values.models?.split(',') ?? ['e5-small', 'bge-m3'];
  for (const arm of arms) if (!['A0-default', 'A0-paged', 'A0b', 'A1', 'A1+', 'A1t', 'A2', 'A5-spans', 'A5-both'].includes(arm) && !Object.hasOwn(FUSION_CONFIGS, arm))
    throw new Error(`unknown_arm:${arm}`);
  if (values.split === 'test' && arms.some(name => name.startsWith('G-'))) throw new Error('exploration_grid_dev_only');
  for (const model of models) if (!Object.hasOwn(LOCAL_MODELS, model) && !Object.hasOwn(OPENAI_MODELS, model)) throw new Error(`unknown_model:${model}`);
  const threads = Number(values.threads ?? 4);
  if (!Number.isSafeInteger(threads) || threads < 1) throw new Error('invalid_threads');
  return { fixtureDir: resolve(values['fixture-dir']), split: values.split, scale: values.scale, arms: [...new Set(arms)],
    models: [...new Set(models)], out: resolve(values.out), ledgerPath: values.ledger ? resolve(values.ledger) : undefined,
    selectionPath: values.selection, lexical: values.lexical, threads,
    cacheDir: values['cache-dir'] ?? MODEL_CACHE, storeDir: values['store-dir'] ?? join(MODEL_CACHE, 'hr1-a0-stores') };
}

// Consume W4a's frozen hr1-selection-v1 directly. No query labels enter arms.
export async function loadSelection(options) {
  const frozen = options.selectionPath ? JSON.parse(await readFile(options.selectionPath, 'utf8')) : null;
  if ((options.split === 'test' && options.arms.some(isFused) || options.arms.some(arm => arm.startsWith('A5-'))) && !frozen)
    throw new Error('frozen_selection_required');
  if (frozen && (frozen.format !== 'hr1-selection-v1' || frozen.sourceSplit !== 'dev' || frozen.scale !== 'S1000'))
    throw new Error('invalid_frozen_selection');
  if (frozen && options.split === 'test' && (frozen.status !== 'ready' || frozen.easeCheck?.saturated))
    throw new Error('selection_not_ready_for_test');
  const lexical = frozen?.comparator?.arm ?? options.lexical ?? 'A1';
  if (!['A1', 'A1+'].includes(lexical)) throw new Error('invalid_lexical_selection');
  if (frozen && options.lexical && options.lexical !== lexical) throw new Error('selection_lexical_override');
  const selection = frozen ? { lexical, fixtureHashes: frozen.fixtureHashes, contexts: Object.fromEntries(
    Object.entries(frozen.nominated ?? {}).filter(([, winner]) => winner).map(([context, winner]) =>
      [context, { model: winner.model, fusion: winner.menu ?? winner.config }])) } : null;
  return { selection, lexical };
}
export function checkSelectionHashes(selection, hashes) {
  if (selection && JSON.stringify(Object.entries(selection.fixtureHashes ?? {}).sort()) !== JSON.stringify(Object.entries(hashes).sort()))
    throw new Error('selection_fixture_hash_mismatch');
}
export const configurationName = config => config.arm === 'A1' ? 'BM25-T1' : config.arm === 'A1+' ? 'BM25-T1+' : config.fusion ?? config.arm;
export function configurations(options, selection) {
  const configs = [];
  for (const arm of options.arms) {
    if (arm.startsWith('A5-')) {
      for (const [context, winner] of Object.entries(selection?.contexts ?? {})) {
        if (!['local', 'hosted'].includes(context) || !LOCAL_MODELS[winner.model] && !OPENAI_MODELS[winner.model] || !CONFIRMATORY[winner.fusion] || (context === 'local' ? !LOCAL_MODELS[winner.model] : !OPENAI_MODELS[winner.model]))
          throw new Error('invalid_context_selection');
        if (options.models.includes(winner.model)) configs.push({ arm, model: winner.model, fusion: winner.fusion, context });
      }
      if (!configs.some(config => config.arm === arm)) throw new Error('a5_nominated_context_required');
    } else if (needsModel(arm)) {
      for (const model of options.models) configs.push({ arm, model, fusion: arm });
    } else configs.push({ arm, model: null });
  }
  return configs;
}
export async function defaultEmbedder(model, options, ledger) {
  if (LOCAL_MODELS[model]) return createLocalEmbedder({ model, cacheDir: options.cacheDir, threads: options.threads });
  // This branch is reached only on an explicit hosted-arm run by the primary.
  return createOpenAIEmbedder({ model, apiKey: process.env.HR1_OPENAI_API_KEY, ledger,
    cacheDir: join(options.cacheDir, 'hr1-openai-responses') });
}

// The orchestrator alone sees fixture objects. Arms only see the projections.
// Dependency injection lets ordinary tests construct projections without W4a.
export async function runRankings(options, { fixtureAPI, embedderFactory = defaultEmbedder } = {}) {
  const { selection, lexical } = await loadSelection(options);
  const configs = configurations(options, selection);
  const api = fixtureAPI ?? await import('./lib/fixture.mjs');
  const fixture = await api.loadFixture(options.fixtureDir);
  checkSelectionHashes(selection, fixture.hashes);
  const queries = api.armQueries(fixture, { split: options.split });
  if (!queries.length) throw new Error('no_projected_queries');
  const project = (intent, include) => api.armDocuments(fixture, { namespace: 'target', scale: options.scale, intent, include });
  const ledger = configs.some(c => OPENAI_MODELS[c.model]) ? createApiLedger(options.ledgerPath) : null;
  const embedders = new Map(), files = [], outputs = [];
  let stores;
  try {
    for (const config of configs) {
      const startedAt = new Date().toISOString(), before = ledger?.summary();
      try {
        if (config.model && !embedders.has(config.model)) embedders.set(config.model, await embedderFactory(config.model, options, ledger));
        const embedder = embedders.get(config.model);
        if (config.arm.startsWith('A0-') && !stores) stores = frozenA0Stores({ directory: options.storeDir, scale: options.scale,
          history: project('history', 'body'), current: project('current', 'body'), spans: project('history', 'spans') });
        const variants = config.arm.startsWith('A0-') ? stores.map((store, index) => ({ store, index })) : [{ store: null, index: null }];
        for (const variant of variants) {
          const indexes = new Map(), begin = performance.now();
          const costs = { indexBuildMs: variant.store?.snapshot.seedBuildMs ?? 0, embedDocs: 0, embedMsPerDoc: 0, apiTokens: 0, apiSpendUsd: 0 };
          try {
            if (!variant.store) {
              for (const intent of new Set(queries.map(query => query.intent))) {
                const index = await createArm({ ...config, documents: project(intent, includeForArm(config.arm)), embedder, lexical });
                indexes.set(intent, index); costs.embedDocs += index.costs.embedDocs;
              }
              costs.indexBuildMs = performance.now() - begin;
              costs.embedMsPerDoc = [...indexes.values()].reduce((sum, index) => sum + index.costs.embedMsPerDoc * index.costs.embedDocs, 0) / Math.max(1, costs.embedDocs);
            }
            const results = {};
            for (const query of queries) results[query.queryId] = variant.store ? variant.store.search(query, { paged: config.arm === 'A0-paged' }) :
              await indexes.get(query.intent).search(query);
            const after = ledger?.summary();
            if (after) { costs.apiTokens = after.apiTokens - before.apiTokens; costs.apiSpendUsd = after.apiSpendUsd - before.apiSpendUsd;
              costs.apiCommittedUsd = after.committedUsd - before.committedUsd; costs.ledger = after; }
            const output = { format: 'hr1-rankings-v1', run: { arm: config.arm,
              config: configurationName(config),
              lexical: isFused(config.arm) ? lexical : null, model: config.model, modelMetadata: embedder?.metadata ?? null,
              scale: options.scale, split: options.split, fixtureHashes: fixture.hashes, env: environment(), startedAt,
              finishedAt: new Date().toISOString(), store: variant.index, status: 'complete',
              ...(variant.store ? { snapshot: variant.store.snapshot, seeding: 'hr1-projection-v1' } : {}) }, queries: results, costs };
            outputs.push(output);
          } finally { for (const index of indexes.values()) index.close(); }
        }
      } catch (error) {
        outputs.push({ format: 'hr1-rankings-v1', run: { arm: config.arm, config: config.fusion ?? config.arm,
          model: config.model, scale: options.scale, split: options.split, fixtureHashes: fixture.hashes, env: environment(),
          startedAt, finishedAt: new Date().toISOString(), store: null, status: 'unavailable', error: error.message },
          queries: {}, costs: ledger ? { ...ledger.summary() } : {} });
      }
    }
    const multiple = outputs.length > 1;
    if (multiple) await mkdir(options.out, { recursive: true });
    else await mkdir(dirname(options.out), { recursive: true });
    for (const output of outputs) {
      const r = output.run;
      const path = multiple ? join(options.out, [r.arm, r.model, r.store === null ? null : `store${r.store}`].filter(x => x !== null).join('--') + '.json') : options.out;
      await writeFile(path, JSON.stringify(output, null, 2) + '\n'); files.push(path);
    }
    return { outputs, files };
  } finally {
    for (const store of stores ?? []) store.close();
    for (const embedder of embedders.values()) await embedder.close?.();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRankings(parseCLI()).then(({ files, outputs }) => { for (const file of files) console.log(file);
    if (outputs.some(output => output.run.status === 'unavailable' || Object.values(output.queries).some(query => query.errors?.length))) process.exitCode = 1; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
