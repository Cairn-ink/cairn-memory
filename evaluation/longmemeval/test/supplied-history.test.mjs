import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { captureSnapshot } from '../../../core/capture-input.mjs';
import { redactSecrets } from '../../../plugins/cairn-memory/lib/redact.mjs';
import * as source from '../mixed-source.mjs';

const id = (kind, name) => `lme-${kind}-${createHash('sha256').update(name).digest('hex')}`;
const caseId = id('case', 'supplied-history-synthetic');
const names = ['next-day', 'equal-first', 'earlier', 'same-day-after', 'equal-second'];
const dates = ['2023/10/16 (Mon) 00:00', '2023/10/15 (Sun) 17:53',
  '2023/10/14 (Sat) 09:30', '2023/10/15 (Sun) 17:54', '2023/10/15 (Sun) 17:53'];
const fixture = () => ({ history: { question_id: caseId,
  sessions: names.map((name, index) => ({ session_index: index,
    session_id: id('session', name), date: dates[index], turns: [
      { turn_id: id('turn', name), role: index % 2 ? 'assistant' : 'user',
        content: `Sentinel ${name}.` }] })) },
question: { question_id: caseId, text: 'Synthetic recall only?', date: dates[1] },
namespace: { ownerId: 'synthetic-supplied-history', scope: 'project', projectId: caseId } });
const prepare = (...args) => source.prepareSuppliedHistoryCase(...args);
const normalize = (text) => redactSecrets(text.normalize('NFKC')).replace(/\s+/gu, ' ').trim();
const expectError = (input, code) => assert.throws(() => prepare(input), { code });
const bodies = (result) => result.renderedHistory.sessions.flatMap((session) =>
  session.turns.map((turn) => {
    const origin = result.originMap.turns.find((row) => row.renderedTurnId === turn.turn_id);
    return turn.content.slice(origin.bodyStart, origin.bodyEnd);
  }));

