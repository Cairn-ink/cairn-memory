/** Synthetic public-capture benchmark. Each sample opens in a fresh process.
 * Options: --memories=500 --read-delay-ms=0. */
import { fork, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir, loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

function integerOption(name, fallback, minimum) {
  const supplied = process.argv.filter(arg => arg.startsWith('--' + name + '='));
  if (!supplied.length) return fallback;
  const value = supplied[0].slice(name.length + 3);
  if (supplied.length !== 1 || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum)
    throw Error('invalid_' + name);
  return Number(value);
}
const memories = integerOption('memories', 500, 1);
const readDelayMs = integerOption('read-delay-ms', 0, 0);

const root = resolve(process.argv.find(arg => arg.startsWith('--engine-root='))?.slice(14) ?? fileURLToPath(new URL('../../', import.meta.url)));
const { DatabaseSync } = await import('node:sqlite');
const { openMemoryCore } = await import(pathToFileURL(join(root, 'core/index.mjs')));
const { createContextReadAccess } = await import(pathToFileURL(join(root, 'adapters/mcp/context-read-access.mjs')));
const { createLocalRawSearch } = await import(pathToFileURL(join(root, 'core/local-raw-search.mjs')));
const { defaultRawOptions, startLocalContextMaintenance: warmup } = await import(pathToFileURL(join(root, 'core/local-defaults.mjs')));
const ns = { ownerId: 'synthetic-owner', scope: 'personal', projectId: null };
const { createContextCounter } = await import(pathToFileURL(join(root, 'adapters/openai/context-counter.mjs')));
const counter = await createContextCounter();
function ok(result) { if (!result.ok) throw Error(JSON.stringify(result)); return result.value; }
async function sample(path) {
  const access = createContextReadAccess(ns, false, { maintenance: true });
  const start = performance.now();
  const rawSearch = createLocalRawSearch(path, defaultRawOptions().port);
  const core = openMemoryCore({ path, raw: true, rawSearch: false, contextRead: { ...access.configuration, counter, rawSearch: rawSearch.contextPort([ns]) } });
  const maintenanceStarted = performance.now();
  const maintenance = warmup?.(core, access);
  const maintenanceScheduleMs = warmup ? performance.now() - maintenanceStarted : 0;
  rawSearch.start();
  const openMs = performance.now() - start;
  const reads = [];
  try {
    if (readDelayMs) await new Promise(resolve => setTimeout(resolve, readDelayMs));
    for (let i = 0; i < 3; i++) {
      const before = performance.now();
      const result = await access.call(core, 'contextRead', { readSet: [ns], types: ['memory'], intent: 'current', query: 'synthetic telescope' });
      const ms = performance.now() - before;
      const value = result.value, diagnostics = value?.diagnostics ?? result.error?.details;
      reads.push({ ms, result: result.ok ? 'ok' : result.error?.code, ok: result.ok, error: result.error?.code ?? null, coverage: diagnostics?.coverage?.raw ?? 'unavailable',
        maintenance: diagnostics?.candidates?.coverage?.maintenance?.state ?? null, items: value?.metered.items.length ?? 0,
        assemblyMs: diagnostics?.trace?.timings?.assemblyMs ?? null, loadAverage: loadavg() });
    }
    return { openMs, maintenanceScheduleMs, reads, loadAverage: loadavg() };
  } finally { await maintenance?.close(); await rawSearch.close(); await core.close(); }
}
if (process.argv.includes('--child')) {
  try { process.send(await sample(process.argv.at(-1))); }
  catch (error) { process.send({ error: error.message }); process.exitCode = 1; }
} else {
  const scratch = mkdtempSync(join(tmpdir(), 'cairn-first-read-'));
  const seedPath = join(scratch, 'seed.sqlite');
  const model = { contextWindow: 100000, countTokens: () => 1,
    extract: ({ input }) => ({ items: input.messages.map(message => ({ content: message.content.slice(0, 600), kind: 'fact', confidence: 1, sourceIndices: [message.index] })) }),
    classify: ({ input }) => ({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }) };
  try {
    const core = openMemoryCore({ path: seedPath, raw: true, rawSearch: false, model });
    try {
      for (let i = 0; i < memories; i++) ok(await core.capture({ namespace: ns, client: 'codex', sessionId: 'synthetic-corpus-' + Math.floor(i / 10), eventId: 'synthetic-' + i,
        messages: [{ id: 'synthetic-' + i, role: 'user', occurredAt: '2026-01-01T00:00:00.000Z',
          content: `Synthetic telescope observation ${i}. ` + 'The synthetic observatory records a cobalt telescope and a quiet sky. 合成觀測資料。 '.repeat(45) }] }));
    } finally { await core.close(); }
    const inspection = new DatabaseSync(seedPath, { readOnly: true });
    let corpusCounts;
    try {
      corpusCounts = Object.fromEntries(['memories', 'receipts', 'raw_conversations', 'raw_messages'].map(table =>
        [table, inspection.prepare('SELECT count(*) AS n FROM ' + table).get().n]));
    } finally { inspection.close(); }
    if (JSON.stringify(Object.values(corpusCounts)) !== JSON.stringify([memories, memories, Math.ceil(memories / 10), memories])) throw Error('synthetic_corpus_count_mismatch');
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const path = join(scratch, 'sample-' + i + '.sqlite');
      // Keep raw copy descriptors in a child that never loads SQLite.
      execFileSync(process.execPath, ['--input-type=module', '-e',
        "import { copyFileSync } from 'node:fs'; copyFileSync(process.argv[1], process.argv[2]);", seedPath, path],
      { env: {}, stdio: 'ignore' });
      for (const suffix of ['.context-read-v1.sqlite', '.context-read-v1.sqlite-journal', '.context-read-v1.sqlite-wal', '.context-read-v1.sqlite-shm']) {
        if (existsSync(path + suffix)) unlinkSync(path + suffix);
      }
      const value = await new Promise((resolve, reject) => {
        let data;
        const child = fork(fileURLToPath(import.meta.url), ['--engine-root=' + root, '--memories=' + memories, '--read-delay-ms=' + readDelayMs, '--child', path], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
        child.on('message', value => { data = value; }); child.on('error', reject);
        child.on('exit', (code, signal) => code === 0 && data && !data.error ? resolve(data) : reject(Error(JSON.stringify({ code, signal, data }))));
      });
      samples.push(value);
    }
    console.log(JSON.stringify({ node: process.version, memories, readDelayMs, synthetic: true, corpusBytes: statSync(seedPath).size, corpusCounts, samples }, null, 2));
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
