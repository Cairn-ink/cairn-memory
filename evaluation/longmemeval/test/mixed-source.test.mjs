import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { captureSnapshot } from '../../../core/capture-input.mjs';
import { redactSecrets } from '../../../plugins/cairn-memory/lib/redact.mjs';
import { mixedSourcePolicy, prepareMixedSourceCase } from '../mixed-source.mjs';

const id = (kind, name) => `lme-${kind}-${createHash('sha256').update(name).digest('hex')}`;
const caseId = id('case', 'mixed-source-synthetic');
const session = (name, index, date, contents) => ({ session_index: index,
  session_id: id('session', name), date,
  turns: contents.map(([role, content], turnIndex) => ({
    turn_id: id('turn', `${name}:${turnIndex}`), role, content })) });
const fixture = (sessions = [session('first', 0, '2023/10/14 (Sat) 09:30', [
  ['user', 'x'.repeat(1800)], ['assistant', 'Assistant says violet.']]),
session('second', 1, '2023/10/15 (Sun) 17:53', [['user', 'Same-minute message.']])],
questionDate = '2023/10/15 (Sun) 17:53') => ({
  history: { question_id: caseId, sessions },
  question: { question_id: caseId, text: 'Which color?', date: questionDate },
  namespace: { ownerId: 'synthetic-mixed-source', scope: 'project', projectId: caseId },
});
const clone = (value) => structuredClone(value);
const normalize = (value) => redactSecrets(value.normalize('NFKC')).replace(/\s+/gu, ' ').trim();
const error = (input, code) => assert.throws(() => prepareMixedSourceCase(input), { code });
const assertJsonData = (value) => {
  assert.notEqual(value, undefined);
  if (value && typeof value === 'object') {
    for (const member of Object.values(value)) assertJsonData(member);
  } else assert.ok(value === null || ['string', 'boolean', 'number'].includes(typeof value));
};
const assertOriginEvidence = (input, output) => {
  const turnsByRenderedId = new Map(output.originMap.turns.map((row) =>
    [row.renderedTurnId, row]));
  assert.equal(turnsByRenderedId.size, output.originMap.turns.length);
  const observedClasses = new Set();
  let renderedTurnCount = 0;
  for (const sessionRow of output.originMap.sessions) {
    const sourceSession = input.history.sessions[sessionRow.originalSessionIndex];
    const renderedSession = output.renderedHistory.sessions[sessionRow.renderedSessionIndex];
    assert.equal(sourceSession.session_id, sessionRow.originalSessionId);
    assert.equal(renderedSession.session_id, sourceSession.session_id);
    assert.equal(renderedSession.session_index, sessionRow.renderedSessionIndex);
    for (const [turnIndex, sourceTurn] of sourceSession.turns.entries()) {
      const normalized = normalize(sourceTurn.content);
      const chunks = renderedSession.turns.filter((turn) => {
        const row = turnsByRenderedId.get(turn.turn_id);
        return row?.originalTurnIndex === turnIndex;
      });
      assert.ok(chunks.length > 0);
      let nextStart = 0;
      let rebuilt = '';
      for (const chunk of chunks) {
        renderedTurnCount++;
        const row = turnsByRenderedId.get(chunk.turn_id);
        assert.equal(chunk.role, sourceTurn.role);
        assert.equal(row.originalSessionIndex, sessionRow.originalSessionIndex);
        assert.equal(row.originalSessionId, sourceSession.session_id);
        assert.equal(row.originalTurnId, sourceTurn.turn_id);
        assert.equal(row.normalizationChanged, normalized !== sourceTurn.content);
        assert.equal(row.normalizedStart, nextStart);
        assert.equal(row.bodyStart, `[session-date: ${renderedSession.date}; clock: dataset-local] source{`.length);
        assert.equal(chunk.content.slice(0, row.bodyStart),
          `[session-date: ${renderedSession.date}; clock: dataset-local] source{`);
        assert.equal(chunk.content.slice(row.bodyEnd), ' }');
        const body = chunk.content.slice(row.bodyStart, row.bodyEnd);
        assert.equal(body, normalized.slice(row.normalizedStart, row.normalizedEnd));
        rebuilt += body;
        nextStart = row.normalizedEnd;
      }
      assert.equal(nextStart, normalized.length);
      assert.equal(rebuilt, normalized);
    }
  }
  assert.equal(renderedTurnCount, output.originMap.turns.length);
  assert.equal(renderedTurnCount, output.renderedHistory.sessions.flatMap((s) => s.turns).length);
  assert.deepEqual(output.mem0Input.batches,
    output.cairnPlan.batches.map((batch) => batch.captureInput.messages.map(({ role, content }) =>
      ({ role, content }))));
  const plannerSources = output.cairnPlan.batches.flatMap((batch) => batch.sourceMap);
  assert.equal(plannerSources.length, renderedTurnCount);
  let mappedWindows = 0;
  for (const [batchIndex, batch] of output.cairnPlan.batches.entries()) {
    for (const source of batch.sourceMap) {
      const message = batch.captureInput.messages[source.messageIndex];
      const captured = batch.normalizedCapture.messages[source.messageIndex];
      assert.equal(source.chunkIndex, 0);
      assert.equal(source.rawStartUtf16, 0);
      assert.equal(source.rawEndUtf16, message.content.length);
      assert.equal(source.rawContent, message.content);
      assert.equal(captured.content, message.content);
      assert.equal(captured.role, message.role);
    }
    for (const [windowIndex, window] of batch.indexedWindows.entries()) {
      mappedWindows++;
      const row = output.originMap.windows.find((entry) =>
        entry.batchIndex === batchIndex && entry.windowIndex === windowIndex);
      assert.ok(row, `missing window ${batchIndex}:${windowIndex}`);
      const source = batch.sourceMap[window.messageIndex];
      const turnRow = turnsByRenderedId.get(source.turnId);
      assert.equal(row.renderedTurnId, source.turnId);
      assert.equal(window.content,
        batch.captureInput.messages[window.messageIndex].content.slice(window.start, window.end));
      const sourceTurn = input.history.sessions[turnRow.originalSessionIndex]
        .turns[turnRow.originalTurnIndex];
      const insideBody = window.start >= turnRow.bodyStart && window.end <= turnRow.bodyEnd;
      const rawStart = turnRow.normalizedStart + window.start - turnRow.bodyStart;
      const rawEnd = turnRow.normalizedStart + window.end - turnRow.bodyStart;
      const exactRaw = insideBody && !turnRow.normalizationChanged
        && sourceTurn.content.slice(rawStart, rawEnd) === window.content;
      const expected = !insideBody ? 'metadata-or-mixed'
        : exactRaw ? 'original-source' : 'normalized-source';
      observedClasses.add(expected);
      assert.equal(row.classification, expected);
      assert.equal(row.originalStartUtf16, exactRaw ? rawStart : null);
      assert.equal(row.originalEndUtf16, exactRaw ? rawEnd : null);
    }
  }
  assert.equal(mappedWindows, output.originMap.windows.length);
  assert.equal(mappedWindows, output.counts.windows);
  return observedClasses;
};