// Reconstruct every original turn from contiguous origin spans, and every
// indexed window from the actual submitted batch. No synthetic arm substitute.
function assertEvidence(input, result, profile) {
  const origins = new Map(result.originMap.turns.map((row) => [row.renderedTurnId, row]));
  assert.equal(origins.size, result.originMap.turns.length);
  assert.equal(result.renderedHistory.sessions.length, input.history.sessions.length);
  for (const [sessionIndex, session] of input.history.sessions.entries()) {
    const rendered = result.renderedHistory.sessions[sessionIndex];
    assert.equal(rendered.session_id, session.session_id);
    assert.equal(rendered.session_index, sessionIndex);
    assert.deepEqual(result.originMap.sessions[sessionIndex], {
      renderedSessionIndex: sessionIndex, originalSessionIndex: sessionIndex,
      originalSessionId: session.session_id, originalDate: session.date });
    for (const [turnIndex, turn] of session.turns.entries()) {
      const chunks = rendered.turns.filter((chunk) => origins.get(chunk.turn_id).originalTurnIndex === turnIndex);
      let next = 0, rebuilt = '';
      assert.ok(chunks.length > 0);
      for (const chunk of chunks) {
        const row = origins.get(chunk.turn_id);
        assert.equal(row.originalSessionIndex, sessionIndex);
        assert.equal(row.originalSessionId, session.session_id);
        assert.equal(row.originalTurnId, turn.turn_id);
        assert.equal(row.normalizedStart, next);
        assert.equal(row.normalizationChanged, normalize(turn.content) !== turn.content);
        assert.equal(chunk.role, turn.role);
        assert.equal(chunk.content.slice(0, row.bodyStart),
          `[session-date: ${rendered.date}; clock: dataset-local] source{`);
        assert.equal(chunk.content.slice(row.bodyEnd), ' }');
        assert.ok(chunk.content.length <= 4000 && chunk.content.isWellFormed());
        const body = chunk.content.slice(row.bodyStart, row.bodyEnd);
        assert.equal(body, normalize(turn.content).slice(row.normalizedStart, row.normalizedEnd));
        rebuilt += body; next = row.normalizedEnd;
      }
      assert.equal(rebuilt, normalize(turn.content));
      assert.equal(next, normalize(turn.content).length);
    }
  }
  assert.deepEqual(result.mem0Input.batches, result.cairnPlan.batches.map((batch) =>
    batch.captureInput.messages.map(({ role, content }) => ({ role, content }))));
  let windowCount = 0, messageCount = 0;
  for (const batch of result.cairnPlan.batches) {
    const captured = captureSnapshot(batch.captureInput, 'source-bound-v2',
      profile === 'indexed-evidence-v1' ? 'indexed-evidence-v1' : 'indexed-windows-v1');
    assert.deepEqual(captured.messages, batch.captureInput.messages);
    for (const row of batch.sourceMap) {
      messageCount++;
      assert.ok(origins.has(row.turnId));
      const message = batch.captureInput.messages[row.messageIndex];
      assert.equal(row.rawContent, message.content);
      assert.equal(row.role, message.role);
      assert.equal(row.chunkIndex, 0);
      assert.equal(row.rawStartUtf16, 0);
      assert.equal(row.rawEndUtf16, message.content.length);
    }
    for (const window of batch.indexedWindows) {
      windowCount++;
      const message = batch.captureInput.messages[window.messageIndex];
      const turnOrigin = origins.get(batch.sourceMap[window.messageIndex].turnId);
      const row = result.originMap.windows.find((entry) => entry.batchIndex === batch.batchIndex
        && entry.windowIndex === window.index);
      assert.equal(window.content, message.content.slice(window.start, window.end));
      assert.equal(row.renderedTurnId, turnOrigin.renderedTurnId);
      const inside = window.start >= turnOrigin.bodyStart && window.end <= turnOrigin.bodyEnd;
      const original = input.history.sessions[turnOrigin.originalSessionIndex]
        .turns[turnOrigin.originalTurnIndex].content;
      const start = turnOrigin.normalizedStart + window.start - turnOrigin.bodyStart;
      const end = turnOrigin.normalizedStart + window.end - turnOrigin.bodyStart;
      const unchanged = inside && !turnOrigin.normalizationChanged
        && original.slice(start, end) === window.content;
      assert.equal(row.classification, !inside ? 'metadata-or-mixed'
        : unchanged ? 'original-source' : 'normalized-source');
      assert.equal(row.originalStartUtf16, unchanged ? start : null);
      assert.equal(row.originalEndUtf16, unchanged ? end : null);
    }
  }
  assert.equal(messageCount, result.originMap.turns.length);
  assert.equal(windowCount, result.counts.windows);
  assert.equal(windowCount, result.originMap.windows.length);
}

test('SH1/SH4 legacy v2 snapshots preserve cutoff, source order and output shape', () => {
  const result = source.prepareMixedSourceCase(fixture());
  assert.equal(source.mixedSourcePolicy().digest,
    '8a584f0d115967063036ecaee745d1b32e87d7fdd216e61f4e86c40117caea4d');
  assert.equal(result.caseDigest, '1d691e37eeee55dd7325e10e635f007159bbbfedb02e59b29cf8cfd949b07dcd');
  assert.equal(result.originalHistoryDigest,
    '8de799bb7bd90aff7ade538b1a9d047b4fd93f7dac8073f1c346c2787565c3c0');
  assert.equal(createHash('sha256').update(JSON.stringify(result)).digest('hex'),
    '659593e6ab03ce9abc01286b676cc8243471f94218d1bd724d22a98ec4c61e0f');
  const evidence = source.prepareMixedSourceCase(fixture(), 'indexed-evidence-v1');
  assert.equal(createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),
    '4d2598149db430940b5c780c9ac1306054efa723386f2279770e11aae191a16a');
  assert.deepEqual(bodies(result), ['Sentinel equal-first.', 'Sentinel earlier.', 'Sentinel equal-second.']);
  assert.deepEqual(result.originMap.sessions.map((row) => row.originalSessionIndex), [1, 2, 4]);
  assert.deepEqual(Object.keys(result.counts), ['originalSessions', 'eligibleSessions',
    'excludedFutureSessions', 'originalTurns', 'renderedTurns', 'batches', 'windows']);
  const future = fixture(); future.question.date = '2023/10/13 (Fri) 00:00';
  assert.throws(() => source.prepareMixedSourceCase(future), { code: 'no_eligible_history' });
});

