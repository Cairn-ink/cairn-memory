import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { captureSnapshot } from '../../../core/capture-input.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import {
  ingestLongMemEvalCase,
  LongMemEvalIngestionError,
  planLongMemEvalCase,
  projectIngestionFailure,
} from '../ingestion.mjs';
import { opaqueQuestionId, stableTurnId } from '../prepare.mjs';

const namespace = (projectId = null) => ({
  ownerId: 'longmemeval-tests',
  scope: projectId === null ? 'personal' : 'project',
  projectId,
});

const history = ({ sourceQuestionId = 'synthetic-case', sessions } = {}) => ({
  question_id: opaqueQuestionId(sourceQuestionId),
  sessions: sessions ?? [{
    session_index: 0,
    session_id: 'source-session',
    date: 'source date retained verbatim',
    turns: [
      { turn_id: stableTurnId(sourceQuestionId, 0, 'source-session', 0),
        role: 'user', content: 'Prefer concise diagrams.' },
      { turn_id: stableTurnId(sourceQuestionId, 0, 'source-session', 1),
        role: 'assistant', content: 'Understood.' },
    ],
  }],
});

const completed = (classification = { status: 'skipped', reason: 'empty' }) => ({
  ok: true,
  value: {
    duplicate: false,
    admission: { memories: [], suppressedCount: 0, indexRevision: 1 },
    classification,
  },
});

const clone = (value) => structuredClone(value);
const plan = (source, ns = namespace()) => planLongMemEvalCase({ history: source, namespace: ns });
const ok = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
};

const reconstructedTurns = (capturePlan) => {
  const mapped = new Map();
  for (const batch of capturePlan.batches) {
    for (const source of batch.sourceMap) {
      if (!mapped.has(source.turnId)) mapped.set(source.turnId, []);
      mapped.get(source.turnId).push(source);
    }
  }
  return new Map([...mapped].map(([turnId, chunks]) => [turnId, chunks
    .sort((left, right) => left.chunkIndex - right.chunkIndex)
    .map((chunk) => chunk.rawContent).join('')]));
};

test('I01: strict in-memory schema rejects poison, answer labels and malformed coordinates', () => {
  const base = history();
  const invalid = [
    { ...base, answer: 'poison' },
    { ...base, sessions: base.sessions.map((session) => ({ ...session, annotation: true })) },
    { ...base, sessions: base.sessions.map((session) => ({ ...session, session_index: 1 })) },
    { ...base, sessions: base.sessions.map((session) => ({ ...session, date: '' })) },
    { ...base, sessions: base.sessions.map((session) => ({ ...session,
      turns: session.turns.map((turn, index) => index ? turn : { ...turn, has_answer: true }) })) },
    { ...base, sessions: base.sessions.map((session) => ({ ...session,
      turns: session.turns.map((turn) => ({ ...turn, role: 'system' })) })) },
    { ...base, sessions: base.sessions.map((session) => ({ ...session,
      turns: session.turns.map((turn) => ({ ...turn, turn_id: session.turns[0].turn_id })) })) },
    { ...base, question_id: 'source-case_abs' },
  ];
  for (const candidate of invalid) {
    assert.throws(() => plan(candidate), (error) => error instanceof LongMemEvalIngestionError
      && error.code === 'invalid_history');
  }
  for (const invalidNamespace of [
    { ownerId: 'owner', scope: 'personal' },
    { ownerId: 'owner', scope: 'personal', projectId: 'project' },
    { ownerId: 'owner', scope: 'project', projectId: null },
    { ownerId: 'owner', scope: 'project', projectId: 'project', evaluator: true },
  ]) {
    assert.throws(() => plan(base, invalidNamespace), { code: 'invalid_namespace' });
  }
  assert.throws(() => planLongMemEvalCase({ history: base, namespace: namespace(), manifest: {} }),
    { code: 'invalid_options' });
});

