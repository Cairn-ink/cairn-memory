// Report-only attribution: no latency gate, no retries, no quiet-host claim.
// Run through cairn-heavy on the desired Node patch. --smoke uses tiny fixtures;
// --samples N (default 40) includes one cold and N-1 warm fresh readers.
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { loadavg } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { OPEN_DIAGNOSTIC_FIELDS } from '../../core/context-product-open-diagnostic.mjs';

const mono = () => Number(process.hrtime.bigint()) / 1e6;
const self = fileURLToPath(import.meta.url);
const profiles = {
  memory18: { memories: 1112, cards: 0, namespaces: 1, schema: 18 },
  mixed16: { memories: 1640, cards: 26, namespaces: 16, schema: 23 },
};
const requireSuccess = result => {
  if (!result.ok) throw Error('diagnostic operation failed: ' + result.error?.code);
  return result.value;
};
const quantiles = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, p50: sorted[Math.ceil(sorted.length * .5) - 1] ?? null,
    p95: sorted[Math.ceil(sorted.length * .95) - 1] ?? null, max: sorted.at(-1) ?? null };
};
export function summarize(samples, keys = [...new Set(samples.flatMap(Object.keys))]) {
  for (const sample of samples) for (const key of keys) {
    if (!Object.hasOwn(sample, key) || !Number.isFinite(sample[key]) || sample[key] < 0) {
      throw Error('incomplete_diagnostic_sample:' + key);
    }
  }
  return Object.fromEntries(keys.map(key => [key, quantiles(samples.map(s => s[key]))]));
}
const productFields = [...OPEN_DIAGNOSTIC_FIELDS, 'observedOpenMs', 'observedFetchMs', 'observedCloseMs', 'observedLifecycleMs'];
export function validateProductSample(sample) {
  summarize([sample], productFields);
  return sample;
}
export async function finalizeAll(finalizers, failure) {
  const errors = failure === undefined ? [] : [failure];
  // Preserve reverse ownership order, but never let one rejection skip owners.
  for (const finalize of [...finalizers].reverse()) {
    try { await finalize(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'open_diagnostic_failed');
}

if (process.argv.includes('--measure-child')) {
  const [input] = await once(process, 'message');
  const samples = [], startLoad = loadavg(), started = mono();
  // Do not import fixture helpers here: their graph links SQLite in the parent.
  const { openContextProductReader, productOpenPhaseDiagnostic } = await import('../../core/context-product-reader.mjs');
  const { createContextReadSupervisor } = await import('../../core/context-read-supervisor.mjs');
  const { PRODUCT_PROFILE, credentialDigest } = await import('../../core/context-product-control.mjs');
  try {
    for (let i = 0; i < input.samples; i++) {
      if (input.kind !== 'product') {
        const clock = new SharedArrayBuffer(8), start = process.hrtime.bigint();
        const worker = new Worker(input.control, { workerData: clock, env: {}, execArgv: [], stdout: true, stderr: true,
          resourceLimits: { maxOldGenerationSizeMb: 192 } });
        worker.stdout.resume(); worker.stderr.resume();
        const [exitCode] = await once(worker, 'exit');
        if (exitCode !== 0) throw Error('control Worker exit ' + exitCode);
        const first = Atomics.load(new BigInt64Array(clock), 0);
        if (first < start) throw Error('missing control first-statement timestamp');
        samples.push({ workerStartStaticGraphMs: Number(first - start) / 1e6,
          controlStartThroughExitMs: Number(process.hrtime.bigint() - start) / 1e6 });
      } else {
        const supervisor = createContextReadSupervisor(), token = { opaque: randomUUID() };
        const ids = { requestId: randomUUID(), handleId: randomUUID(), credentialBindingId: randomUUID(), credentialExpiresUtcMs: null };
        const ownerCoverage = { policy: 'recent-projects-v1', selectionRevision: 'synthetic-open',
          requestedNamespaces: input.readSet.length, selectedNamespaces: input.readSet.length, omittedNamespaces: 0 };
        const binding = { kind: 'request', ...ids, credentialDigest: credentialDigest(token), ownerId: input.readSet[0].ownerId,
          namespaces: { readSet: input.readSet, ownerCoverage }, issuedAt: 0 };
        const state = new SharedArrayBuffer(32); new Int32Array(state)[0] = 1;
        const options = { supervisor, path: input.path, version: 'context-read-v1', profile: PRODUCT_PROFILE,
          readSet: input.readSet, ownerCoverage, diagnostics: true, requestControl: { ...ids, requestMaxMs: 5000 },
          host: { moduleUrl: new URL('../../core/testing/context-product-index-host.mjs', import.meta.url).href,
            configuration: { requestBinding: binding, state, requestReservation: new SharedArrayBuffer(4) } } };
        let reader, failure;
        const start = mono();
        try {
          reader = await openContextProductReader(options); const opened = mono();
          const result = await reader.fetchCandidateEvidence({ readSet: input.readSet, refs: input.refs,
            intent: 'current', deadlineMs: 5000 }, token);
          requireSuccess(result); const fetched = mono();
          await reader.close(); const closed = mono();
          samples.push(validateProductSample({ ...productOpenPhaseDiagnostic(reader), observedOpenMs: opened - start,
            observedFetchMs: fetched - opened, observedCloseMs: closed - fetched, observedLifecycleMs: closed - start }));
        } catch (error) { failure = error; }
        finally { await finalizeAll([() => supervisor.close(), () => reader?.close()], failure); }
      }
      if ((i + 1) % 10 === 0) process.stderr.write(input.kind + ' settled ' + (i + 1) + '/' + input.samples + '\n');
    }
    process.send({ kind: input.kind, cold: summarize(samples.slice(0, 1)), warm: summarize(samples.slice(1)),
      rawMs: samples, loadStart: startLoad, loadEnd: loadavg(), wallMs: mono() - started,
      coldMeaning: 'First Worker/open of this family in a separate process; not an OS page-cache flush.' });
  } finally {
    process.disconnect();
  }
} else if (process.argv[1] && resolve(process.argv[1]) === self) {
  const smoke = process.argv.includes('--smoke'), args = process.argv.slice(2);
  const option = (name, fallback) => {
    const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1];
  };
  const samples = Number(option('--samples', smoke ? 2 : 40));
  const selected = option('--profile', 'all');
  if (!Number.isSafeInteger(samples) || samples < 2 || samples > 1000) throw Error('--samples must be 2..1000');
  if (selected !== 'all' && !Object.hasOwn(profiles, selected)) throw Error('unknown --profile');
  if (args.some(arg => !['--smoke', '--samples', '--profile', String(samples), selected].includes(arg))) throw Error('unknown argument');
  const { fixture } = await import('../../core/testing/context-read-fixture.mjs');
  const { configured, prebuild, card, personal, project } = await import('../../core/testing/context-product-owner-fixture.mjs');
  const { createTestWorkspace } = await import('./workspace.mjs');
  const loadStart = loadavg(), startedUtc = new Date().toISOString(), reports = [];
  for (const name of selected === 'all' ? Object.keys(profiles) : [selected]) {
    const requested = profiles[name], shape = smoke ? { ...requested, memories: 16, cards: requested.cards ? 2 : 0 } : requested;
    const cleanups = [], t = { after: fn => cleanups.push(fn) };
    let failure;
    try {
      const workspace = createTestWorkspace(t, { prefix: 'context-open-diagnostic-' });
      const f = fixture(t, { cards: shape.cards > 0 });
      const readSet = [personal, ...Array.from({ length: shape.namespaces - 1 }, (_, i) => project('synthetic-' + i))];
      const refs = [];
      for (let i = 0; i < shape.memories; i++) {
        const namespace = readSet[i % readSet.length];
        const memory = f.admit(i + ': Synthetic orchard planning evidence with maintenance budgets and durable checkpoints.', namespace);
        if (refs.length < 24) refs.push({ type: 'memory', namespace, memoryId: memory.id, revision: memory.revision });
        if ((i + 1) % 256 === 0) process.stderr.write(name + ' seeded Memories ' + (i + 1) + '/' + shape.memories + '\n');
      }
      for (let i = 0; i < shape.cards; i++) {
        const namespace = readSet[i % readSet.length];
        const item = card(f, namespace, 'Synthetic planning ' + i, 'Authored synthetic planning evidence.');
        if (i < 2) refs[refs.length - 1 - i] = { type: 'card', namespace, cardId: item.id, revision: item.revision, bodyRevision: item.bodyRevision };
      }
      const fixtureShape = { memories: f.db.prepare('SELECT count(*) AS n FROM memories').get().n,
        cards: shape.cards ? f.db.prepare('SELECT count(*) AS n FROM private_cards').get().n : 0,
        namespaces: readSet.length, schema: f.db.prepare('PRAGMA user_version').get().user_version,
        journal: f.db.prepare('PRAGMA journal_mode').get().journal_mode.toUpperCase() };
      if (fixtureShape.schema !== shape.schema || fixtureShape.journal !== 'DELETE' || fixtureShape.memories !== shape.memories || fixtureShape.cards !== shape.cards) throw Error('fixture shape mismatch');
      const service = configured(t, f.path, readSet, { service: true });
      process.stderr.write(name + ' seeding complete; prebuilding current/history\n');
      await prebuild(service, shape.cards ? ['memory', 'card'] : ['memory']);
      process.stderr.write(name + ' synthetic fixture prebuilt; measuring ' + samples + ' per family\n');
      const workerSource = await readFile(new URL('../../core/context-product-worker.mjs', import.meta.url), 'utf8');
      // Evaluate exactly the Worker's static imports, without its bootstrap body.
      const imports = [...workerSource.matchAll(/^import[\s\S]*?;\n/gm)].map(match => match[0].replace(
        /from '([^']+)'/, (_, specifier) => "from '" + (specifier.startsWith('.') ? new URL(specifier, new URL('../../core/context-product-worker.mjs', import.meta.url)).href : specifier) + "'"));
      if (!imports.length) throw Error('missing static import control');
      const marker = "import {workerData as diagnosticClock} from 'node:worker_threads';\nAtomics.store(new BigInt64Array(diagnosticClock),0,process.hrtime.bigint());\n";
      const empty = join(workspace.path, 'empty.mjs'), graph = join(workspace.path, 'static-graph.mjs');
      await writeFile(empty, marker); await writeFile(graph, imports.join('') + marker);
      const families = {};
      for (const kind of ['product', 'empty', 'static']) families[kind] = await measure({ kind, samples,
        path: f.path, readSet, refs, control: kind === 'empty' ? empty : graph });
      reports.push({ profile: name, requestedSyntheticShape: requested, fixture: fixtureShape, evidenceRefs: refs.length,
        prebuilt: ['current', 'history'], staticImportDeclarations: imports.length, ...families,
        sidecarAtOpen: { connection: 'not executed (lazy)', attestation: 'not executed (lazy)', checks: 'not executed (lazy)' } });
    } catch (error) { failure = error; }
    finally { await finalizeAll(cleanups, failure); }
  }
  process.stdout.write(JSON.stringify({ purpose: 'Attribution only on a non-quiet machine; not Q1 timing evidence.',
    runtime: process.version, platform: process.platform, smoke, samplesPerFamily: samples, unit: 'ms',
    percentile: 'nearest rank; cold n=1 has identical p50/p95/max; warm n=N-1',
    startedUtc, finishedUtc: new Date().toISOString(), loadStart, loadEnd: loadavg(), profiles: reports }, null, 2) + '\n');
}

async function measure(input) {
  const child = fork(self, ['--measure-child'], { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  child.stderr.pipe(process.stderr);
  let report, timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 120000);
  child.on('message', value => { report = value; });
  try {
    child.send(input);
    const [exitCode, signal] = await once(child, 'close');
    if (timedOut || exitCode !== 0 || !report) throw Error('diagnostic child failed: ' + (timedOut ? 'timeout' : signal ?? exitCode));
    return { ...report, exitCode };
  } finally { clearTimeout(timer); }
}