for (const profile of [undefined, 'indexed-evidence-v1']) {
  test(`SH1–SH3 supplied history retains unordered before/equal/later sessions (${profile ?? 'default'})`, () => {
    assert.equal(typeof source.prepareSuppliedHistoryCase, 'function');
    assert.equal(typeof source.suppliedHistoryPolicy, 'function');
    const input = fixture(), before = structuredClone(input);
    const result = prepare(input, profile);
    assert.deepEqual(input, before);
    assertEvidence(input, result, profile);
    assert.deepEqual(bodies(result), names.map((name) => `Sentinel ${name}.`));
    assert.deepEqual(result.renderedHistory.sessions.map((session) => session.date),
      ['2023-10-16 00:00', '2023-10-15 17:53', '2023-10-14 09:30', '2023-10-15 17:54', '2023-10-15 17:53']);
    assert.equal(result.counts.originalSessions, 5);
    assert.equal(result.counts.eligibleSessions, 5);
    assert.equal(result.counts.excludedFutureSessions, 0);
    assert.equal(result.counts.sessionsAfterQuestion, 2);
    assert.equal(result.counts.originalTurns, 5);
    assert.equal(result.version, 'cairn-lme-supplied-history-v1');
    assert.equal(result.policy, source.suppliedHistoryPolicy());
    assert.deepEqual(result.policy.limits, source.mixedSourcePolicy().limits);
    assert.equal(result.policy.digest,
      '908154ac04430df9ef23063658fd5cf553811466b313dfe0a94022f4002a270b');
    assert.equal(result.originalHistoryDigest,
      '00c46cda3fd487aa7b2169082712cb33aead8b9be5be1776ad8b97001ea91de5');
    if (profile === undefined) assert.equal(result.caseDigest,
      'cd4fdc73c4e9e7e09b444e8ae0f736db2a6ae25059fc38ad7600860fe68409a0');
    assert.equal(result.policy.date.cutoff, 'include-all-supplied;preserve-source-order');
    assert.equal(result.policy.date.timestamps, 'preserve;no-repair');
    assert.equal(result.mem0Input.query, normalize(JSON.stringify({
      question: input.question.text, date: '2023-10-15 17:53' })));
    assert.ok(!result.mem0Input.batches.flat().some((row) => row.content.includes(input.question.text)));
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.policy.date), true);
    assert.equal(Object.isFrozen(result.originMap.turns[0]), true);
    assert.equal(Object.isFrozen(result.mem0Input.batches[0][0]), true);
  });
}

test('SH2 all-future supplied history prepares; strict malformed future history still fails', () => {
  const input = fixture(); input.question.date = '2023/10/13 (Fri) 00:00';
  const result = prepare(input);
  assert.equal(result.counts.sessionsAfterQuestion, 5);
  assert.equal(result.counts.eligibleSessions, 5);
  assertEvidence(input, result);
  for (const date of ['future-ish', '2023/10/16 (Sun) 00:00', '2023/02/29 (Wed) 00:00',
    '2023/10/16 (Mon) 24:00', '2023/10/16 (Mon) 00:60', '2023-10-16',
    '1899/12/31 (Sun) 00:00']) {
    const bad = fixture(); bad.history.sessions[0].date = date;
    expectError(bad, 'invalid_date');
    const question = fixture(); question.question.date = date;
    expectError(question, 'invalid_date');
  }
  const bad = fixture(); bad.history.sessions[0].turns[0].role = 'system';
  expectError(bad, 'invalid_history');
  assert.throws(() => prepare(fixture(), 'supplied-history-v1'), { code: 'invalid_options' });
});