test('P1–P6 preserves source order, roles, same-minute cutoff, parity, origins and freeze', () => {
  const future = session('future', 0, '2023/10/16 (Mon) 00:00', [['user', 'Future poison.']]);
  const equal = session('equal', 1, '2023/10/15 (Sun) 17:53', [
    ['assistant', 'x'.repeat(1800)], ['user', 'Duplicate.']]);
  const earlier = session('earlier', 2, '2023/10/14 (Sat) 09:30', [['user', 'Duplicate.']]);
  const input = fixture([future, equal, earlier]);
  const before = clone(input);
  const output = prepareMixedSourceCase(input);
  assert.deepEqual(input, before);
  const classes = assertOriginEvidence(input, output);
  assert.ok(classes.has('original-source'));
  assert.ok(classes.has('metadata-or-mixed'));
  assertJsonData(output);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(output)));
  assert.deepEqual(output.counts, { originalSessions: 3, eligibleSessions: 2,
    excludedFutureSessions: 1, originalTurns: 4, renderedTurns: 3, batches: 2,
    windows: output.originMap.windows.length });
  assert.deepEqual(output.originMap.sessions.map((row) => row.originalSessionIndex), [1, 2]);
  assert.deepEqual(output.renderedHistory.sessions.map((row) => row.session_index), [0, 1]);
  assert.deepEqual(output.renderedHistory.sessions.map((row) => row.date),
    ['2023-10-15 17:53', '2023-10-14 09:30']);
  assert.deepEqual(output.mem0Input.batches,
    output.cairnPlan.batches.map((batch) => batch.captureInput.messages.map(({ role, content }) =>
      ({ role, content }))));
  assert.deepEqual(output.mem0Input.batches.flat().map((message) => message.role),
    ['assistant', 'user', 'user']);
  assert.equal(output.mem0Input.query, normalize(JSON.stringify({ question: input.question.text,
    date: '2023-10-15 17:53' })));
  assert.equal(JSON.stringify(output.mem0Input).includes('Future poison.'), false);
  for (const batch of output.cairnPlan.batches) {
    const actual = captureSnapshot(batch.captureInput, 'source-bound-v2', 'indexed-windows-v1');
    assert.deepEqual(actual.messages, batch.captureInput.messages);
  }
  const originalWindows = output.originMap.windows.filter((row) => row.classification === 'original-source');
  assert.ok(originalWindows.length >= 1);
  for (const row of originalWindows) {
    const turn = output.originMap.turns.find((entry) => entry.renderedTurnId === row.renderedTurnId);
    const original = input.history.sessions[turn.originalSessionIndex].turns[turn.originalTurnIndex].content;
    const window = output.cairnPlan.batches[row.batchIndex].indexedWindows[row.windowIndex];
    assert.equal(original.slice(row.originalStartUtf16, row.originalEndUtf16), window.content);
  }
  assert.ok(output.originMap.windows.some((row) => row.classification === 'metadata-or-mixed'
    && row.originalStartUtf16 === null));
  assert.equal(Object.isFrozen(output), true);
  assert.equal(Object.isFrozen(output.cairnPlan.batches[0].captureInput.messages[0]), true);
  assert.equal(Object.isFrozen(output.originMap.windows[0]), true);
  assert.equal(Object.hasOwn(output.mem0Input, 'sourceIds'), false);
  assert.equal(JSON.stringify(output).includes('answer_session_ids'), false);
});