test('I02/I03: deterministic plans losslessly map code-point-safe raw chunks and actual normalized input', () => {
  const sourceQuestionId = 'unicode-expansion';
  const raw = `  ﷺ ${'a'.repeat(4_100)}😀${'ﷺ'.repeat(500)}  `;
  const source = history({ sourceQuestionId, sessions: [{
    session_index: 0,
    session_id: 'unicode-source',
    date: 'not interpreted as a timestamp',
    turns: [{ turn_id: stableTurnId(sourceQuestionId, 0, 'unicode-source', 0),
      role: 'user', content: raw }],
  }] });
  const first = plan(source);
  const second = plan(clone(source));
  assert.deepEqual(first, second);
  assert.equal(first.executable, true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.batches[0].sourceMap[0]), true);

  const rebuilt = reconstructedTurns(first);
  assert.equal(rebuilt.get(source.sessions[0].turns[0].turn_id), raw);
  const maps = first.batches.flatMap((batch) => batch.sourceMap);
  assert.equal(maps[0].rawStartUtf16, 0);
  assert.equal(maps.at(-1).rawEndUtf16, raw.length);
  for (let index = 0; index < maps.length; index += 1) {
    const sourceMap = maps[index];
    assert.equal(sourceMap.rawContent, raw.slice(sourceMap.rawStartUtf16, sourceMap.rawEndUtf16));
    if (index > 0) assert.equal(maps[index - 1].rawEndUtf16, sourceMap.rawStartUtf16);
    if (sourceMap.rawEndUtf16 < raw.length) {
      assert.equal(/[\uD800-\uDBFF]/u.test(raw[sourceMap.rawEndUtf16 - 1]), false,
        'a chunk must not end between an astral surrogate pair');
    }
    assert.ok(sourceMap.rawContent.length <= 20_000);
    assert.ok(sourceMap.normalizedContent.length <= 4_000);
  }
  for (const batch of first.batches) {
    const snapshot = captureSnapshot(batch.captureInput);
    assert.deepEqual(snapshot.messages, batch.normalizedCapture.messages);
    assert.equal(snapshot.payloadDigest, batch.normalizedCapture.payloadDigest);
    assert.ok(snapshot.messages.length <= 24);
    assert.ok(snapshot.messages.reduce((sum, message) => sum + message.content.length, 0) <= 20_000);
  }
  assert.notEqual(maps.map((item) => item.rawContent).join(''),
    maps.map((item) => item.normalizedContent).join(''));
  assert.equal(first.summary.modelContextFitEstablished, false);
});

test('I02/I06: long repeated session occurrences stay isolated and sensitivity changes identities', () => {
  const sourceQuestionId = 'repeated-sessions';
  const turns = Array.from({ length: 30 }, (_, turnIndex) => ({
    turn_id: stableTurnId(sourceQuestionId, 0, 'repeated', turnIndex),
    role: turnIndex % 2 ? 'assistant' : 'user',
    content: `${turnIndex}:` + 'x'.repeat(998),
  }));
  const repeatedTurns = turns.map((turn, turnIndex) => ({
    ...turn,
    turn_id: stableTurnId(sourceQuestionId, 1, 'repeated', turnIndex),
  }));
  const source = history({ sourceQuestionId, sessions: [
    { session_index: 0, session_id: 'repeated', date: 'first date', turns },
    { session_index: 1, session_id: 'repeated', date: 'second date', turns: repeatedTurns },
  ] });
  const capturePlan = plan(source);
  assert.equal(capturePlan.executable, true);
  assert.ok(capturePlan.batches.length >= 4);
  assert.equal(new Set(capturePlan.batches.map((batch) => batch.captureInput.sessionId)).size, 2);
  assert.equal(new Set(capturePlan.batches.map((batch) => batch.captureInput.eventId)).size,
    capturePlan.batches.length);
  for (const batch of capturePlan.batches) {
    assert.equal(new Set(batch.sourceMap.map((item) => item.sessionIndex)).size, 1);
  }

  const truncated = clone(source);
  truncated.sessions[0].turns[0].content = truncated.sessions[0].turns[0].content.slice(0, -1);
  assert.notEqual(plan(truncated).batches[0].captureInput.messages[0].id,
    capturePlan.batches[0].captureInput.messages[0].id);
  const roleChanged = clone(source);
  roleChanged.sessions[0].turns[0].role = 'assistant';
  assert.notEqual(plan(roleChanged).batches[0].normalizedCapture.payloadDigest,
    capturePlan.batches[0].normalizedCapture.payloadDigest);
});