test('SH3 hash domains, all inputs, canonical keys and floating dates are stable and distinct', () => {
  const input = fixture(); input.question.date = '2023/10/17 (Tue) 00:00';
  const legacy = source.prepareMixedSourceCase(input), result = prepare(input);
  assert.deepEqual(result.mem0Input, legacy.mem0Input);
  for (const key of ['policy', 'history', 'turn', 'case']) {
    assert.notEqual(result.policy.hashDomains[key], legacy.policy.hashDomains[key]);
    assert.match(result.policy.hashDomains[key], /^cairn\.lme\.supplied-history\..*\.v1$/u);
  }
  assert.notEqual(result.caseDigest, legacy.caseDigest);
  assert.notEqual(result.originalHistoryDigest, legacy.originalHistoryDigest);
  assert.notEqual(result.policy.digest, legacy.policy.digest);
  assert.notEqual(result.renderedHistory.sessions[0].turns[0].turn_id,
    legacy.renderedHistory.sessions[0].turns[0].turn_id);
  const reordered = JSON.parse(JSON.stringify(input, (key, value) => value && !Array.isArray(value)
    && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse()) : value));
  assert.equal(prepare(reordered).caseDigest, result.caseDigest);
  const previousTZ = process.env.TZ;
  try {
    process.env.TZ = 'Pacific/Honolulu'; const first = prepare(input);
    process.env.TZ = 'Asia/Tokyo'; assert.equal(prepare(input).caseDigest, first.caseDigest);
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
  for (const change of [(row) => { row.history.sessions[0].turns[0].content += ' changed'; },
    (row) => { row.question.text += ' changed'; },
    (row) => { row.namespace.ownerId += '-changed'; },
    (row) => { row.history.sessions[0].date = '2023/10/16 (Mon) 00:01'; }]) {
    const changed = structuredClone(input); change(changed);
    assert.notEqual(prepare(changed).caseDigest, result.caseDigest);
  }
});

test('SH2/SH4 full-turn normalization, redaction, astral chunks and stable greedy boundaries', () => {
  const prefix = '[session-date: 2023-10-16 00:00; clock: dataset-local] source{';
  const maxBody = 4000 - prefix.length - 2;
  const contents = [
    'x'.repeat(maxBody - 1) + '🧭漢字',
    'Ｆｕｌｌｗｉｄｔｈ e\u0301   sk-' + 'A'.repeat(18) + ' ' + 'ﬃ'.repeat(3000),
    'a'.repeat(maxBody) + 'sk-' + 'A'.repeat(18),
    'a'.repeat(maxBody - 1) + ' b',
    'password: [REDACTED]',
  ];
  for (const profile of [undefined, 'indexed-evidence-v1']) {
    const input = fixture(); input.history.sessions = [input.history.sessions[0]];
    input.history.sessions[0].turns = contents.map((content, index) => ({
      turn_id: id('turn', `boundaries:${index}`), role: index % 2 ? 'assistant' : 'user', content }));
    const result = prepare(input, profile);
    assertEvidence(input, result, profile);
    const chunks = (index) => result.renderedHistory.sessions[0].turns.filter((turn) =>
      result.originMap.turns.find((row) => row.renderedTurnId === turn.turn_id).originalTurnIndex === index)
      .map((turn) => turn.content.slice(prefix.length, -2));
    assert.deepEqual(chunks(0), ['x'.repeat(maxBody - 1), '🧭漢字']);
    assert.deepEqual(chunks(2), ['a'.repeat(maxBody), 'sk-' + 'A'.repeat(15), 'AAA']);
    assert.deepEqual(chunks(3), ['a'.repeat(maxBody - 1), ' b']);
    assert.ok(!JSON.stringify(result.mem0Input).includes('sk-' + 'A'.repeat(18)));
    assert.ok(result.originMap.windows.some((row) => row.classification === 'normalized-source'));
    assert.ok(result.originMap.windows.some((row) => row.classification === 'original-source'));
  }
});