test('P2 strict Gregorian dates, leap day and dataset-local floating clock', () => {
  const leap = fixture([session('leap', 0, '2024/02/29 (Thu) 12:00', [['user', 'Leap day.']])],
    '2024/02/29 (Thu) 12:00');
  const prior = process.env.TZ;
  try {
    process.env.TZ = 'Pacific/Honolulu';
    const first = prepareMixedSourceCase(leap);
    process.env.TZ = 'Asia/Tokyo';
    const second = prepareMixedSourceCase(leap);
    assert.equal(first.caseDigest, second.caseDigest);
    assert.equal(first.canonicalQuestionDate, '2024-02-29 12:00');
  } finally {
    if (prior === undefined) delete process.env.TZ;
    else process.env.TZ = prior;
  }
  for (const date of ['Tuesday', '2024-02-30 (Fri) 12:00', '2024/02/30 (Fri) 12:00',
    '2024/02/29 (Wed) 12:00', '2024/02/29 (Thu) 24:00', '2024/02/29 (Thu) 12:60',
    '1899/12/31 (Sun) 12:00', '2024-02-29', '2024/02/29 (Thu)']) {
    error({ ...leap, question: { ...leap.question, date } }, 'invalid_date');
  }
  const malformedFuture = fixture([session('bad', 0, 'future-ish', [['user', 'not eligible']]),
    session('good', 1, '2023/10/14 (Sat) 09:30', [['user', 'eligible']])]);
  error(malformedFuture, 'invalid_date');
  error(fixture([session('future-only', 0, '2023/10/16 (Mon) 00:00',
    [['user', 'later']])]), 'no_eligible_history');
});