test('I03: invalid turns block the full case, retain raw source and make zero capture calls', async () => {
  const credential = `${'x'.repeat(3_970)} sk-${'a'.repeat(48)} ${'suffix'.repeat(200)}`;
  assert.ok(credential.indexOf('sk-') < 4_000);
  assert.ok(credential.indexOf('sk-') + 51 > 4_000);
  const cases = [
    ['empty_normalized_turn', ' \n\t '],
    ['fully_redacted_turn', `sk-${'a'.repeat(48)}`],
    ['redaction_sensitive_split', credential],
    ['unpartitionable_turn', `${' '.repeat(20_001)}x`],
    ['invalid_normalized_turn', 'left\0right'],
  ];
  for (const [code, content] of cases) {
    const source = history();
    source.sessions[0].turns[0].content = content;
    let calls = 0;
    const result = await ingestLongMemEvalCase({ history: source, namespace: namespace(), capture: async () => {
      calls += 1;
      return completed();
    } });
    assert.equal(result.plan.executable, false);
    assert.equal(result.plan.blockers[0].code, code);
    assert.equal(result.plan.sourceTurns[0].rawContent, content);
    assert.equal(result.plan.blockers[0].rawContent, content);
    assert.equal(calls, 0);
    assert.ok(result.outcomes.every((outcome) => outcome.status === 'not_run'));
  }
});

test('I04: runner is sequential, snapshots before awaiting and continues only completed/duplicate', async () => {
  const sourceQuestionId = 'runner-sequence';
  const source = history({ sourceQuestionId, sessions: [0, 1, 2].map((sessionIndex) => ({
    session_index: sessionIndex,
    session_id: `session-${sessionIndex}`,
    date: `date-${sessionIndex}`,
    turns: [{ turn_id: stableTurnId(sourceQuestionId, sessionIndex, `session-${sessionIndex}`, 0),
      role: 'user', content: `original-${sessionIndex}` }],
  })) });
  let active = 0;
  let maximumActive = 0;
  const seen = [];
  const options = { history: source, namespace: namespace(), capture: async (input) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    seen.push(input.messages[0].content);
    source.sessions[1].turns[0].content = 'caller-mutated';
    await Promise.resolve();
    active -= 1;
    if (seen.length === 1) {
      options.capture = async () => { throw new Error('caller-rerouted'); };
      return completed();
    }
    return { ok: true, value: { duplicate: true, memoryIds: [], suppressedCount: 0 } };
  } };
  const result = await ingestLongMemEvalCase(options);
  assert.deepEqual(result.outcomes.map((outcome) => outcome.status),
    ['completed', 'duplicate', 'duplicate']);
  assert.deepEqual(seen, ['original-0', 'original-1', 'original-2']);
  assert.equal(maximumActive, 1);
});