test('SH2/SH4 descriptors, sparse arrays, prototypes, malformed Unicode and exact schemas fail closed', () => {
  let reads = 0;
  for (const path of ['question', 'future-turn']) {
    const input = fixture(); const object = path === 'question' ? input.question
      : input.history.sessions[0].turns[0];
    Object.defineProperty(object, path === 'question' ? 'text' : 'content', {
      enumerable: true, get() { reads++; return 'never read'; } });
    expectError(input, 'invalid_input');
  }
  assert.equal(reads, 0);
  for (const change of [
    (row) => { row.history.sessions = new Array(2); },
    (row) => { row.history.sessions[0].turns = new Array(1); },
    (row) => { Object.setPrototypeOf(row.question, new Date()); },
    (row) => { row.history.sessions[0].turns[0].content = '\ud800'; },
    (row) => { row.question.text = 'bad\0text'; },
    (row) => { row[Symbol('extra')] = true; },
    (row) => { row.extra = row; },
  ]) {
    const input = fixture(); change(input); expectError(input, 'invalid_input');
  }
  for (const [location, code] of [['options', 'invalid_options'], ['history', 'invalid_history'],
    ['question', 'invalid_question'], ['namespace', 'invalid_namespace'],
    ['session', 'invalid_history'], ['turn', 'invalid_history']]) {
    for (const field of ['extra', 'answer', 'answer_session_ids', 'has_answer', 'reference', 'evaluator']) {
      const input = fixture(); const target = location === 'options' ? input
        : location === 'session' ? input.history.sessions[0]
          : location === 'turn' ? input.history.sessions[0].turns[0] : input[location];
      target[field] = 'forbidden'; expectError(input, code);
    }
  }
  const secret = fixture(); secret.history.sessions[0].turns[0].content = 'sk-' + 'A'.repeat(18);
  expectError(secret, 'invalid_normalization');
  const blank = fixture(); blank.history.sessions[0].turns[0].content = '\u00a0\t';
  expectError(blank, 'invalid_history');
  const duplicate = fixture(); duplicate.history.sessions[1].turns[0].turn_id =
    duplicate.history.sessions[0].turns[0].turn_id;
  expectError(duplicate, 'invalid_history');
  for (const change of [
    (row) => { row.history.sessions[0].session_index = -0; },
    (row) => { row.history.sessions[1].session_index = 2; },
    (row) => { row.history.sessions[0].session_id = 'readable-session'; },
    (row) => { row.history.sessions[0].turns[0].turn_id = 'readable-turn'; },
    (row) => { row.history.sessions[1].session_id = row.history.sessions[0].session_id; },
  ]) {
    const input = fixture(); change(input); expectError(input, 'invalid_history');
  }
});

test('SH2/SH4 caps remain explicit failures rather than partially prepared arm inputs', () => {
  const oversized = fixture(); oversized.history.sessions[0].turns[0].content = 'x'.repeat(8 * 1024 * 1024);
  expectError(oversized, 'input_limit_exceeded');
  const query = fixture(); query.question.text = 'x'.repeat(4001);
  expectError(query, 'invalid_query');
  const sessions = fixture(); sessions.history.sessions = Array.from({ length: 2501 }, (_, index) => ({
    session_index: index, session_id: id('session', `limit:${index}`), date: dates[0],
    turns: [{ turn_id: id('turn', `limit:${index}`), role: 'user', content: 'synthetic' }] }));
  expectError(sessions, 'invalid_history');
  const inflated = fixture(); inflated.history.sessions = [inflated.history.sessions[0]];
  inflated.history.sessions[0].turns[0].content = '\ufdfa'.repeat(500_000);
  expectError(inflated, 'render_limit_exceeded');
  const deep = fixture(); let node = deep;
  for (let index = 0; index < 18; index++) { node.extra = {}; node = node.extra; }
  expectError(deep, 'input_limit_exceeded');
  const nodes = fixture(); nodes.question.text = Array.from({ length: 200_000 }, () => 0);
  expectError(nodes, 'input_limit_exceeded');
  const probe = fixture(); probe.history.sessions = [probe.history.sessions[0]];
  const prefix = '[session-date: 2023-10-16 00:00; clock: dataset-local] source{';
  const maxBody = 4000 - prefix.length - 2;
  const trap = 'a'.repeat(maxBody) + 'sk-' + 'A'.repeat(18) + 'a'.repeat(maxBody);
  probe.history.sessions[0].turns = Array.from({ length: 6 }, (_, index) => ({
    turn_id: id('turn', `probe:${index}`), role: 'user', content: trap }));
  expectError(probe, 'render_probe_limit_exceeded');
});