test('P3 exact decorated 4000 boundary, astral, CJK and normalization inflation', () => {
  const date = '2023-10-14 09:30';
  const prefix = `[session-date: ${date}; clock: dataset-local] source{`;
  const maxBody = 4000 - prefix.length - 2;
  const body = 'x'.repeat(maxBody);
  const exact = prepareMixedSourceCase(fixture([session('exact', 0,
    '2023/10/14 (Sat) 09:30', [['user', body]])]));
  assert.equal(exact.renderedHistory.sessions[0].turns.length, 1);
  assert.equal(exact.renderedHistory.sessions[0].turns[0].content.length, 4000);
  const more = prepareMixedSourceCase(fixture([session('more', 0,
    '2023/10/14 (Sat) 09:30', [['assistant', body + '🧭漢字']])]));
  assert.equal(more.renderedHistory.sessions[0].turns.length, 2);
  assert.equal(more.renderedHistory.sessions[0].turns.map((turn) =>
    turn.content.slice(prefix.length, -2)).join(''), body + '🧭漢字');
  assert.ok(more.renderedHistory.sessions[0].turns.every((turn) => turn.content.length <= 4000));
  const crossing = prepareMixedSourceCase(fixture([session('crossing', 0,
    '2023/10/14 (Sat) 09:30', [['user', 'x'.repeat(maxBody - 1) + '🧭z']])]));
  assert.deepEqual(crossing.renderedHistory.sessions[0].turns.map((turn) =>
    turn.content.slice(prefix.length, -2)), ['x'.repeat(maxBody - 1), '🧭z']);
  const inflated = prepareMixedSourceCase(fixture([session('inflated', 0,
    '2023/10/14 (Sat) 09:30', [['user', 'ﬃ'.repeat(3000)]])]));
  assert.ok(inflated.renderedHistory.sessions[0].turns.length >= 3);
  assert.equal(inflated.renderedHistory.sessions[0].turns.map((turn) =>
    turn.content.slice(prefix.length, -2)).join(''), 'ffi'.repeat(3000));
  assert.ok(inflated.originMap.windows.some((row) => row.classification === 'normalized-source'));
});

test('P3 stable whole turn partitions a token at a new redaction boundary without loss', () => {
  const prefix = '[session-date: 2023-10-14 09:30; clock: dataset-local] source{';
  const maxBody = 4000 - prefix.length - 2;
  const source = 'a'.repeat(maxBody) + 'sk-' + 'A'.repeat(18);
  assert.equal(normalize(source), source);
  const input = fixture([session('boundary-token', 0, '2023/10/14 (Sat) 09:30',
    [['user', source]])]);
  const result = prepareMixedSourceCase(input);
  assertOriginEvidence(input, result);
  const bodies = result.renderedHistory.sessions[0].turns.map((turn) =>
    turn.content.slice(prefix.length, -2));
  assert.equal(bodies.length, 3);
  assert.equal(bodies[0], 'a'.repeat(maxBody));
  assert.equal(bodies[1], 'sk-' + 'A'.repeat(15));
  assert.equal(bodies[2], 'AAA');
  assert.equal(bodies.join(''), source);
});

