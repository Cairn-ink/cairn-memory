import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_PLAN_QA_VERSION, cardPlanQaRoster, cardPlanQaLimits,
  validateCardPlanQaCases } from '../card-plan-profile.mjs';

test('card-plan roster has all 24 fixed source cases', () => {
  assert.equal(CARD_PLAN_QA_VERSION, 'card-plan-qa24-v1');
  assert.deepEqual(cardPlanQaRoster,
    Array.from({ length: 24 }, (_, i) => `CQ${String(i + 1).padStart(2, '0')}`));
  assert.equal(Object.isFrozen(cardPlanQaRoster), true);
});

test('card-plan budgets preserve the bounded offline contract', () => {
  assert.equal(cardPlanQaLimits.inputTokens, 6000);
  assert.equal(cardPlanQaLimits.providerInputTokens, 7024);
  assert.equal(cardPlanQaLimits.rankOutputTokens, 1024);
  assert.equal(cardPlanQaLimits.answerOutputTokens, 512);
  assert.equal(Object.isFrozen(cardPlanQaLimits), true);
});

test('card-plan rejects caller getters and proxies without running hooks', () => {
  let calls = 0;
  const getter = Object.defineProperty({}, 'id', {
    enumerable: true, get() { calls++; return 'CQ01'; },
  });
  const proxy = new Proxy({}, {
    ownKeys() { calls++; return []; },
    getPrototypeOf() { calls++; return Object.prototype; },
    getOwnPropertyDescriptor() { calls++; return undefined; },
  });
  for (const value of [getter, proxy, [getter], [proxy]])
    assert.throws(() => validateCardPlanQaCases(value), TypeError);
  assert.equal(calls, 0);
});

import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { loadCardPlanQaCases, prepareCardPlanQaCase } from '../card-plan-profile.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const SOURCE_URL = new URL('../card-plan-cases.json', import.meta.url);
const RUBRIC_URL = new URL('../card-plan-rubric.json', import.meta.url);
const rawBytes = await readFile(SOURCE_URL);
const rawCases = JSON.parse(rawBytes.toString('utf8'));
const rubricBytes = await readFile(RUBRIC_URL);
const rubric = JSON.parse(rubricBytes.toString('utf8'));
const sha = x => createHash('sha256').update(x).digest('hex');
const families = ['prerequisite-chain', 'evolving-decision', 'scope-exception',
  'proposal-quotation', 'entity-link', 'compositional-set'];
const sizes = [3,4,5,6,3,4,4,5,6,3,4,5,5,6,3,4,5,6,1,2,3,4,5,6];
const rubricFields = ['id', 'answerability', 'expectedProposition',
  'acceptableQualifiedAnswer', 'unanswerabilityReason', 'factualClaims', 'anchors',
  'requiredEvidenceSets', 'unsupportedConclusions', 'staleUse', 'severeConditions',
  'provenance', 'ambiguity', 'optionalContextClaims'];
const exact = (value, fields) => assert.deepEqual(Object.keys(value).sort(), [...fields].sort());
const nonempty = s => { assert.equal(typeof s, 'string'); assert.ok(s.length > 0); };
const clone = () => structuredClone(rawCases);

