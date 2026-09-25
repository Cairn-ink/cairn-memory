import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { openMemoryCore } from '../contract.mjs';
import { createCaptureDeadline } from '../capture-deadline.mjs';
import { callModel, isCoreModelDeadlineSignal } from '../model-call.mjs';
import { reviewCapturedRationale } from '../automatic-rationale.mjs';
import { transaction } from '../database.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';

const namespace = { ownerId: 'capture-deadline-synthetic', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const input = (eventId, content = `Synthetic ${eventId} source.`, causal) => ({ namespace,
  client: 'deadline-client', eventId, sessionId: 'deadline-session',
  messages: [{ id: `message-${eventId}`, role: 'user', content }],
  ...(causal ? { causal } : {}) });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const scripted = (observe = () => {}) => ({ contextWindow: 8192, countTokens: () => 1,
  extract: ({ input: request, signal }) => { observe('extract', signal); return { items: [{
    content: request.messages[0].content, kind: 'fact', confidence: 0.8, sourceIndices: [0],
  }] }; },
  classify: ({ input: request, signal }) => { observe('classify', signal); return { items:
    request.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }; },
});

function fixture(t, { model = scripted(), captureDeadlineMs, ...options } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-capture-deadline-'));
  const path = join(dir, 'memory.sqlite');
  const core = openMemoryCore({ path, model,
    ...(captureDeadlineMs === undefined ? {} : { captureDeadlineMs }), ...options });
  const db = new DatabaseSync(path);
  t.after(() => { core.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { core, db, path };
}
const count = (db, table) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
function delayAfterSql(fragment, milliseconds, observe) {
  const prepare = DatabaseSync.prototype.prepare;
  let reached = 0;
  DatabaseSync.prototype.prepare = function(sql) {
    const connection = this;
    const statement = prepare.call(this, sql);
    if (!sql.includes(fragment)) return statement;
    return new Proxy(statement, { get(target, property) {
      if (property === 'run') return (...args) => {
        const result = target.run(...args);
        reached++;
        observe?.(connection, args);
        pause(milliseconds);
        return result;
      };
      return Reflect.get(target, property, target);
    } });
  };
  return { reached: () => reached, restore: () => { DatabaseSync.prototype.prepare = prepare; } };
}

test('D1 strict own constructor option is snapshotted; defaults and public messages remain unchanged', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-deadline-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'invalid.sqlite');
  for (const value of [undefined, null, 0, -1, 120001, 1.5, NaN, Infinity, '10', true]) {
    assert.throws(() => openMemoryCore({ path, captureDeadlineMs: value }),
      error => error.code === 'invalid_input');
    assert.equal(existsSync(path), false);
  }
  const inherited = Object.assign(Object.create({ captureDeadlineMs: 0 }), { path, model: scripted() });
  const unbounded = openMemoryCore(inherited); t.after(() => unbounded.close());
  assert.equal(ok(await unbounded.capture(input('inherited'))).classification.status, 'applied');
  assert.equal((await unbounded.capture({ ...input('extra-field'), captureDeadlineMs: 120000 })).error.code,
    'invalid_input');
  const configured = fixture(t, { captureDeadlineMs: 120000 });
  assert.equal(ok(await configured.core.capture(input('maximum'))).classification.status, 'applied');
  const options = { path: join(dir, 'snapshotted.sqlite'), model: scripted(), captureDeadlineMs: 120000 };
  const snapshotted = openMemoryCore(options); t.after(() => snapshotted.close());
  options.captureDeadlineMs = 0;
  assert.equal(ok(await snapshotted.capture(input('snapshotted'))).classification.status, 'applied');
});

test('D2 monotonic budget checks before scheduled adapter invocation and after token accounting', async () => {
  const diagnostics = [];
  let calls = 0;
  const model = { contextWindow: 8192, countTokens: () => 1,
    select: () => { calls++; return { refs: [] }; }, onDiagnostic: diagnostic => diagnostics.push(diagnostic) };
  const pending = callModel(model, 'select', 'Synthetic system', {},
    { deadline: createCaptureDeadline(70) });
  pause(110); // The adapter microtask has not run yet.
  await assert.rejects(pending, error => error.code === 'model_timeout');
  assert.equal(calls, 0);
  assert.equal(diagnostics.filter(row => row.reason === 'model_timeout').length, 1);

  for (const slowCount of [1, 2]) {
    let counted = 0;
    let invoked = 0;
    let signal;
    const counting = { contextWindow: 8192,
      countTokens: () => { counted++; if (counted === slowCount) pause(90); return 1; },
      select: request => { invoked++; signal = request.signal; return { refs: [] }; } };
    await assert.rejects(callModel(counting, 'select', 'Synthetic', {},
      { deadline: createCaptureDeadline(65) }), error => error.code === 'model_timeout');
    assert.equal(counted, slowCount);
    assert.equal(invoked, slowCount === 1 ? 0 : 1);
    if (signal) assert.equal(isCoreModelDeadlineSignal(signal), true);
  }
});

test('D2/D4 late extraction is ignored, core signal provenance is private, and another capture is independent', async t => {
  let release;
  let savedSignal;
  let classifyCalls = 0;
  const model = scripted();
  model.extract = ({ input: request, signal }) => {
    if (request.messages[0].content.includes('stalled')) {
      savedSignal = signal;
      return new Promise(resolve => { release = resolve; });
    }
    return { items: [{ content: request.messages[0].content, kind: 'fact',
      confidence: 0.8, sourceIndices: [0] }] };
  };
  model.classify = ({ input: request }) => {
    classifyCalls++;
    return { items: request.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
  };
  const { core, db } = fixture(t, { model, captureDeadlineMs: 1_000 });
  const pending = core.capture(input('stalled'));
  assert.equal((await pending).error.code, 'model_timeout');
  assert.equal(savedSignal.aborted, true);
  assert.equal(isCoreModelDeadlineSignal(savedSignal), true);
  assert.equal(isCoreModelDeadlineSignal(AbortSignal.abort('model_timeout')), false);
  assert.equal(count(db, 'memories'), 0);
  assert.equal(count(db, 'receipts'), 0);
  release({ items: [{ content: 'Late synthetic answer.', kind: 'fact',
    confidence: 0.8, sourceIndices: [0] }] });
  await wait(10);
  assert.equal(count(db, 'memories'), 0);
  assert.equal(classifyCalls, 0);
  assert.equal(ok(await core.capture(input('later'))).classification.status, 'applied');
  assert.equal(classifyCalls, 1);
});

test('D4 post-admission classifier expiry retains receipts and cold failed journal without later rationale', async t => {
  const methods = [];
  let classifySignal;
  const model = rationaleModel((method, request) => {
    methods.push(method);
    if (method === 'classify') classifySignal = request.signal;
  });
  model.classify = ({ signal }) => { methods.push('classify'); classifySignal = signal;
    return new Promise(() => {}); };
  const { core, db, path } = fixture(t, { model, captureDeadlineMs: 1_000,
    captureQualification: 'source-bound-v2', captureRationale: 'source-bound-v1' });
  const result = ok(await core.capture(input('classify-timeout', 'I chose A because it supports offline work.')));
  assert.equal(result.admission.memories.length, 1);
  assert.equal(result.classification.status, 'failed');
  assert.equal(result.classification.error.code, 'model_timeout');
  assert.equal(result.rationale.status, 'failed');
  assert.equal(result.rationale.error.code, 'model_timeout');
  assert.equal(methods.includes('relate'), false);
  assert.equal(methods.includes('classify'), true, 'classification began after committed admission');
  assert.equal(classifySignal.aborted, true);
  assert.equal(isCoreModelDeadlineSignal(classifySignal), true);
  assert.equal(count(db, 'receipts'), 1);
  assert.equal(count(db, 'rationale_edges'), 0);
  const cold = openMemoryCore({ path }); t.after(() => cold.close());
  const inspected = ok(cold.inspectAdmission({ namespace, client: 'deadline-client',
    eventId: 'classify-timeout', includeInitialClassification: true }));
  assert.equal(inspected.status, 'completed');
  assert.equal(inspected.initialClassification.status, 'failed');
  assert.equal(inspected.members[0].filing.status, 'unfiled');
});

test('D3 optional transaction check rejects before BEGIN and rolls back after work', t => {
  const { db } = fixture(t);
  db.exec('CREATE TABLE deadline_probe (value INTEGER) STRICT');
  let checks = 0;
  assert.throws(() => transaction(db, () => { db.exec('INSERT INTO deadline_probe VALUES (1)'); },
    () => { if (++checks === 2) throw new Error('synthetic precommit expiry'); }),
  /synthetic precommit expiry/);
  assert.equal(checks, 2);
  assert.equal(count(db, 'deadline_probe'), 0);
  assert.throws(() => transaction(db, () => {}, () => { throw new Error('synthetic prebegin expiry'); }),
    /synthetic prebegin expiry/);
  assert.equal(count(db, 'deadline_probe'), 0);
});

test('D2/D3 output serialization crossing expiry rejects before admission', async t => {
  for (const throws of [false, true]) {
    const model = scripted();
    let serialized = 0;
    model.extract = () => ({ toJSON() {
      serialized++;
      pause(700);
      if (throws) throw new Error('synthetic serialization failure after expiry');
      return { items: [{ content: 'Synthetic delayed serialization.', kind: 'fact',
        confidence: 0.8, sourceIndices: [0] }] };
    } });
    const { core, db } = fixture(t, { model, captureDeadlineMs: 500 });
    assert.equal((await core.capture(input(`output-serialization-${throws}`))).error.code, 'model_timeout');
    assert.equal(serialized, 1, 'output serialization crossed the deadline');
    assert.equal(count(db, 'memories'), 0);
    assert.equal(count(db, 'receipts'), 0);
    assert.equal(count(db, 'capture_initial_classification'), 0);
  }
});

test('D3 ordinary final admission checks after actual receipt INSERT and rolls back all writes', async t => {
  const { core, db } = fixture(t, { captureDeadlineMs: 600 });
  const delayed = delayAfterSql('INSERT OR IGNORE INTO receipts', 900);
  try {
    const result = await core.capture(input('admission-precommit'));
    assert.equal(delayed.reached(), 1, 'receipt mutation occurred inside the guarded transaction');
    assert.equal(result.error.code, 'model_timeout');
    assert.equal(count(db, 'memories'), 0);
    assert.equal(count(db, 'receipts'), 0);
    assert.equal(count(db, 'capture_initial_classification'), 0);
    assert.equal(db.prepare("SELECT state FROM admission_claims WHERE event_id='admission-precommit'").get().state,
      'pending');
  } finally { delayed.restore(); }
});

test('D3 ordered high-water and predecessor retirement roll back after actual in-transaction mutation', async t => {
  const friday = 'Project Alpha deadline is Friday.';
  const monday = 'Project Alpha deadline is Monday.';
  let judgments = 0;
  const model = { ...scripted(), reconcile: () => { judgments++; return { transitions: [{
    replacementIndex: 0, predecessorIndex: 0, evidenceIndices: [0],
    relation: 'supersedes', valueChange: 'changed', adoption: 'explicit',
  }] }; } };
  const { core, db } = fixture(t, { model, captureDeadlineMs: 600 });
  const causal = sequence => ({ streamId: 'synthetic-stream', sequence });
  const first = ok(await core.capture(input('ordered-first', friday, causal(1))));
  const prior = first.admission.memories[0];
  const before = count(db, 'receipts');
  const priorBefore = { ...db.prepare('SELECT currentness,revision FROM memories WHERE id=?').get(prior.id) };
  assert.deepEqual(priorBefore, { currentness: 'current', revision: prior.revision });
  assert.equal(count(db, 'memory_supersessions'), 0);
  let inside;
  const delayed = delayAfterSql('UPDATE capture_streams SET high_water', 900, connection => {
    const supersession = connection.prepare(`SELECT previous_memory_id,previous_revision,
      replacement_memory_id,replacement_revision,receipt_ids FROM memory_supersessions
      WHERE previous_memory_id=?`).get(prior.id);
    const receiptIds = supersession ? JSON.parse(supersession.receipt_ids) : [];
    inside = {
      highWater: connection.prepare(`SELECT high_water FROM capture_streams
        WHERE stream_id='synthetic-stream'`).get()?.high_water,
      previous: { ...connection.prepare('SELECT currentness,revision FROM memories WHERE id=?').get(prior.id) },
      supersession,
      evidenceOwners: receiptIds.map(id => connection.prepare('SELECT memory_id FROM receipts WHERE id=?').get(id)?.memory_id),
    };
  });
  try {
    const result = await core.capture(input('ordered-second', monday, causal(2)));
    assert.equal(delayed.reached(), 1, 'ordered high-water advanced before precommit check');
    assert.equal(judgments, 1);
    assert.equal(inside.highWater, 2, 'new stream progress was visible inside the write transaction');
    assert.deepEqual(inside.previous, { currentness: 'historical', revision: prior.revision + 1 },
      'predecessor retirement was visible inside the write transaction');
    assert.equal(inside.supersession.previous_memory_id, prior.id);
    assert.equal(inside.supersession.previous_revision, prior.revision);
    assert.notEqual(inside.supersession.replacement_memory_id, prior.id);
    assert.equal(inside.evidenceOwners.length, 1);
    assert.deepEqual(inside.evidenceOwners, [inside.supersession.replacement_memory_id],
      'the uncommitted successor receipt was bound as supersession evidence');
    assert.equal(result.error.code, 'model_timeout');
    assert.equal(db.prepare("SELECT high_water FROM capture_streams WHERE stream_id='synthetic-stream'")
      .get().high_water, 1);
    assert.deepEqual({ ...db.prepare('SELECT currentness,revision FROM memories WHERE id=?').get(prior.id) }, priorBefore);
    assert.equal(count(db, 'memory_supersessions'), 0);
    assert.equal(ok(core.get({ namespace, memoryId: prior.id })).memory.state, 'active');
    assert.equal(count(db, 'memories'), 1);
    assert.equal(count(db, 'receipts'), before);
    assert.equal(count(db, 'capture_initial_classification'), 1);
  } finally { delayed.restore(); }
});

test('D3 each initial claim variant rolls back when its own transaction outlives the deadline', async t => {
  const variants = [
    { name: 'ordinary', options: {}, model: scripted(), sql: 'INSERT INTO admission_claims' },
    { name: 'staged', options: { captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' },
      model: rationaleModel(), sql: 'INSERT INTO staged_capture_evidence' },
    { name: 'ordered', options: {}, model: { ...scripted(), reconcile: () => ({ transitions: [] }) },
      sql: 'INSERT INTO capture_streams' },
  ];
  for (const variant of variants) {
    let extracts = 0;
    const model = { ...variant.model, extract: request => {
      extracts++;
      return variant.model.extract(request);
    } };
    const { core, db } = fixture(t, { model, captureDeadlineMs: 600, ...variant.options });
    const delayed = delayAfterSql(variant.sql, 900);
    try {
      const result = await core.capture(input(`claim-${variant.name}`, undefined,
        variant.name === 'ordered' ? { streamId: 'claim-stream', sequence: 1 } : undefined));
      assert.equal(delayed.reached(), 1, `${variant.name} claim mutation reached`);
      assert.equal(result.error.code, 'model_timeout');
      assert.equal(extracts, 0);
      for (const table of ['admission_claims', 'memories', 'receipts', 'capture_initial_classification']) {
        assert.equal(count(db, table), 0, `${variant.name} ${table}`);
      }
      if (variant.name === 'staged') assert.equal(count(db, 'staged_capture_evidence'), 0);
      if (variant.name === 'ordered') {
        assert.equal(count(db, 'capture_events'), 0);
        assert.equal(count(db, 'capture_streams'), 0);
      }
    } finally { delayed.restore(); }
  }
});

test('D3 initial journal begin rolls back to not_started and never calls classifier after expiry', async t => {
  let classified = 0;
  const model = scripted();
  model.classify = () => { classified++; return { items: [] }; };
  const { core, db } = fixture(t, { model, captureDeadlineMs: 600 });
  const delayed = delayAfterSql("SET status='in_flight_or_interrupted'", 900);
  try {
    const result = ok(await core.capture(input('journal-begin')));
    assert.equal(delayed.reached(), 1);
    assert.equal(result.classification.status, 'failed');
    assert.equal(result.classification.error.code, 'model_timeout');
    assert.equal(classified, 0);
    assert.equal(db.prepare("SELECT status FROM capture_initial_classification WHERE event_id='journal-begin'")
      .get().status, 'not_started');
    assert.equal(count(db, 'memories'), 1);
    assert.equal(count(db, 'receipts'), 1);
  } finally { delayed.restore(); }
});

test('D3 placement expiry rolls back filing and applied journal while retaining admission', async t => {
  const model = scripted();
  model.classify = ({ input: request }) => ({ items: request.memories.map(memory => ({
    memoryId: memory.id, parentIds: [], newL1: { title: 'Synthetic deadline topic', parentL2Ids: [] },
  })) });
  const { core, db } = fixture(t, { model, captureDeadlineMs: 600 });
  const delayed = delayAfterSql("SET status='applied',final_refs", 900);
  try {
    const result = ok(await core.capture(input('placement-precommit')));
    assert.equal(delayed.reached(), 1);
    assert.equal(result.classification.status, 'failed');
    assert.equal(result.classification.error.code, 'model_timeout');
    assert.equal(count(db, 'mocs'), 0);
    assert.equal(count(db, 'receipts'), 1);
    const member = ok(core.get({ namespace, memoryId: result.admission.memories[0].id })).memory;
    assert.equal(member.filing.status, 'unfiled');
    assert.equal(db.prepare("SELECT status FROM capture_initial_classification WHERE event_id='placement-precommit'")
      .get().status, 'failed');
  } finally { delayed.restore(); }
});

test('D3/D4 rationale commit expiry rolls back edges but keeps admitted sources and applied placement', async t => {
  const { core, db } = fixture(t, { model: rationaleModel(), captureDeadlineMs: 600,
    captureQualification: 'source-bound-v2', captureRationale: 'source-bound-v1' });
  const delayed = delayAfterSql('INSERT INTO rationale_edges', 900);
  try {
    const result = ok(await core.capture(input('rationale-precommit',
      'I chose A because it supports offline work.')));
    assert.equal(delayed.reached(), 1);
    assert.equal(result.classification.status, 'applied');
    assert.equal(result.rationale.status, 'failed');
    assert.equal(result.rationale.error.code, 'model_timeout');
    assert.equal(count(db, 'rationale_edges'), 0);
    assert.equal(count(db, 'receipts'), 1);
    assert.equal(db.prepare("SELECT status FROM capture_initial_classification WHERE event_id='rationale-precommit'")
      .get().status, 'applied');
  } finally { delayed.restore(); }
});

test('D3 staged final admission rolls back qualified evidence when receipt work crosses deadline', async t => {
  const { core, db } = fixture(t, { model: rationaleModel(), captureDeadlineMs: 600,
    captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' });
  const delayed = delayAfterSql('INSERT OR IGNORE INTO receipts', 900);
  try {
    const result = await core.capture(input('staged-final'));
    assert.equal(delayed.reached(), 1);
    assert.equal(result.error.code, 'model_timeout');
    for (const table of ['memories', 'receipts', 'capture_initial_classification']) {
      assert.equal(count(db, table), 0, table);
    }
    assert.equal(db.prepare("SELECT state FROM admission_claims WHERE event_id='staged-final'").get().state,
      'pending');
    assert.notEqual(db.prepare("SELECT state FROM staged_capture_evidence WHERE event_id='staged-final'")
      .get().state, 'admitted');
  } finally { delayed.restore(); }
});

test('D2/D3 cumulative extraction plus v1/v2 qualification exhausts one budget before admission', () => {
  const child = fileURLToPath(new URL('../testing/capture-deadline-clock-child.mjs', import.meta.url));
  for (const mode of ['source-bound-v1', 'source-bound-v2']) {
    const run = mutation => spawnSync(process.execPath, [child, mode, ...(mutation ? [mutation] : [])],
      { encoding: 'utf8', env: {}, timeout: 10_000 });
    const actual = run();
    assert.equal(actual.status, 0, `${mode}: ${actual.stderr}`);
    assert.deepEqual(JSON.parse(actual.stdout), { mode, calls: ['extract', 'qualify'],
      extractionEndedMs: 600, qualificationStartedMs: 600, qualificationEndedMs: 1_200,
      errorCode: 'model_timeout' });
    const resetPerStage = run('reset-stage-deadline');
    assert.equal(resetPerStage.status, 2, `${mode}: reset-per-stage mutant must fail the assertion`);
    assert.match(resetPerStage.stderr, /shared deadline must abort the qualification call/u);
  }
});

test('D2/D3 ordered reconciliation expiry preserves predecessor and rejects new admission', async t => {
  let reconciles = 0;
  const model = { ...scripted(), reconcile: () => { reconciles++; return new Promise(() => {}); } };
  const { core, db } = fixture(t, { model, captureDeadlineMs: 1_000 });
  const causal = sequence => ({ streamId: 'reconcile-stream', sequence });
  const first = ok(await core.capture(input('reconcile-first',
    'Project Alpha deadline is Friday.', causal(1))));
  const prior = first.admission.memories[0];
  const before = count(db, 'receipts');
  const result = await core.capture(input('reconcile-second',
    'Project Alpha deadline is Monday.', causal(2)));
  assert.equal(result.error.code, 'model_timeout');
  assert.equal(reconciles, 1);
  assert.equal(count(db, 'memories'), 1);
  assert.equal(count(db, 'receipts'), before);
  assert.equal(ok(core.get({ namespace, memoryId: prior.id })).memory.state, 'active');
  assert.equal(db.prepare("SELECT high_water FROM capture_streams WHERE stream_id='reconcile-stream'")
    .get().high_water, 1);
});

test('D4 rationale-only expiry is honest; ordinary classifier failure still runs best-effort rationale', async t => {
  const source = 'I chose A because it supports offline work.';
  let relates = 0;
  const slow = rationaleModel();
  slow.relate = () => { relates++; return new Promise(() => {}); };
  const timed = fixture(t, { model: slow, captureDeadlineMs: 1_000,
    captureQualification: 'source-bound-v2', captureRationale: 'source-bound-v1' });
  const expired = ok(await timed.core.capture(input('rationale-wait', source)));
  assert.equal(expired.classification.status, 'applied');
  assert.equal(expired.rationale.status, 'failed');
  assert.equal(expired.rationale.error.code, 'model_timeout');
  assert.equal(relates, 1);
  assert.equal(count(timed.db, 'rationale_edges'), 0);

  const spoof = rationaleModel();
  spoof.classify = () => { throw new Error('model_timeout'); };
  const ordinary = fixture(t, { model: spoof, captureDeadlineMs: 2000,
    captureQualification: 'source-bound-v2', captureRationale: 'source-bound-v1' });
  const result = ok(await ordinary.core.capture(input('provider-spoof', source)));
  assert.equal(result.classification.status, 'failed');
  assert.equal(result.classification.error.code, 'classification_failed');
  assert.equal(result.rationale.status, 'reviewed');
  assert.equal(count(ordinary.db, 'rationale_edges'), 1);
});

test('D1/D5 concurrent captures do not share a deadline or block a standalone classification', async t => {
  let release;
  const model = scripted();
  model.extract = ({ input: request }) => request.messages[0].content.includes('slow')
    ? new Promise(resolve => { release = resolve; })
    : { items: [{ content: request.messages[0].content, kind: 'fact',
      confidence: 0.8, sourceIndices: [0] }] };
  const { core, db } = fixture(t, { model, captureDeadlineMs: 1_000 });
  const slow = core.capture(input('slow'));
  const fast = ok(await core.capture(input('fast')));
  assert.equal(fast.classification.status, 'applied');
  assert.equal((await slow).error.code, 'model_timeout');
  release({ items: [] });
  assert.equal(count(db, 'memories'), 1);
  const mapped = ok(core.map({ namespace, purpose: 'classification' }));
  const member = fast.admission.memories[0];
  assert.equal((await core.classifyPlacement({ namespace, memoryIds: [member.id],
    expectedMemoryRevisions: [{ memoryId: member.id, revision: member.revision }],
    mapRevision: mapped.indexRevision })).ok, true);
});

test('D4 a genuinely committed rationale is not relabeled failed by expiry after its commit', async t => {
  const { core, db } = fixture(t, { model: rationaleModel() });
  const admitted = ok(core.admit({ namespace,
    memory: { content: 'I chose A because it supports offline work.', kind: 'decision' },
    receipts: [{ client: 'deadline-client', sessionId: 'manual', eventId: 'manual-source',
      role: 'user', excerpt: 'I chose A because it supports offline work.' }] })).memory;
  const ref = { memoryId: admitted.id, revision: admitted.revision };
  const deadline = createCaptureDeadline(1_000);
  let committed = false;
  const result = await reviewCapturedRationale({ snapshot: { namespace },
    admission: { memories: [{ id: admitted.id, revision: admitted.revision }] },
    classification: { status: 'failed' },
    sourceMessages: [{ content: 'I chose A because it supports offline work.' }], deadline,
    operations: { get: request => core.get(request),
      discoverRationale: () => ({ ok: true, value: { refs: [ref], scanExhausted: true,
        candidatesTruncated: false } }),
      reviewRationale: async request => {
        const persisted = await core.reviewRationale(request);
        committed = persisted.ok;
        pause(1_200); // Cross the budget only after the real persistence call returned.
        return persisted;
      } } });
  assert.equal(committed, true);
  assert.equal(deadline.expired(), true);
  assert.equal(result.status, 'reviewed');
  assert.equal(count(db, 'rationale_edges'), 1);
});

test('D2 external abort and provider timeout text never acquire core AbortSignal provenance', async () => {
  for (const thrown of [new DOMException('Synthetic external abort', 'AbortError'),
    new Error('model_timeout')]) {
    let signal;
    const model = { contextWindow: 8192, countTokens: () => 1,
      select: request => { signal = request.signal; throw thrown; } };
    await assert.rejects(callModel(model, 'select', 'Synthetic', {},
      { deadline: createCaptureDeadline(2000) }), error => error.code ===
      (thrown.name === 'AbortError' ? 'model_cancelled' : 'recall_failed'));
    assert.equal(isCoreModelDeadlineSignal(signal), false);
  }
});