test('P3 stable fixed-width token backs off an end boundary', () => {
  const prefix = '[session-date: 2023-10-14 09:30; clock: dataset-local] source{';
  const maxBody = 4000 - prefix.length - 2;
  const token = 'AKIA' + 'A'.repeat(16);
  const source = 'a'.repeat(maxBody - token.length - 1) + ' ' + token + 'x';
  assert.equal(normalize(source), source);
  const input = fixture([session('end-boundary-token', 0, '2023/10/14 (Sat) 09:30',
    [['assistant', source]])]);
  const result = prepareMixedSourceCase(input);
  assertOriginEvidence(input, result);
  assert.deepEqual(result.renderedHistory.sessions[0].turns.map((turn) =>
    turn.content.slice(prefix.length, -2)), [source.slice(0, maxBody - 1),
    source.slice(maxBody - 1)]);
});

test('P3 spaced metadata suffix preserves a stable short assignment', () => {
  const source = 'password: [REDACTED]';
  assert.equal(normalize(source), source);
  const input = fixture([session('short-assignment', 0, '2023/10/14 (Sat) 09:30',
    [['user', source]])]);
  const result = prepareMixedSourceCase(input);
  assertOriginEvidence(input, result);
  assert.equal(result.renderedHistory.sessions[0].turns.length, 1);
  assert.ok(result.renderedHistory.sessions[0].turns[0].content.endsWith(`${source} }`));
});

test('P3 greedy partition backs off an internal space and preserves it in the next body', () => {
  const prefix = '[session-date: 2023-10-14 09:30; clock: dataset-local] source{';
  const maxBody = 4000 - prefix.length - 2;
  const source = 'a'.repeat(maxBody - 1) + ' b';
  const input = fixture([session('space-boundary', 0, '2023/10/14 (Sat) 09:30',
    [['user', source]])]);
  const result = prepareMixedSourceCase(input);
  assertOriginEvidence(input, result);
  assert.deepEqual(result.renderedHistory.sessions[0].turns.map((turn) =>
    turn.content.slice(prefix.length, -2)), ['a'.repeat(maxBody - 1), ' b']);
});

test('P3–P5 metadata is not source, normalization is disclosed, duplicate text remains distinct', () => {
  const secret = 'sk-' + 'A'.repeat(18);
  const changed = 'Ｆｕｌｌｗｉｄｔｈ e\u0301   ' + secret + ' ' + 'q'.repeat(1700);
  const input = fixture([session('changed', 0, '2023/10/14 (Sat) 09:30', [
    ['user', changed], ['assistant', 'source{ answer: "violet" }'],
    ['user', 'same'], ['assistant', 'same']])]);
  const output = prepareMixedSourceCase(input);
  const classes = assertOriginEvidence(input, output);
  assert.ok(classes.has('normalized-source'));
  assert.ok(output.originMap.windows.some((row) => row.classification === 'normalized-source'
    && row.originalStartUtf16 === null));
  assert.equal(JSON.stringify(output.mem0Input).includes(secret), false);
  assert.equal(output.originMap.turns[2].originalTurnId === output.originMap.turns[3].originalTurnId, false);
  assert.equal(output.originMap.turns[2].renderedTurnId === output.originMap.turns[3].renderedTurnId, false);
  assert.equal(output.mem0Input.batches.flat().some((message) => message.role === 'system'), false);
  assert.ok(output.mem0Input.batches.flat().some((message) => message.content.includes('answer: "violet"')));
  assert.equal(Object.hasOwn(output, 'answer'), false);
});