test('card-plan independently audits all source rows and exact rubric anchors', () => {
  exact(rubric, ['version', 'cases']);
  assert.equal(rubric.version, 'card-plan-qa24-rubric-v1');
  assert.equal(rawCases.length, 24); assert.equal(rubric.cases.length, 24);
  let cards = 0, anchorCount = 0;
  for (const [i, c] of rawCases.entries()) {
    const id = `CQ${String(i + 1).padStart(2, '0')}`;
    exact(c, ['id', 'family', 'question', 'sessions']);
    assert.equal(c.id, id); assert.equal(c.family, families[i % 6]);
    exact(c.question, ['text', 'date']);
    assert.ok(c.question.text.length >= 1 && c.question.text.length <= 400);
    assert.match(c.question.date, /^\d{4}-\d{2}-\d{2}$/u);
    assert.equal(new Date(c.question.date).toISOString().slice(0, 10), c.question.date);
    assert.equal(c.sessions.length, 12);
    let previous = '';
    for (const [j, s] of c.sessions.entries()) {
      cards++;
      exact(s, ['id', 'eventTime', 'messages']);
      assert.equal(s.id, `${id}-S${String(j + 1).padStart(2, '0')}`);
      assert.equal(new Date(s.eventTime).toISOString(), s.eventTime);
      assert.ok(s.eventTime > previous);
      assert.ok(s.eventTime.slice(0, 10) <= c.question.date); previous = s.eventTime;
      assert.equal(s.messages.length, 1);
      const m = s.messages[0]; exact(m, ['role', 'content']);
      assert.ok(['user', 'assistant'].includes(m.role));
      assert.ok(m.content.length >= 40 && m.content.length <= 360);
      assert.equal(m.content.isWellFormed(), true);
      assert.doesNotMatch(m.content, /[\p{Cc}\p{Cf}]/u);
      assert.doesNotMatch(m.content, /CQ\d\d|gold|evaluator|required evidence/iu);
    }
    assert.equal(new Set(c.sessions.map(s => s.messages[0].content)).size, 12);
    const r = rubric.cases[i]; exact(r, rubricFields); assert.equal(r.id, id);
    assert.equal(r.answerability, i < 18 ? 'answerable' : 'qualified');
    if (i < 18) assert.equal(r.unanswerabilityReason, null);
    else nonempty(r.unanswerabilityReason);
    for (const field of ['expectedProposition', 'acceptableQualifiedAnswer',
      'staleUse', 'provenance', 'ambiguity']) nonempty(r[field]);
    for (const field of ['factualClaims', 'unsupportedConclusions', 'severeConditions']) {
      assert.ok(r[field].length > 0); r[field].forEach(nonempty);
    }
    assert.ok(r.severeConditions.length <= 8);
    const anchors = new Map();
    for (const a of r.anchors) {
      anchorCount++; exact(a, ['id', 'sessionId', 'messageIndex', 'start', 'end', 'text']);
      assert.equal(anchors.has(a.id), false); assert.equal(a.messageIndex, 0);
      const s = c.sessions.find(s => s.id === a.sessionId); assert.ok(s);
      assert.ok(Number.isSafeInteger(a.start) && a.start >= 0);
      assert.ok(Number.isSafeInteger(a.end) && a.end > a.start && a.end <= s.messages[0].content.length);
      // Literal raw JSON text is the oracle; no production anchor helper.
      assert.equal(s.messages[0].content.slice(a.start, a.end), a.text); nonempty(a.text);
      anchors.set(a.id, a);
    }
    assert.ok(r.requiredEvidenceSets.length > 0);
    for (const set of r.requiredEvidenceSets) {
      exact(set, ['name', 'anchorIds']); nonempty(set.name);
      assert.equal(new Set(set.anchorIds).size, set.anchorIds.length);
      assert.ok(set.anchorIds.every(a => anchors.has(a)));
      assert.equal(new Set(set.anchorIds.map(a => anchors.get(a).sessionId)).size, sizes[i]);
      assert.equal(set.anchorIds.length, sizes[i]);
      const positions = set.anchorIds.map(a => Number(anchors.get(a).sessionId.slice(-2))).sort((a,b)=>a-b);
      assert.notDeepEqual(positions, Array.from({ length: sizes[i] }, (_,j)=>j+1));
    }
    for (const optional of r.optionalContextClaims) {
      exact(optional, ['claim', 'anchorIds']); nonempty(optional.claim);
      assert.ok(optional.anchorIds.length > 0);
      assert.equal(new Set(optional.anchorIds).size, optional.anchorIds.length);
      assert.ok(optional.anchorIds.every(a => anchors.has(a)));
    }
  }
  assert.equal(cards, 288); assert.equal(anchorCount, 102);
});

test('card-plan binds raw and validated-value hashes and returns detached frozen data', async () => {
  assert.equal(sha(rawBytes), '9a426a536efd97c8b61a7aed9890a399f7e6f8cb72758cc2c1fbc2c78605a48f');
  assert.equal(sha(JSON.stringify(rawCases)), '09ecd9710ea980d8ac228ad55858e4a757de4dc006eb8451a30707142b102cb5');
  assert.equal(sha(rubricBytes), 'c0aea913f90bd8437a455f5d9048dfd26364120b15822dccd0ff452ed4447d8c');
  assert.equal(sha(JSON.stringify(rubric)), '58ba116268bac50ce69bd8ca4598a31e1c3bcd9eaa6836345c86da6845f840c8');
  const input = clone(), validated = validateCardPlanQaCases(input);
  input[0].sessions[0].messages[0].content = 'A changed caller string should not alter the frozen detached snapshot.';
  assert.equal(validated[0].sessions[0].messages[0].content, rawCases[0].sessions[0].messages[0].content);
  function frozen(value) {
    if (value && typeof value === 'object') {
      assert.equal(Object.isFrozen(value), true); Object.values(value).forEach(frozen);
    }
  }
  frozen(validated);
  const loaded = await loadCardPlanQaCases();
  assert.equal(JSON.stringify(loaded), JSON.stringify(rawCases)); frozen(loaded);
});

