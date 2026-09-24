import assert from 'node:assert/strict';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { migrateVersion10 } from '../qualified-transition-schema.mjs';
import { migrateVersion11 } from '../rationale-schema.mjs';
import { migrateVersion12 } from '../staged-evidence-schema.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';

const namespace = { ownerId: 'journal-synthetic', scope: 'project', projectId: 'first' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const batch = (eventId, content = `Synthetic ${eventId} source.`) => ({ namespace,
  client: 'journal-client', eventId, sessionId: 'journal-session',
  messages: [{ id: `message-${eventId}`, role: 'user', content }] });
const inspect = (core, eventId, flag = true, ns = namespace) => ok(core.inspectAdmission({
  namespace: ns, client: 'journal-client', eventId,
  ...(flag ? { includeInitialClassification: true } : {}),
}));
const journal = (db, eventId) => db.prepare(`SELECT status,bound_refs,selected_refs,final_refs,attempt_token
  FROM capture_initial_classification WHERE event_id=?`).get(eventId);
const receipts = (db, id) => db.prepare('SELECT receipt_key,excerpt FROM receipts WHERE memory_id=? ORDER BY id').all(id);

function fixture(t, model) {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-initial-journal-'));
  const path = join(dir, 'memory.sqlite');
  const core = openMemoryCore({ path, model });
  const db = new DatabaseSync(path);
  t.after(() => { core.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { core, db, path };
}

function scripted(steps = []) {
  const calls = [];
  return { calls, contextWindow: 8192, countTokens: () => 1,
    extract: ({ input }) => {
      calls.push('extract');
      if (input.messages[0].content.includes('empty source')) return { items: [] };
      return { items: [{ content: input.messages[0].content, kind: 'fact', confidence: 0.8,
        sourceIndices: [0] }] };
    },
    classify: ({ input }) => {
      calls.push('classify');
      const step = steps.shift();
      if (step === 'throw') throw new Error('private synthetic classifier error');
      return { items: input.memories.map(({ id }) => ({ memoryId: id, parentIds: [],
        ...(step === 'empty' ? {} : { newL1: { title: `Topic ${calls.length}`, parentL2Ids: [] } }) })) };
    } };
}

test('CJ1/CJ2/CJ4 initial outcomes are cold, bounded, opt-in and distinct from filing', async (t) => {
  const model = scripted(['throw', 'empty', 'filed']);
  const { core, db, path } = fixture(t, model);
  const failed = ok(await core.capture(batch('failed')));
  const emptyParent = ok(await core.capture(batch('no-op')));
  const filed = ok(await core.capture(batch('filed')));
  const empty = ok(await core.capture(batch('empty', 'Synthetic empty source.')));
  assert.equal(failed.classification.status, 'failed');
  assert.equal(emptyParent.classification.status, 'applied');
  assert.equal(filed.classification.status, 'applied');
  assert.deepEqual(empty.classification, { status: 'skipped', reason: 'empty' });
  assert.equal(inspect(core, 'failed').initialClassification.status, 'failed');
  assert.equal(inspect(core, 'no-op').initialClassification.status, 'applied');
  assert.equal(inspect(core, 'no-op').members[0].filing.status, 'unfiled');
  assert.equal(inspect(core, 'no-op').members[0].revision, emptyParent.admission.memories[0].revision);
  assert.equal(inspect(core, 'filed').members[0].filing.status, 'filed');
  assert.equal(inspect(core, 'empty').initialClassification.status, 'skipped_empty');
  const defaultView = inspect(core, 'failed', false);
  assert.deepEqual(defaultView.classification, { status: 'unknown' });
  assert.equal(Object.hasOwn(defaultView, 'initialClassification'), false);
  assert.deepEqual(ok(core.inspectAdmission({ namespace, client: 'journal-client', eventId: 'failed',
    includeInitialClassification: false })), defaultView);
  for (const bad of [null, 1, 'true']) assert.equal(core.inspectAdmission({ namespace,
    client: 'journal-client', eventId: 'failed', includeInitialClassification: bad }).error.code, 'invalid_input');
  const old = receipts(db, failed.admission.memories[0].id);
  assert.equal(old.length, 1);
  assert.equal(JSON.stringify(inspect(core, 'failed')).includes('Synthetic failed source'), false);
  assert.equal(JSON.stringify(inspect(core, 'failed')).includes(journal(db, 'failed').bound_refs), false);
  assert.equal(journal(db, 'filed').attempt_token, null);
  core.close();
  const cold = openMemoryCore({ path }); t.after(() => cold.close());
  for (const [id, status] of [['failed', 'failed'], ['no-op', 'applied'], ['filed', 'applied'],
    ['empty', 'skipped_empty']]) assert.equal(inspect(cold, id).initialClassification.status, status);
  assert.deepEqual(receipts(db, failed.admission.memories[0].id), old);
  assert.deepEqual(model.calls, ['extract', 'classify', 'extract', 'classify',
    'extract', 'classify', 'extract']);
});

test('CJ1/CJ4 admission-before-classification failure leaves not_started and duplicate never retries', async (t) => {
  const model = scripted();
  const { core, db, path } = fixture(t, model);
  db.exec(`CREATE TRIGGER synthetic_begin_fault BEFORE UPDATE ON capture_initial_classification
    WHEN NEW.status='in_flight_or_interrupted' BEGIN SELECT RAISE(ABORT,'synthetic_begin_fault'); END;`);
  const result = ok(await core.capture(batch('before-begin')));
  assert.equal(result.classification.status, 'failed');
  assert.equal(journal(db, 'before-begin').status, 'not_started');
  assert.equal(db.prepare("SELECT state FROM admission_claims WHERE event_id='before-begin'").get().state, 'completed');
  assert.deepEqual(model.calls, ['extract']);
  db.exec('DROP TRIGGER synthetic_begin_fault');
  core.close();
  const cold = openMemoryCore({ path, model }); t.after(() => cold.close());
  assert.equal(inspect(cold, 'before-begin').initialClassification.status, 'not_started');
  assert.equal(ok(await cold.capture(batch('before-begin'))).duplicate, true);
  assert.equal(journal(db, 'before-begin').status, 'not_started');
  assert.deepEqual(model.calls, ['extract']);
});

test('CJ2/CJ4 paused classifier survives cold reopen as in-flight, not inferred failed', async (t) => {
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const model = scripted();
  model.classify = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const { core, db, path } = fixture(t, model);
  const pending = core.capture(batch('paused'));
  await started;
  assert.equal(inspect(core, 'paused').initialClassification.status, 'in_flight_or_interrupted');
  core.close();
  const cold = openMemoryCore({ path }); t.after(() => cold.close());
  assert.equal(inspect(cold, 'paused').initialClassification.status, 'in_flight_or_interrupted');
  release({ items: [] });
  const result = ok(await pending);
  assert.equal(result.classification.status, 'failed');
  assert.equal(journal(db, 'paused').status, 'in_flight_or_interrupted');
  assert.equal(inspect(cold, 'paused').members[0].filing.status, 'unfiled');
});

test('CJ3/CJ4 late classifier success and failure cannot certify corrected, forgotten or historical members', async (t) => {
  for (const [eventId, mutation, late] of [['late-correct', 'correct', 'success'],
    ['late-forget', 'forget', 'throw'], ['late-supersede', 'supersede', 'success']]) {
    let entered;
    let resolve;
    let reject;
    const started = new Promise(done => { entered = done; });
    const model = scripted();
    model.classify = () => { entered(); return new Promise((yes, no) => { resolve = yes; reject = no; }); };
    const { core, db } = fixture(t, model);
    const pending = core.capture(batch(eventId));
    await started;
    const before = inspect(core, eventId);
    assert.equal(before.initialClassification.status, 'in_flight_or_interrupted');
    const member = before.members[0];
    if (mutation === 'correct') ok(core.correct({ namespace, memoryId: member.memoryId,
      expectedRevision: member.revision, content: 'Fresh corrected synthetic.', kind: 'fact',
      receipt: { client: 'journal-client', sessionId: 'late-session', eventId: `${eventId}-correction`,
        role: 'user', excerpt: 'Fresh corrected synthetic.' } }));
    else if (mutation === 'forget') ok(core.forget({ namespace, memoryId: member.memoryId,
      expectedRevision: member.revision }));
    else ok(core.supersede({ namespace, memoryId: member.memoryId, expectedRevision: member.revision,
      replacement: { content: 'Historical replacement synthetic.', kind: 'fact' },
      receipts: [{ client: 'journal-client', sessionId: 'late-session',
        eventId: `${eventId}-replacement`, role: 'user', excerpt: 'Historical replacement synthetic.' }] }));
    assert.equal(inspect(core, eventId).initialClassification.status, 'unknown');
    if (late === 'success') resolve({ items: [{ memoryId: member.memoryId, parentIds: [],
      newL1: { title: 'Late topic', parentL2Ids: [] } }] });
    else reject(new Error('late synthetic classifier failure'));
    assert.equal(ok(await pending).classification.status, 'failed');
    assert.equal(journal(db, eventId).status, 'failed');
    assert.equal(inspect(core, eventId).initialClassification.status, 'unknown');
    assert.equal(db.prepare("SELECT count(*) AS n FROM mocs WHERE title='Late topic'").get().n, 0);
  }
});

test('CJ1/CJ4 separate instances journal concurrent distinct batches without cross-attribution', async (t) => {
  const { core, db, path } = fixture(t, scripted(['throw']));
  const second = openMemoryCore({ path, model: scripted(['empty']) }); t.after(() => second.close());
  const [failed, noOp] = await Promise.all([
    core.capture(batch('parallel-failed')),
    second.capture(batch('parallel-no-op')),
  ]);
  assert.equal(ok(failed).classification.status, 'failed');
  assert.equal(ok(noOp).classification.status, 'applied');
  assert.equal(inspect(core, 'parallel-failed').initialClassification.status, 'failed');
  assert.equal(inspect(second, 'parallel-no-op').initialClassification.status, 'applied');
  assert.equal(db.prepare('SELECT count(*) AS n FROM capture_initial_classification').get().n, 2);
});

test('CJ1 exact batches keep separate journals across deduplication and fully suppressed recapture', async (t) => {
  const { core, db } = fixture(t, scripted(['empty', 'empty']));
  const first = ok(await core.capture(batch('dedup-first', 'Shared synthetic source.')));
  const second = ok(await core.capture(batch('dedup-second', 'Shared synthetic source.')));
  assert.equal(first.admission.memories[0].id, second.admission.memories[0].id);
  assert.equal(journal(db, 'dedup-first').status, 'applied');
  assert.equal(journal(db, 'dedup-second').status, 'applied');
  assert.equal(inspect(core, 'dedup-first').initialClassification.status, 'unknown');
  assert.equal(inspect(core, 'dedup-second').initialClassification.status, 'applied');
  const member = second.admission.memories[0];
  ok(core.forget({ namespace, memoryId: member.id,
    expectedRevision: ok(core.get({ namespace, memoryId: member.id })).memory.revision }));
  const suppressed = ok(await core.capture(batch('suppressed-third', 'Shared synthetic source.')));
  assert.deepEqual(suppressed.admission.memories, []);
  assert.equal(suppressed.admission.suppressedCount, 1);
  assert.equal(inspect(core, 'suppressed-third').initialClassification.status, 'skipped_empty');
  assert.equal(db.prepare('SELECT count(*) AS n FROM capture_initial_classification').get().n, 3);
});

test('CJ2 failed failure-record write remains in-flight and preserves original model failure', async (t) => {
  const { core, db } = fixture(t, scripted(['throw']));
  db.exec(`CREATE TRIGGER synthetic_failed_status_fault BEFORE UPDATE ON capture_initial_classification
    WHEN NEW.status='failed' BEGIN SELECT RAISE(ABORT,'synthetic_failed_status_fault'); END;`);
  const result = ok(await core.capture(batch('failure-record-fault')));
  assert.equal(result.classification.status, 'failed');
  assert.equal(result.classification.error.code, 'classification_failed');
  assert.equal(journal(db, 'failure-record-fault').status, 'in_flight_or_interrupted');
  assert.equal(inspect(core, 'failure-record-fault').initialClassification.status, 'in_flight_or_interrupted');
});

test('CJ1 ordinary capture private journal marker cannot bypass an ordered-event proof row', async (t) => {
  let db;
  const model = scripted();
  model.extract = ({ input }) => {
    db.prepare(`INSERT INTO capture_events
      (owner_id,scope,project_id,client,event_id,stream_id,sequence)
      VALUES (?,?,?,?,?,'synthetic-stream',1)`).run(namespace.ownerId, namespace.scope,
      namespace.projectId, 'journal-client', 'ordered-proof-fault');
    return { items: [{ content: input.messages[0].content, kind: 'fact',
      confidence: 0.8, sourceIndices: [0] }] };
  };
  const f = fixture(t, model); db = f.db;
  const result = await f.core.capture(batch('ordered-proof-fault'));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'stale_admission');
  assert.equal(db.prepare('SELECT count(*) AS n FROM capture_initial_classification').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM memories').get().n, 0);
});

test('CJ1/CJ3 journal faults rollback admission and changed placement, preserving receipts', async (t) => {
  const model = scripted();
  const { core, db } = fixture(t, model);
  db.exec(`CREATE TRIGGER synthetic_insert_fault BEFORE INSERT ON capture_initial_classification
    BEGIN SELECT RAISE(ABORT,'synthetic_insert_fault'); END;`);
  assert.equal((await core.capture(batch('insert-fault'))).error.code, 'storage_error');
  assert.equal(db.prepare('SELECT count(*) AS n FROM memories').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM receipts').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM capture_initial_classification').get().n, 0);
  assert.equal(db.prepare("SELECT state FROM admission_claims WHERE event_id='insert-fault'").get().state, 'pending');
  db.exec('DROP TRIGGER synthetic_insert_fault');
  db.exec(`CREATE TRIGGER synthetic_apply_fault BEFORE UPDATE ON capture_initial_classification
    WHEN NEW.status='applied' BEGIN SELECT RAISE(ABORT,'synthetic_apply_fault'); END;`);
  const failed = ok(await core.capture(batch('apply-fault')));
  assert.equal(failed.classification.status, 'failed');
  const id = failed.admission.memories[0].id;
  assert.equal(inspect(core, 'apply-fault').members[0].filing.status, 'unfiled');
  assert.equal(db.prepare('SELECT count(*) AS n FROM mocs').get().n, 0);
  assert.equal(receipts(db, id).length, 1);
  assert.equal(journal(db, 'apply-fault').status, 'failed');
  db.exec('DROP TRIGGER synthetic_apply_fault');
  const emptyModel = scripted(['empty']);
  const { core: noOp, db: noOpDb } = fixture(t, emptyModel);
  noOpDb.exec(`CREATE TRIGGER synthetic_noop_fault BEFORE UPDATE ON capture_initial_classification
    WHEN NEW.status='applied' BEGIN SELECT RAISE(ABORT,'synthetic_noop_fault'); END;`);
  const noOpResult = ok(await noOp.capture(batch('no-op-fault')));
  assert.equal(noOpResult.classification.status, 'failed');
  assert.equal(journal(noOpDb, 'no-op-fault').status, 'failed');
  assert.equal(inspect(noOp, 'no-op-fault').members[0].filing.status, 'unfiled');
});

test('CJ1 journal insert fault rolls back staged admission and ordered retirement/high-water in shared transaction', async (t) => {
  const stagedDir = mkdtempSync(join(tmpdir(), 'cairn-journal-staged-fault-'));
  const stagedPath = join(stagedDir, 'memory.sqlite');
  const staged = openMemoryCore({ path: stagedPath, model: rationaleModel(),
    captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' });
  const stagedDb = new DatabaseSync(stagedPath);
  t.after(() => { staged.close(); stagedDb.close(); rmSync(stagedDir, { recursive: true, force: true }); });
  stagedDb.exec(`CREATE TRIGGER synthetic_staged_journal_fault BEFORE INSERT ON capture_initial_classification
    WHEN NEW.event_id='staged-rollback'
      AND EXISTS (SELECT 1 FROM staged_capture_evidence
        WHERE event_id='staged-rollback' AND state='admitted')
      AND EXISTS (SELECT 1 FROM receipts)
    BEGIN SELECT RAISE(ABORT,'synthetic_staged_journal_fault'); END;`);
  const stagedResult = await staged.capture(batch('staged-rollback'));
  assert.equal(stagedResult.ok, false);
  assert.equal(stagedResult.error.code, 'storage_error');
  for (const table of ['memories', 'receipts', 'capture_initial_classification']) {
    assert.equal(stagedDb.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, table);
  }
  assert.equal(stagedDb.prepare("SELECT state FROM admission_claims WHERE event_id='staged-rollback'").get().state,
    'pending');

  let judgments = 0;
  const model = { ...scripted(['empty']), reconcile: () => { judgments++; return { transitions: [{
    replacementIndex: 0, predecessorIndex: 0, evidenceIndices: [0],
    relation: 'supersedes', valueChange: 'changed', adoption: 'explicit',
  }] }; } };
  const { core, db } = fixture(t, model);
  const first = ok(await core.capture({ ...batch('ordered-first', 'Project Alpha deadline is Friday.'),
    causal: { streamId: 'synthetic-stream', sequence: 1 } }));
  const original = first.admission.memories[0];
  const beforeReceipts = receipts(db, original.id);
  const beforeCount = db.prepare('SELECT count(*) AS n FROM memories').get().n;
  db.exec(`CREATE TRIGGER synthetic_ordered_journal_fault BEFORE INSERT ON capture_initial_classification
    WHEN NEW.event_id='ordered-second'
      AND EXISTS (SELECT 1 FROM memories WHERE id='${original.id}' AND currentness='historical')
      AND EXISTS (SELECT 1 FROM capture_streams
        WHERE stream_id='synthetic-stream' AND high_water=2)
    BEGIN SELECT RAISE(ABORT,'synthetic_ordered_journal_fault'); END;`);
  const ordered = await core.capture({ ...batch('ordered-second', 'Project Alpha deadline is Monday.'),
    causal: { streamId: 'synthetic-stream', sequence: 2 } });
  assert.equal(ordered.ok, false);
  assert.equal(ordered.error.code, 'storage_error');
  assert.equal(judgments, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM memories').get().n, beforeCount);
  assert.deepEqual(receipts(db, original.id), beforeReceipts);
  assert.equal(ok(core.get({ namespace, memoryId: original.id })).memory.state, 'active');
  assert.equal(db.prepare("SELECT high_water FROM capture_streams WHERE stream_id='synthetic-stream'")
    .get().high_water, 1);
  assert.equal(db.prepare("SELECT reconciliation FROM capture_events WHERE event_id='ordered-second'")
    .get().reconciliation, null);
  assert.equal(journal(db, 'ordered-second'), undefined);
});

test('CJ1 ordinary, qualified, staged and ordered capture all journal the initial attempt', async (t) => {
  const modes = [
    { name: 'ordinary', options: {}, model: scripted(['empty']) },
    { name: 'qualified', options: { captureQualification: 'source-bound-v1' },
      model: { ...scripted(['empty']), qualify: ({ input }) => ({ qualifications: input.items.map(
        ({ itemIndex, sources }) => ({ itemIndex, qualification: { version: 1,
          slot: { subject: null, property: null, scope: null, applies: null }, value: null,
          attribution: 'unknown', commitment: 'unknown', anchors: [{ receiptIndex: 0,
            start: 0, end: sources[0].excerpt.length, text: sources[0].excerpt,
            fields: ['value'] }] } })) }) } },
    { name: 'staged', options: { captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' },
      model: rationaleModel() },
    { name: 'ordered', options: {}, model: { ...scripted(['empty']),
      reconcile: () => ({ transitions: [] }) }, causal: { streamId: 'synthetic-stream', sequence: 1 } },
  ];
  for (const mode of modes) {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-journal-mode-'));
    const path = join(dir, 'memory.sqlite');
    const core = openMemoryCore({ path, model: mode.model, ...mode.options });
    t.after(() => { core.close(); rmSync(dir, { recursive: true, force: true }); });
    const eventId = mode.name;
    const result = ok(await core.capture({ ...batch(eventId),
      ...(mode.causal ? { causal: mode.causal } : {}) }));
    assert.equal(result.duplicate, false, mode.name);
    assert.equal(result.admission.memories.length, 1, mode.name);
    assert.equal(inspect(core, eventId).initialClassification.status, 'applied', mode.name);
    assert.equal(Object.hasOwn(inspect(core, eventId, false), 'initialClassification'), false);
  }
});

test('CJ3/CJ4 mixed dedup binds every member, later correction and independent recovery cannot claim the original attempt', async (t) => {
  const model = scripted();
  model.extract = () => ({ items: [
    { content: 'Existing filed synthetic.', kind: 'fact', confidence: 0.8, sourceIndices: [0] },
    { content: 'Fresh unfiled synthetic.', kind: 'fact', confidence: 0.8, sourceIndices: [0] },
  ] });
  const { core, db, path } = fixture(t, model);
  const source = { client: 'journal-client', sessionId: 'journal-session', eventId: 'message-mixed',
    role: 'user', excerpt: 'Mixed synthetic source.' };
  const existing = ok(core.admit({ namespace, memory: { content: 'Existing filed synthetic.', kind: 'fact' },
    receipts: [source] })).memory;
  const mapped = ok(core.map({ namespace, purpose: 'classification' }));
  ok(core.applyPlacement({ namespace, proposal: { items: [{ memoryId: existing.id, parentIds: [],
    newL1: { title: 'Already organized', parentL2Ids: [] } }] },
  expectedMemoryRevisions: [{ memoryId: existing.id, revision: existing.revision }],
  expectedIndexRevision: mapped.indexRevision }));
  const filedBefore = ok(core.get({ namespace, memoryId: existing.id })).memory;
  const result = ok(await core.capture(batch('mixed', 'Mixed synthetic source.')));
  assert.equal(result.admission.memories.length, 2);
  const row = journal(db, 'mixed');
  assert.equal(row.status, 'applied');
  assert.equal(JSON.parse(row.bound_refs).length, 2);
  assert.equal(JSON.parse(row.selected_refs).length, 1);
  assert.equal(JSON.parse(row.final_refs).length, 2);
  assert.equal(JSON.parse(row.final_refs)[0].revision, filedBefore.revision);
  assert.equal(inspect(core, 'mixed').initialClassification.status, 'applied');
  const corrected = ok(core.correct({ namespace, memoryId: existing.id,
    expectedRevision: filedBefore.revision, content: 'Corrected existing synthetic.', kind: 'fact',
    receipt: { ...source, eventId: 'correction', excerpt: 'Corrected existing synthetic.' } }));
  assert.equal(corrected.memory.filing.status, 'unfiled');
  assert.equal(inspect(core, 'mixed').initialClassification.status, 'unknown');
  assert.equal(inspect(core, 'mixed').members[0].revision, corrected.memory.revision);
  core.close();
  const cold = openMemoryCore({ path }); t.after(() => cold.close());
  assert.equal(inspect(cold, 'mixed').initialClassification.status, 'unknown');

  const failedModel = scripted(['throw']);
  const separate = fixture(t, failedModel);
  const failed = ok(await separate.core.capture(batch('failed-recovery')));
  const id = failed.admission.memories[0].id;
  assert.equal(journal(separate.db, 'failed-recovery').status, 'failed');
  const before = receipts(separate.db, id);
  const recovery = openMemoryCore({ path: separate.path, model: scripted() }); t.after(() => recovery.close());
  const snapshot = ok(recovery.map({ namespace, purpose: 'classification' }));
  const classified = ok(await recovery.classifyPlacement({ namespace, memoryIds: [id],
    expectedMemoryRevisions: [{ memoryId: id, revision: failed.admission.memories[0].revision }],
    mapRevision: snapshot.indexRevision }));
  ok(recovery.applyPlacement({ namespace, proposal: classified.proposal,
    expectedMemoryRevisions: classified.basedOn.memoryRevisions,
    expectedIndexRevision: classified.basedOn.indexRevision }));
  assert.equal(journal(separate.db, 'failed-recovery').status, 'failed');
  assert.equal(inspect(recovery, 'failed-recovery').initialClassification.status, 'unknown');
  assert.deepEqual(receipts(separate.db, id), before);
});

test('CJ4/CJ6 changed, forgotten, historical and foreign bound members never expose old attempt refs', async (t) => {
  const { core, db } = fixture(t, scripted());
  const captured = [];
  for (const eventId of ['correct', 'forget', 'historical', 'tamper']) {
    const result = ok(await core.capture(batch(eventId)));
    captured.push(result.admission.memories[0]);
    assert.equal(inspect(core, eventId).initialClassification.status, 'applied');
  }
  const [corrected, forgotten, historic] = captured;
  const changed = ok(core.correct({ namespace, memoryId: corrected.id,
    expectedRevision: corrected.revision + 1, content: 'New corrected synthetic.', kind: 'fact',
    receipt: { client: 'journal-client', sessionId: 's', eventId: 'new-correction',
      role: 'user', excerpt: 'New corrected synthetic.' } }));
  assert.equal(inspect(core, 'correct').initialClassification.status, 'unknown');
  assert.equal(inspect(core, 'correct').members[0].revision, changed.memory.revision);
  ok(core.forget({ namespace, memoryId: forgotten.id, expectedRevision: forgotten.revision + 1 }));
  assert.equal(inspect(core, 'forget').initialClassification.status, 'unknown');
  assert.deepEqual(inspect(core, 'forget').members, [{ status: 'closed' }]);
  ok(core.supersede({ namespace, memoryId: historic.id, expectedRevision: historic.revision + 1,
    replacement: { content: 'Replacement synthetic.', kind: 'fact' },
    receipts: [{ client: 'journal-client', sessionId: 's', eventId: 'replacement',
      role: 'user', excerpt: 'Replacement synthetic.' }] }));
  assert.equal(inspect(core, 'historical').initialClassification.status, 'unknown');
  assert.deepEqual(inspect(core, 'historical').members, [{ status: 'closed' }]);
  for (const ns of [{ ...namespace, projectId: 'sibling' },
    { ...namespace, scope: 'personal', projectId: null }]) {
    assert.deepEqual(inspect(core, 'tamper', true, ns), { status: 'absent',
      classification: { status: 'unknown' }, initialClassification: { status: 'unknown' } });
  }
  const foreignNs = { ...namespace, projectId: 'sibling' };
  const foreign = ok(core.admit({ namespace: foreignNs,
    memory: { content: 'Foreign private content.', kind: 'fact' },
    receipts: [{ client: 'journal-client', sessionId: 's', eventId: 'foreign',
      role: 'user', excerpt: 'Foreign private content.' }] })).memory;
  const forged = JSON.stringify([{ memoryId: foreign.id, revision: foreign.revision }]);
  db.prepare("UPDATE admission_claims SET memory_ids=? WHERE event_id='tamper'").run(JSON.stringify([foreign.id]));
  db.prepare(`UPDATE capture_initial_classification SET bound_refs=?,selected_refs=?,final_refs=?
    WHERE event_id='tamper'`).run(forged, forged, forged);
  const privateView = inspect(core, 'tamper');
  assert.deepEqual(privateView.members, [{ status: 'closed' }]);
  assert.deepEqual(privateView.initialClassification, { status: 'unknown' });
  const serialized = JSON.stringify(privateView);
  for (const hidden of [foreign.id, 'Foreign private content.', forged]) assert.equal(serialized.includes(hidden), false);
  db.prepare(`UPDATE capture_initial_classification SET final_refs='[{"memoryId":"bad","revision":0}]'
    WHERE event_id='tamper'`).run();
  assert.equal(core.inspectAdmission({ namespace, client: 'journal-client', eventId: 'tamper',
    includeInitialClassification: true }).error.code, 'storage_error');
});

test('CJ2/CJ6 legal escaped five-member guards fit the bounded journal column', (t) => {
  const { core, db } = fixture(t);
  const ids = Array.from({ length: 5 }, (_, index) => `${index}` + '\\'.repeat(199));
  const bound = JSON.stringify(ids.map(memoryId => ({ memoryId, revision: Number.MAX_SAFE_INTEGER })));
  assert.ok(bound.length > 2016 && bound.length < 4096);
  db.prepare(`INSERT INTO admission_claims
    (owner_id,scope,project_id,client,event_id,payload_digest,state,memory_ids,suppressed_count)
    VALUES (?,?,?,?,? ,?,'completed',?,0)`).run(namespace.ownerId, namespace.scope,
    namespace.projectId, 'journal-client', 'escaped', 'a'.repeat(64), JSON.stringify(ids));
  db.prepare(`INSERT INTO capture_initial_classification
    (owner_id,scope,project_id,client,event_id,status,bound_refs,selected_refs,final_refs)
    VALUES (?,?,?,?,?,'applied',?,?,?)`).run(namespace.ownerId, namespace.scope,
    namespace.projectId, 'journal-client', 'escaped', bound, bound, bound);
  assert.equal(inspect(core, 'escaped').initialClassification.status, 'unknown');
  assert.equal(inspect(core, 'escaped').members.every(member => member.status === 'closed'), true);
});

function version13Fixture(t) {
  // The frozen v10 fixture and unchanged v11-v13 migrations construct the old
  // format before the new v14 opener runs; the new implementation does not.
  const saved = JSON.parse(readFileSync(new URL('./qualified-transition-v10-fixture.json', import.meta.url), 'utf8'));
  const dir = mkdtempSync(join(tmpdir(), 'cairn-journal-v13-'));
  const path = join(dir, 'memory.sqlite');
  closeSync(openSync(path, 'ax', 0o600));
  const db = new DatabaseSync(path);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  for (const type of ['table', 'index', 'view']) for (const row of saved.schema.filter(item => item.type === type)) db.exec(row.sql);
  db.exec('BEGIN; PRAGMA defer_foreign_keys=ON');
  for (const { name, rows } of saved.tables) for (const row of rows) {
    const columns = Object.keys(row);
    db.prepare(`INSERT INTO "${name}" (${columns.map(column => `"${column}"`).join(',')})
      VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(row));
  }
  db.exec('COMMIT');
  for (const row of saved.schema.filter(item => item.type === 'trigger')) db.exec(row.sql);
  migrateVersion10(db); migrateVersion11(db); migrateVersion12(db);
  db.exec('PRAGMA application_id=1128352082; PRAGMA user_version=13');
  return { path, db, saved };
}

test('CJ6 true v13 old-format claims migrate to unknown without changing existing records', (t) => {
  const { path, db, saved } = version13Fixture(t);
  const before = saved.tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 13);
  assert.equal(db.prepare(`SELECT count(*) AS n FROM sqlite_master
    WHERE name='capture_initial_classification'`).get().n, 0);
  const cold = openMemoryCore({ path }); t.after(() => cold.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 14);
  for (const [name, rows] of before) assert.deepEqual(db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(), rows);
  assert.equal(db.prepare('SELECT count(*) AS n FROM capture_initial_classification').get().n, 0);
  const old = ok(cold.inspectAdmission({ namespace: saved.key.namespace, client: saved.key.client,
    eventId: saved.key.eventId, includeInitialClassification: true }));
  assert.equal(old.status, 'completed');
  assert.deepEqual(old.initialClassification, { status: 'unknown' });
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('CJ6 v13 migration collision rolls back DDL and remains retryable', (t) => {
  const { path, db } = version13Fixture(t);
  db.exec(`CREATE TABLE capture_initial_classification (synthetic_marker TEXT);
    INSERT INTO capture_initial_classification VALUES ('keep')`);
  const before = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
  assert.throws(() => openMemoryCore({ path }));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 13);
  assert.deepEqual(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), before);
  assert.equal(db.prepare('SELECT synthetic_marker FROM capture_initial_classification').get().synthetic_marker, 'keep');
  db.exec('DROP TABLE capture_initial_classification');
  const core = openMemoryCore({ path }); t.after(() => core.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 14);
});