test('P6 canonical digests bind original and rendered data but ignore object key order', () => {
  const input = fixture();
  const first = prepareMixedSourceCase(input);
  const reordered = { namespace: { projectId: caseId, scope: 'project', ownerId: input.namespace.ownerId },
    question: { date: input.question.date, text: input.question.text, question_id: caseId },
    history: { sessions: input.history.sessions.map((item) => ({
      turns: item.turns.map((turn) => ({ content: turn.content, role: turn.role, turn_id: turn.turn_id })),
      date: item.date, session_id: item.session_id, session_index: item.session_index })),
    question_id: caseId } };
  const second = prepareMixedSourceCase(reordered);
  assert.equal(first.caseDigest, second.caseDigest);
  assert.equal(first.originalHistoryDigest, second.originalHistoryDigest);
  assert.equal(mixedSourcePolicy(), first.policy);
  assert.equal(Object.isFrozen(first.policy.date), true);
  assert.equal(first.version, 'cairn-lme-mixed-source-v2');
  assert.equal(first.policy.rendering.suffix, ' }');
  assert.equal(first.policy.limits.partitionProbeUtf16, 32 * 1024 * 1024);
  assert.ok(Object.values(first.policy.hashDomains).every((domain) => domain.endsWith('.v2')));
  const altered = clone(input);
  altered.history.sessions[0].turns[0].content += '!';
  assert.notEqual(prepareMixedSourceCase(altered).caseDigest, first.caseDigest);
  const excluded = clone(input);
  excluded.history.sessions.push(session('future', 2, '2023/10/16 (Mon) 00:00', [['user', 'future']]));
  assert.notEqual(prepareMixedSourceCase(excluded).caseDigest, first.caseDigest);
});

test('P1/P8 invalid own data and bounded inputs fail without getter invocation or mutation', () => {
  const original = fixture();
  let reads = 0;
  const getter = clone(original);
  Object.defineProperty(getter.question, 'text', { enumerable: true, get() { reads++; return 'poison'; } });
  error(getter, 'invalid_input');
  assert.equal(reads, 0);
  const invalids = [
    { ...clone(original), unexpected: true },
    { ...clone(original), question: { ...original.question, text: '\ud800' } },
    { ...clone(original), question: { ...original.question, text: 'bad\0text' } },
    { ...clone(original), namespace: { ...original.namespace, projectId: id('case', 'other') } },
    { ...clone(original), history: { ...original.history, question_id: id('case', 'other') } },
    { ...clone(original), history: { ...original.history,
      sessions: [clone(original.history.sessions[0]), clone(original.history.sessions[0])] } },
    { ...clone(original), history: { ...original.history, sessions: [
      { ...clone(original.history.sessions[0]), turns: [
        clone(original.history.sessions[0].turns[0]), clone(original.history.sessions[0].turns[0])] }] } },
    { ...clone(original), question: { ...original.question, text: 'x'.repeat(8 * 1024 * 1024) } },
  ];
  for (const item of invalids) assert.throws(() => prepareMixedSourceCase(item), MixedSourceErrorLike);
  const symbol = clone(original); symbol[Symbol('extra')] = true;
  error(symbol, 'invalid_input');
  const sparse = clone(original); sparse.history.sessions = new Array(2);
  error(sparse, 'invalid_input');
  const cyclic = clone(original); cyclic.extra = cyclic;
  error(cyclic, 'invalid_input');
  const nonplain = clone(original); Object.setPrototypeOf(nonplain.question, new Date());
  error(nonplain, 'invalid_input');
});

const MixedSourceErrorLike = { name: 'MixedSourceError' };

test('P1 rejects an over-wide plain object before reading its property descriptors', () => {
  const keys = Array.from({ length: 200_001 }, (_, index) => `k${index}`);
  let ownKeyReads = 0, descriptorReads = 0;
  const wide = new Proxy({}, { ownKeys() { ownKeyReads++; return keys; },
    getOwnPropertyDescriptor() {
      descriptorReads++;
      return { value: 1, writable: true, enumerable: true, configurable: true };
    } });
  error({ history: null, question: wide, namespace: null }, 'input_limit_exceeded');
  assert.equal(ownKeyReads, 1);
  assert.equal(descriptorReads, 0);
});