test('card-plan rejects shape, text, roster, calendar and chronology drift', () => {
  const mutations = [
    x => x.pop(),
    x => x[0].id = 'CQ99',
    x => x[0].family = 'scope-exception',
    x => x[0].gold = 'forbidden extra field',
    x => x[0].question.extra = 'field',
    x => x[0].question.text = '',
    x => x[0].question.text = 'q'.repeat(401),
    x => x[0].question.date = '2026-02-30',
    x => x[0].sessions.pop(),
    x => x[0].sessions[0].id = 'arbitrary-session',
    x => x[0].sessions[1].eventTime = x[0].sessions[0].eventTime,
    x => x[0].sessions[0].eventTime = '2026-03-01T08:01:00.000Z',
    x => x[0].sessions[0].eventTime = '2026-02-01T25:00:00.000Z',
    x => x[0].sessions[0].messages.push({role:'user',content:'A second message is outside the one-message-per-card corpus shape.'}),
    x => x[0].sessions[0].messages[0].role = 'system',
    x => x[0].sessions[0].messages[0].content = 'short',
    x => x[0].sessions[0].messages[0].content = 'x'.repeat(361),
    x => x[0].sessions[0].messages[0].content = 'A harmless-looking sentence with an invalid Unicode tail.\ud800',
    x => x[0].sessions[0].messages[0].content = 'A harmless-looking sentence with an embedded control.\u0000',
    x => x[0].sessions[0].messages[0].content = ' A harmless-looking sentence with a leading space before the text.',
  ];
  for (const mutate of mutations) { const value = clone(); mutate(value);
    assert.throws(() => validateCardPlanQaCases(value), TypeError); }
});

test('card-plan rejects hooks, inherited hooks, prototypes, cycles and sparse bounds without side effects', () => {
  let calls = 0;
  const values = [];
  const ownHook = clone(); ownHook[0].toJSON = () => { calls++; return {}; }; values.push(ownHook);
  const hidden = clone(); Object.defineProperty(hidden[0], 'hidden', { value: 'x' }); values.push(hidden);
  const custom = clone(); Object.setPrototypeOf(custom[0], { toJSON() { calls++; return {}; } }); values.push(custom);
  const getter = clone(); Object.defineProperty(getter[0].question, 'text', {
    enumerable:true, get() { calls++; return 'hook'; } }); values.push(getter);
  const proxy = clone(); proxy[0] = new Proxy(proxy[0], {
    getPrototypeOf() { calls++; return Object.prototype; },
    ownKeys() { calls++; return []; }, getOwnPropertyDescriptor() { calls++; return undefined; },
  }); values.push(proxy);
  const cycle = clone(); cycle[0].question = cycle; values.push(cycle);
  const sparse = clone(); delete sparse[0]; values.push(sparse);
  const arrayExtra = clone(); arrayExtra.note = 'extra'; values.push(arrayExtra);
  values.push(new Array(4097), ['x'.repeat(262145)]);
  const deep = []; let cursor = deep; for (let i=0; i<10; i++) { const next=[]; cursor.push(next); cursor=next; }
  values.push(deep);
  for (const value of values) assert.throws(() => validateCardPlanQaCases(value), TypeError);
  assert.equal(calls, 0);
  for (const prototype of [Object.prototype, Array.prototype]) {
    const old = Object.getOwnPropertyDescriptor(prototype, 'toJSON');
    try {
      Object.defineProperty(prototype, 'toJSON', { configurable:true, get() { calls++; return () => {}; } });
      assert.throws(() => validateCardPlanQaCases(clone()), TypeError);
    } finally {
      if (old) Object.defineProperty(prototype, 'toJSON', old); else delete prototype.toJSON;
    }
  }
  assert.equal(calls, 0);
});

test('card-plan loader owns success and failure scratch and rejects raw/value drift', async t => {
  const outer = createTestWorkspace(t, { prefix:'card-plan-corpus-parent-' });
  for (const body of [rawBytes, Buffer.concat([rawBytes, Buffer.from(' ')]),
    Buffer.alloc(262145, 32), Buffer.from(JSON.stringify(clone().slice(1)))]) {
    const workspace = createTestWorkspace(null, { prefix:'card-plan-corpus-load-', parent:outer.path });
    const file = join(workspace.path, 'cases.json');
    try {
      await writeFile(file, body);
      if (body === rawBytes) assert.equal((await loadCardPlanQaCases(file)).length, 24);
      else await assert.rejects(loadCardPlanQaCases(file), /card_plan_(?:hash_drift|limit)/u);
    } finally { await workspace.cleanup(); }
    await assert.rejects(access(workspace.path), {code:'ENOENT'});
    assert.deepEqual(await readdir(outer.path), []);
  }
  const changed = clone(); changed[0].question.text += ' Please clarify.';
  await assert.rejects(prepareCardPlanQaCase(changed, 'CQ01'), /card_plan_hash_drift/u);
  await assert.rejects(prepareCardPlanQaCase(rawCases, 'CQ99'), /invalid_card_plan_case/u);
});