test('I04: every stop condition is sanitized, never retried and leaves later batches not_run', async () => {
  const sourceQuestionId = 'runner-stops';
  const makeSource = () => history({ sourceQuestionId, sessions: [0, 1].map((sessionIndex) => ({
    session_index: sessionIndex,
    session_id: `stop-${sessionIndex}`,
    date: `date-${sessionIndex}`,
    turns: [{ turn_id: stableTurnId(sourceQuestionId, sessionIndex, `stop-${sessionIndex}`, 0),
      role: 'user', content: `message-${sessionIndex}` }],
  })) });
  const stops = [
    ['unknown', async () => ({ ok: true, value: { processing: true } }), 'capture_processing'],
    ['failed', async () => ({ ok: false,
      error: { code: 'model_timeout', retryable: false } }), 'model_timeout'],
    ['failed', async () => ({ ok: false,
      error: { code: 'PRIVATE PROVIDER BODY', retryable: true } }), 'capture_failed'],
    ['failed', async () => ({ ok: false,
      error: { code: 'private_customer_123', retryable: true } }), 'capture_failed'],
    ['failed', async () => ({ ok: false,
      error: { code: 'capture_threw', retryable: true } }), 'capture_failed'],
    ['partial', async () => completed({ status: 'failed',
      error: { code: 'classification_failed', retryable: false } }), 'classification_failed'],
    ['partial', async () => completed({ status: 'failed',
      error: { code: 'PRIVATE CLASSIFIER BODY', retryable: true } }), 'classification_failed'],
    ['partial', async () => completed({ status: 'failed',
      error: { code: 'private_customer_123', retryable: true } }), 'classification_failed'],
    ['unknown', async () => ({ ok: true, value: { duplicate: false } }), 'malformed_capture_response'],
    ['unknown', async () => { throw new Error('PRIVATE THROWN BODY'); }, 'capture_threw'],
  ];
  for (const [status, capture, code] of stops) {
    let calls = 0;
    const result = await ingestLongMemEvalCase({ history: makeSource(), namespace: namespace(),
      capture: async (input) => { calls += 1; return capture(input); } });
    assert.equal(calls, 1);
    assert.equal(result.outcomes[0].status, status);
    assert.equal(result.outcomes[0].error?.code
      ?? result.outcomes[0].result.classification.error.code, code);
    assert.equal(result.outcomes[1].status, 'not_run');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|private_customer_123/u);
  }
});

test('failure projection rechecks finite codes and stages without success diagnostics', () => {
  for (const status of ['completed', 'duplicate', 'not_run', 'private_status', undefined]) {
    assert.equal(projectIngestionFailure({ status, error: { code: 'model_timeout' } }), null);
  }
  for (const status of ['partial', 'failed', 'unknown']) {
    assert.equal(projectIngestionFailure({ status }), null);
    assert.deepEqual(projectIngestionFailure({ status, errorStage: 'private_stage',
      error: { code: 'private_customer_123', retryable: true, message: 'private text' } }), {
      errorStage: status === 'partial' ? 'classification' : 'capture',
      error: { code: status === 'partial' ? 'classification_failed' : 'capture_failed', retryable: false },
    });
  }
  for (const code of ['capture_failed', 'capture_processing', 'malformed_capture_response', 'capture_threw']) {
    assert.deepEqual(projectIngestionFailure({ status: 'unknown', error: { code, retryable: true } }),
      { errorStage: 'capture', error: { code, retryable: false } });
  }
  assert.deepEqual(projectIngestionFailure({ status: 'partial',
    result: { classification: { error: { code: 'model_timeout', retryable: true } } } }),
  { errorStage: 'classification', error: { code: 'model_timeout', retryable: true } });
});