test('P1 rejects extra array own keys before descriptors or getters run', () => {
  const input = fixture();
  let getterReads = 0, ownKeyReads = 0, descriptorReads = 0;
  Object.defineProperty(input.history.sessions, 'extra', { enumerable: true,
    get() { getterReads++; return 'never read'; } });
  input.history.sessions = new Proxy(input.history.sessions, {
    ownKeys(target) { ownKeyReads++; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) {
      descriptorReads++;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  error(input, 'invalid_input');
  assert.equal(ownKeyReads, 1);
  assert.equal(descriptorReads, 0);
  assert.equal(getterReads, 0);
});

test('P8 empty/redacted source and malformed namespace/roles refuse, never trim', () => {
  const fullyRedacted = fixture([session('redacted', 0, '2023/10/14 (Sat) 09:30',
    [['user', 'sk-' + 'A'.repeat(18)]])]);
  error(fullyRedacted, 'invalid_normalization');
  const whitespace = fixture([session('space', 0, '2023/10/14 (Sat) 09:30',
    [['user', ' \t  ']])]);
  error(whitespace, 'invalid_history');
  const role = fixture(); role.history.sessions[0].turns[0].role = 'system';
  error(role, 'invalid_history');
  const namespace = fixture(); namespace.namespace.scope = 'personal';
  error(namespace, 'invalid_namespace');
});

test('P1/P4/P8 bound query, traversal and rendered normalization inflation before planning', () => {
  const query = fixture(); query.question.text = 'q'.repeat(4_000);
  error(query, 'invalid_query');
  const nested = fixture();
  nested.question.text = { end: 'x' };
  for (let index = 0; index < 18; index++) nested.question.text = { next: nested.question.text };
  error(nested, 'input_limit_exceeded');
  const nodes = fixture(); nodes.question.text = Array.from({ length: 200_000 }, () => 0);
  error(nodes, 'input_limit_exceeded');
  const inflated = fixture([session('huge-inflation', 0, '2023/10/14 (Sat) 09:30',
    [['user', '\uFDFA'.repeat(300_000)]])]);
  error(inflated, 'render_limit_exceeded');
});

test('P3/P8 adversarial stable turns exhaust the finite partition probe budget explicitly', () => {
  const prefix = '[session-date: 2023-10-14 09:30; clock: dataset-local] source{';
  const maxBody = 4000 - prefix.length - 2;
  const trap = 'a'.repeat(maxBody) + 'sk-' + 'A'.repeat(18) + 'a'.repeat(maxBody);
  assert.equal(normalize(trap), trap);
  const turns = Array.from({ length: 6 }, () => ['user', trap]);
  const input = fixture([session('probe-cap', 0, '2023/10/14 (Sat) 09:30', turns)]);
  error(input, 'render_probe_limit_exceeded');
});

test('P1/P8 reject nonenumerable fields, sparse turns and excluded invalid source', () => {
  const hidden = fixture();
  Object.defineProperty(hidden.history.sessions[0], 'hidden', { value: true });
  error(hidden, 'invalid_input');
  const sparse = fixture(); sparse.history.sessions[0].turns = new Array(1);
  error(sparse, 'invalid_input');
  const excluded = fixture([session('future-secret', 0, '2023/10/16 (Mon) 00:00',
    [['user', 'sk-' + 'A'.repeat(18)]]),
  session('eligible', 1, '2023/10/14 (Sat) 09:30', [['user', 'safe']])]);
  error(excluded, 'invalid_normalization');
});

test('P1/P8 reject malformed opaque IDs, negative-zero and discontinuous indices, and session cap', () => {
  const invalidCase = fixture(); invalidCase.history.question_id = 'case-readable';
  error(invalidCase, 'invalid_question');
  const invalidSession = fixture(); invalidSession.history.sessions[0].session_id = 'session-readable';
  error(invalidSession, 'invalid_history');
  const invalidTurn = fixture(); invalidTurn.history.sessions[0].turns[0].turn_id = 'turn-readable';
  error(invalidTurn, 'invalid_history');
  const negativeZero = fixture(); negativeZero.history.sessions[0].session_index = -0;
  error(negativeZero, 'invalid_history');
  const discontinuous = fixture(); discontinuous.history.sessions[1].session_index = 2;
  error(discontinuous, 'invalid_history');
  const tooManySessions = fixture();
  tooManySessions.history.sessions = Array(2501).fill(tooManySessions.history.sessions[0]);
  error(tooManySessions, 'invalid_history');
});
