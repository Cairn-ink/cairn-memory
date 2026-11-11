/** Synthetic public-capture benchmark. Each sample opens in a fresh process. */
import { fork } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir, loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

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
    for (let i = 0; i < 3; i++) {
      const before = performance.now();
      const result = await access.call(core, 'contextRead', { readSet: [ns], types: ['memory'], intent: 'current', query: 'synthetic telescope' });
      const ms = performance.now() - before;
      const value = result.value, diagnostics = value?.diagnostics ?? result.error?.details;
      reads.push({ ms, ok: result.ok, error: result.error?.code ?? null, coverage: diagnostics?.coverage?.raw ?? null,
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
      for (let i = 0; i < 500; i++) ok(await core.capture({ namespace: ns, client: 'codex', sessionId: 'synthetic-corpus-' + Math.floor(i / 10), eventId: 'synthetic-' + i,
        messages: [{ id: 'synthetic-' + i, role: 'user', occurredAt: '2026-01-01T00:00:00.000Z',
          content: `Synthetic telescope observation ${i}. ` + 'The synthetic observatory records a cobalt telescope and a quiet sky. 合成觀測資料。 '.repeat(45) }] }));
    } finally { await core.close(); }
    const inspection = new DatabaseSync(seedPath, { readOnly: true });
    let corpusCounts;
    try {
      corpusCounts = Object.fromEntries(['memories', 'receipts', 'raw_conversations', 'raw_messages'].map(table =>
        [table, inspection.prepare('SELECT count(*) AS n FROM ' + table).get().n]));
    } finally { inspection.close(); }
    if (JSON.stringify(Object.values(corpusCounts)) !== JSON.stringify([500, 500, 50, 500])) throw Error('synthetic_corpus_count_mismatch');
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const path = join(scratch, 'sample-' + i + '.sqlite'); cpSync(seedPath, path);
      for (const suffix of ['.context-read-v1.sqlite', '.context-read-v1.sqlite-journal', '.context-read-v1.sqlite-wal', '.context-read-v1.sqlite-shm']) {
        if (existsSync(path + suffix)) unlinkSync(path + suffix);
      }
      const value = await new Promise((resolve, reject) => {
        let data;
        const child = fork(fileURLToPath(import.meta.url), ['--engine-root=' + root, '--child', path], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
        child.on('message', value => { data = value; }); child.on('error', reject);
        child.on('exit', (code, signal) => code === 0 && data && !data.error ? resolve(data) : reject(Error(JSON.stringify({ code, signal, data }))));
      });
      samples.push(value);
    }
    console.log(JSON.stringify({ node: process.version, memories: 500, synthetic: true, corpusBytes: statSync(seedPath).size, corpusCounts, samples }, null, 2));
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
