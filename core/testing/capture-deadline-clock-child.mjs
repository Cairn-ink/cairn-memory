// Isolated test process: set the monotonic clock before importing the real core.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [mode, mutation] = process.argv.slice(2);
assert.ok(['source-bound-v1', 'source-bound-v2'].includes(mode));
assert.ok(mutation === undefined || mutation === 'reset-stage-deadline');

// The counterfactual changes only the model-call budget for qualification,
// as a reset-per-stage implementation would; the original capture deadline
// remains in all other real-core checks. Nothing is written to source files.
let mutatedModules = 0;
if (mutation === 'reset-stage-deadline') registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  if (!['automatic-qualification.mjs', 'qualification-candidates.mjs']
    .some(name => url.endsWith(`/core/${name}`))) return loaded;
  const source = String(loaded.source);
  const target = "{ failureCode: 'qualification_failed', deadline }";
  assert.equal(source.split(target).length, 2, `single qualification call in ${url}`);
  mutatedModules++;
  return { ...loaded, source: "import { createCaptureDeadline } from './capture-deadline.mjs';\n"
    + source.replace(target, "{ failureCode: 'qualification_failed', deadline: createCaptureDeadline(1_000) }") };
} });

const realNow = process.hrtime.bigint;
let now = 0n;
process.hrtime.bigint = () => now;
const advance = milliseconds => { now += BigInt(milliseconds) * 1_000_000n; };
const elapsedMs = () => Number(now / 1_000_000n);
const directory = mkdtempSync(join(tmpdir(), 'cairn-capture-clock-'));
let core;
let db;
try {
  const [{ openMemoryCore }, { rationaleModel }] = await Promise.all([
    import('../contract.mjs'), import('./rationale-model.mjs'),
  ]);
  if (mutation) assert.equal(mutatedModules, 2, 'both qualification modules must be mutated');
  const original = mode === 'source-bound-v1' ? {
    contextWindow: 8192, countTokens: () => 1,
    extract: ({ input }) => ({ items: [{ content: input.messages[0].content,
      kind: 'fact', confidence: 0.8, sourceIndices: [0] }] }),
    classify: ({ input }) => ({ items: input.memories.map(memory =>
      ({ memoryId: memory.id, parentIds: [] })) }),
  } : rationaleModel();
  const calls = [];
  let extractionEndedMs;
  let qualificationStartedMs;
  let qualificationEndedMs;
  let qualificationSignal;
  const model = { ...original,
    extract: request => {
      calls.push('extract');
      advance(600);
      const result = original.extract(request);
      extractionEndedMs = elapsedMs();
      return result;
    },
    [mode === 'source-bound-v1' ? 'qualify' : 'qualifyCandidates']: request => {
      calls.push('qualify');
      qualificationSignal = request.signal;
      qualificationStartedMs = elapsedMs();
      advance(600);
      qualificationEndedMs = elapsedMs();
      return mode === 'source-bound-v1' ? { qualifications: request.input.items.map(
        ({ itemIndex, sources }) => ({ itemIndex, qualification: { version: 1,
          slot: { subject: null, property: null, scope: null, applies: null }, value: null,
          attribution: 'unknown', commitment: 'unknown', anchors: [{ receiptIndex: 0,
            start: 0, end: sources[0].excerpt.length, text: sources[0].excerpt, fields: ['value'] }] } })) }
        : original.qualifyCandidates(request);
    } };
  const path = join(directory, 'memory.sqlite');
  core = openMemoryCore({ path, model, captureDeadlineMs: 1_000,
    captureQualification: mode,
    ...(mode === 'source-bound-v2' ? { captureEvidence: 'staged-v1' } : {}) });
  db = new DatabaseSync(path);
  const namespace = { ownerId: 'capture-clock-synthetic', scope: 'personal', projectId: null };
  const result = await core.capture({ namespace, client: 'deadline-client', eventId: 'cumulative',
    sessionId: 'deadline-session', messages: [{ id: 'message-cumulative', role: 'user',
      content: 'Synthetic source.' }] });
  assert.deepEqual(calls, ['extract', 'qualify'], mode);
  assert.equal(qualificationSignal?.aborted, true,
    `${mode}: shared deadline must abort the qualification call`);
  assert.equal(result.error?.code, 'model_timeout',
    `${mode}: cumulative deadline must time out before admission`);
  assert.equal(extractionEndedMs, 600, mode);
  assert.equal(qualificationStartedMs, 600, mode);
  assert.equal(qualificationEndedMs, 1_200, mode);
  for (const table of ['memories', 'receipts', 'capture_initial_classification']) {
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, `${mode}: ${table}`);
  }
  process.stdout.write(JSON.stringify({ mode, calls, extractionEndedMs,
    qualificationStartedMs, qualificationEndedMs, errorCode: result.error.code }) + '\n');
} catch (error) {
  if (error?.code === 'ERR_ASSERTION') {
    process.stderr.write(`CUMULATIVE_ASSERTION_FAILED:${mode}:${error.message}\n`);
    process.exitCode = 2;
  } else throw error;
} finally {
  try { core?.close(); }
  finally {
    try { db?.close(); }
    finally {
      rmSync(directory, { recursive: true, force: true });
      process.hrtime.bigint = realNow;
    }
  }
}