test('I05: actual core receipts map to raw intervals; replay and forgetting cannot resurrect', async (t) => {
  const sourceQuestionId = 'receipt-lifecycle';
  const longContent = `lead ${'z'.repeat(4_100)} tail`;
  const source = history({ sourceQuestionId, sessions: [{
    session_index: 0,
    session_id: 'receipt-source',
    date: 'DATE_METADATA_MUST_NOT_REACH_MODEL',
    turns: [{ turn_id: stableTurnId(sourceQuestionId, 0, 'receipt-source', 0),
      role: 'user', content: longContent }],
  }] });
  const calls = [];
  const model = {
    contextWindow: 8_192,
    countTokens: () => 1,
    extract: async (request) => {
      calls.push({ method: 'extract', input: clone(request.input) });
      return { items: [{ content: 'Synthetic mapped memory.', kind: 'fact', confidence: 0.8,
        sourceIndices: [request.input.messages.length - 1] }] };
    },
    classify: async (request) => {
      calls.push({ method: 'classify', input: clone(request.input) });
      return { items: request.input.memories.map((memory) => ({
        memoryId: memory.id,
        parentIds: [],
        newL1: { title: 'Synthetic', parentL2Ids: [] },
      })) };
    },
  };
  const databasePath = join(mkdtempSync(join(tmpdir(), 'cairn-lme-ingestion-')), 'memory.sqlite');
  const core = openMemoryCore({ path: databasePath, model });
  t.after(() => core.close());

  const first = await ingestLongMemEvalCase({ history: source, namespace: namespace(), capture: core.capture });
  assert.deepEqual(first.outcomes.map((outcome) => outcome.status), ['completed']);
  assert.doesNotMatch(JSON.stringify(calls), /DATE_METADATA_MUST_NOT_REACH_MODEL/u);
  const memoryId = first.outcomes[0].result.admission.memories[0].id;
  const detail = ok(core.get({ namespace: namespace(), memoryId }));
  const receipt = detail.receipts[0];
  const sourceMap = first.plan.batches[0].sourceMap.find((item) => item.messageId === receipt.eventId);
  assert.ok(sourceMap);
  assert.equal(receipt.sessionId, first.plan.batches[0].captureInput.sessionId);
  assert.equal(receipt.role, sourceMap.role);
  assert.equal(receipt.excerpt, sourceMap.normalizedContent);
  assert.equal(sourceMap.rawContent,
    longContent.slice(sourceMap.rawStartUtf16, sourceMap.rawEndUtf16));

  const callsBeforeReplay = calls.length;
  const replay = await ingestLongMemEvalCase({ history: source, namespace: namespace(), capture: core.capture });
  assert.deepEqual(replay.outcomes.map((outcome) => outcome.status), ['duplicate']);
  assert.equal(calls.length, callsBeforeReplay);

  ok(core.forget({ namespace: namespace(), memoryId, expectedRevision: detail.memory.revision }));
  const afterForget = await ingestLongMemEvalCase({
    history: source,
    namespace: namespace(),
    capture: core.capture,
  });
  assert.deepEqual(afterForget.outcomes.map((outcome) => outcome.status), ['duplicate']);
  assert.equal(calls.length, callsBeforeReplay);
  assert.equal(core.get({ namespace: namespace(), memoryId }).ok, false);
});

test('I05: exact per-case namespaces do not leak memories across cases', async (t) => {
  const model = {
    contextWindow: 8_192,
    countTokens: () => 1,
    extract: async ({ input }) => ({ items: [{ content: `Memory from ${input.messages[0].content}`,
      kind: 'context', confidence: 0.7, sourceIndices: [0] }] }),
    classify: async ({ input }) => ({ items: input.memories.map((memory) => ({
      memoryId: memory.id,
      parentIds: [],
      newL1: { title: 'Cases', parentL2Ids: [] },
    })) }),
  };
  const databasePath = join(mkdtempSync(join(tmpdir(), 'cairn-lme-isolation-')), 'memory.sqlite');
  const core = openMemoryCore({ path: databasePath, model });
  t.after(() => core.close());
  const first = history({ sourceQuestionId: 'isolation-a' });
  const second = history({ sourceQuestionId: 'isolation-b' });
  first.sessions[0].turns = [first.sessions[0].turns[0]];
  second.sessions[0].turns = [second.sessions[0].turns[0]];
  first.sessions[0].turns[0].content = 'case A';
  second.sessions[0].turns[0].content = 'case B';
  const firstNamespace = namespace(first.question_id);
  const secondNamespace = namespace(second.question_id);
  await ingestLongMemEvalCase({ history: first, namespace: firstNamespace, capture: core.capture });
  await ingestLongMemEvalCase({ history: second, namespace: secondNamespace, capture: core.capture });
  const firstList = ok(core.list({ namespace: firstNamespace, limit: 10 }));
  const secondList = ok(core.list({ namespace: secondNamespace, limit: 10 }));
  assert.deepEqual(firstList.memories.map((memory) => ok(core.get({
    namespace: firstNamespace,
    memoryId: memory.id,
  })).memory.content), ['Memory from case A']);
  assert.deepEqual(secondList.memories.map((memory) => ok(core.get({
    namespace: secondNamespace,
    memoryId: memory.id,
  })).memory.content), ['Memory from case B']);
  assert.equal(core.get({ namespace: firstNamespace, memoryId: secondList.memories[0].id }).ok, false);
  assert.equal(core.get({ namespace: secondNamespace, memoryId: firstList.memories[0].id }).ok, false);
});
