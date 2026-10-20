// Isolated test process: bind the real core's monotonic clock before import.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const [mode, mutation] = process.argv.slice(2);
assert.ok(['adapter-expiry', 'before-dispatch-expiry', 'provider-spoof'].includes(mode));
assert.ok(mutation === undefined || mutation === 'omit-rationale-call-deadline');
let mutatedModules = 0;
if (mutation) registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  if (!url.endsWith('/core/rationale.mjs')) return loaded;
  const source = String(loaded.source);
  const target = "{ validateFresh, failureCode: 'rationale_failed', deadline }";
  assert.equal(source.split(target).length, 2, 'one rationale model-call deadline');
  mutatedModules++;
  return { ...loaded, source: source.replace(target,
    "{ validateFresh, failureCode: 'rationale_failed', deadline: undefined }") };
} });

const realNow = process.hrtime.bigint;
let now = 0n;
process.hrtime.bigint = () => now;
const expire = () => { now += 120_001_000_000n; };
const workspace = createTestWorkspace(null, { prefix: 'cairn-rationale-clock-' });
try {
  const [{ openMemoryCore }, { rationaleModel }, { isCoreModelDeadlineSignal }] = await Promise.all([
    import('../contract.mjs'), import('./rationale-model.mjs'), import('../model-call.mjs'),
  ]);
  if (mutation) assert.equal(mutatedModules, 1);
  const model = rationaleModel();
  const originalRelate = model.relate;
  let relates = 0;
  let packingExpiries = 0;
  let signal;
  if (mode === 'provider-spoof') model.classify = () => { throw new Error('model_timeout'); };
  if (mode === 'before-dispatch-expiry') model.countTokens = text => {
    let request;
    try { request = JSON.parse(text); } catch { return 1; }
    if (request.input?.memories?.some(memory => Array.isArray(memory.receipts))) {
      packingExpiries++;
      expire();
    }
    return 1;
  };
  model.relate = request => {
    relates++;
    signal = request.signal;
    // Pre-rationale scheduling/SQLite work consumes no virtual time. Expiry
    // happens only after the intended adapter boundary has actually been reached.
    if (mode === 'adapter-expiry') expire();
    return originalRelate(request);
  };
  const path = join(workspace.path, 'memory.sqlite');
  const core = openMemoryCore({ path, model, captureDeadlineMs: 120_000,
    captureQualification: 'source-bound-v2', captureRationale: 'source-bound-v1' });
  workspace.defer(() => core.close());
  const db = new DatabaseSync(path);
  workspace.defer(() => db.close());
  const result = await core.capture({ namespace: {
    ownerId: 'rationale-clock-synthetic', scope: 'personal', projectId: null },
  client: 'deadline-client', eventId: mode, sessionId: 'deadline-session',
  messages: [{ id: `message-${mode}`, role: 'user',
    content: 'I chose A because it supports offline work.' }] });
  assert.equal(result.ok, true, JSON.stringify(result));
  const { classification, rationale } = result.value;
  const edges = db.prepare('SELECT count(*) AS n FROM rationale_edges').get().n;
  const observed = { mode, relates, packingExpiries, classification: classification.status,
    classificationError: classification.error?.code ?? null, rationale: rationale.status,
    rationaleError: rationale.error?.code ?? null, edges,
    signalAborted: signal?.aborted ?? false, coreDeadlineSignal: isCoreModelDeadlineSignal(signal) };
  process.stdout.write(JSON.stringify(observed) + '\n');
  assert.equal(classification.status, mode === 'provider-spoof' ? 'failed' : 'applied');
  assert.equal(classification.error?.code ?? null,
    mode === 'provider-spoof' ? 'classification_failed' : null);
  assert.equal(relates, mode === 'before-dispatch-expiry' ? 0 : 1);
  assert.equal(packingExpiries, mode === 'before-dispatch-expiry' ? 1 : 0);
  assert.equal(rationale.status, mode === 'provider-spoof' ? 'reviewed' : 'failed');
  assert.equal(rationale.error?.code ?? null, mode === 'provider-spoof' ? null : 'model_timeout');
  assert.equal(edges, mode === 'provider-spoof' ? 1 : 0);
  assert.equal(signal?.aborted ?? false, mode === 'adapter-expiry',
    'rationale adapter must be aborted by the shared deadline');
  assert.equal(isCoreModelDeadlineSignal(signal), mode === 'adapter-expiry',
    'only real core deadline expiry has timeout authority');
} catch (error) {
  if (error?.code !== 'ERR_ASSERTION') throw error;
  process.stderr.write(`RATIONALE_DEADLINE_ASSERTION_FAILED:${error.message}\n`);
  process.exitCode = 2;
} finally {
  try { await workspace.cleanup(); }
  finally { process.hrtime.bigint = realNow; }
}