test('card-plan all 24 pure preparations preserve source spans and exclude evaluator metadata', async () => {
  const cases = await loadCardPlanQaCases();
  const forbiddenKeys = new Set(['family', 'answerability', 'expectedProposition',
    'acceptableQualifiedAnswer', 'unanswerabilityReason', 'factualClaims',
    'anchors', 'requiredEvidenceSets', 'unsupportedConclusions', 'severeConditions',
    'staleUse', 'provenance', 'ambiguity', 'optionalContextClaims', 'gold', 'rubric']);
  function noMetadata(value) {
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false); noMetadata(child);
    }
  }
  for (const c of cases) {
    const prepared = await prepareCardPlanQaCase(cases, c.id), plan = prepared.plan;
    exact(prepared, ['version', 'id', 'plan', 'question', 'sourceProvenance']);
    assert.equal(prepared.version, 'card-plan-qa24-v1'); assert.equal(prepared.id, c.id);
    assert.equal(prepared.question.text, c.question.text);
    assert.equal(prepared.question.date, `${c.question.date} 23:59`);
    assert.equal(plan.originalQuestion.question_id, `lme-case-${sha(`card-plan-qa24-v1:${c.id}`)}`);
    assert.deepEqual(JSON.parse(plan.mem0Input.query), {question:c.question.text,date:`${c.question.date} 23:59`});
    assert.equal(plan.counts.windows, 12); assert.equal(plan.counts.renderedTurns, 12);
    assert.equal(plan.counts.batches, 12); assert.equal(plan.counts.excludedFutureSessions, 0);
    assert.equal(plan.cairnPlan.batches.length, 12); assert.equal(plan.originMap.turns.length, 12);
    for (const [j, source] of c.sessions.entries()) {
      const batch = plan.cairnPlan.batches[j], origin = plan.originMap.turns[j];
      const provenance = prepared.sourceProvenance[j];
      assert.equal(batch.captureInput.namespace.ownerId, 'card-plan-offline-owner');
      assert.equal(batch.captureInput.messages.length, 1);
      assert.equal(batch.indexedWindows.length, 1);
      const message = batch.captureInput.messages[0], window = batch.indexedWindows[0];
      const normalized = source.messages[0].content.normalize('NFKC').replace(/\s+/gu, ' ').trim();
      const expected = `[session-date: ${source.eventTime.slice(0,10)} ${source.eventTime.slice(11,16)}; clock: dataset-local] source{${normalized} }`;
      assert.equal(message.role, source.messages[0].role); assert.equal(message.content, expected);
      assert.equal(window.content, message.content.slice(window.start, window.end));
      assert.equal(window.content, expected); assert.ok(window.content.length <= 800);
      assert.equal(origin.normalizedStart, 0); assert.equal(origin.normalizedEnd, normalized.length);
      assert.equal(message.content.slice(origin.bodyStart, origin.bodyEnd), normalized);
      assert.equal(origin.normalizationChanged, false);
      assert.equal(provenance.originalSessionId, source.id); assert.equal(provenance.eventTime, source.eventTime);
      assert.equal(provenance.role, source.messages[0].role); assert.equal(provenance.originalMessageIndex, 0);
      assert.equal(provenance.renderedSessionId, `lme-session-${sha(source.id)}`);
      assert.equal(provenance.renderedTurnId, plan.renderedHistory.sessions[j].turns[0].turn_id);
      assert.match(provenance.renderedTurnId, /^lme-turn-[a-f0-9]{64}$/u);
      assert.equal(batch.sourceMap[0].rawContent, expected);
      assert.equal(batch.sourceMap[0].rawStartUtf16, 0);
      assert.equal(batch.sourceMap[0].rawEndUtf16, expected.length);
      noMetadata(batch.captureInput); noMetadata(batch.indexedWindows);
      assert.doesNotMatch(JSON.stringify({capture:batch.captureInput,windows:batch.indexedWindows}),
        /CQ\d\d|gold|evaluator|requiredEvidenceSets|card-plan-qa24-rubric|prerequisite-chain|evolving-decision|scope-exception|proposal-quotation|entity-link|compositional-set/u);
    }
    noMetadata(plan.mem0Input);
    assert.doesNotMatch(plan.mem0Input.query, /CQ\d\d|gold|rubric|family/u);
  }
});

