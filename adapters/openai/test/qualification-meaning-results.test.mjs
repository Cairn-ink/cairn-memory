import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fixtures, fixtureSha256 } from '../../../evaluation/qualification-meaning/fixtures.mjs';
import { captureSnapshot, retainedSourceView, extractedItems } from '../../../core/capture-input.mjs';
import { callModel } from '../../../core/model-call.mjs';
import { qualifyCandidateItems } from '../../../core/qualification-candidates.mjs';
import { createOpenAIModel } from '../index.mjs';

const read = name => readFileSync(new URL('../../../' + name, import.meta.url), 'utf8');
const result = JSON.parse(read('evaluation/qualification-meaning/results.json'));
const dimensions = ['supportedMeaning', 'uncertaintyPreserved', 'attributionPreserved',
  'scopeTimePreserved', 'usefulCoverage', 'evidenceEntails'];
const hash = text => createHash('sha256').update(text).digest('hex');
const documentHash = value => hash(JSON.stringify(value, null, 2) + '\n');
const keys = (value, allowed) => assert.deepEqual(Object.keys(value).sort(), [...allowed].sort());
const sameIds = (rows, expected) => {
  assert.equal(new Set(rows.map(r => r.id)).size, expected.length);
  assert.deepEqual(rows.map(r => r.id).sort(), [...expected].sort());
};
const scores = (attempts, ratings) => {
  const joined = attempts.map(a => ratings.find(r => r.id === a.blindId));
  return { denominator: attempts.length, mechanicalCompletion: attempts.filter(a => a.status === 'completed').length,
    fullSuccess: joined.filter(r => r.fullSuccess).length,
    dimensions: Object.fromEntries(dimensions.map(d => [d, joined.filter(r => r[d] === true).length])),
    unsupportedAssertionAttempts: joined.filter(r => r.unsupportedAssertions.length).length,
    omissionAttempts: joined.filter(r => r.omissions.length).length };
};

// Closed shapes, including objects nested inside the retained model input text.
// No denylist-only pass: unknown fields fail even when their names look harmless.
function privacy(data) {
  keys(data, ['schemaVersion', 'reportedDate', 'model', 'fixtureDenominator', 'repetitions', 'attemptDenominator',
    'decision', 'provenance', 'attempts', 'blind', 'mapping', 'raterA', 'raterB', 'adjudication',
    'disagreements', 'agreement', 'aggregates', 'perCase', 'resources', 'campaignAggregates']);
  keys(data.provenance, ['candidateSha', 'fixtureSha256', 'frozenFiles', 'originalInputSha256',
    'sourceNormalization', 'raters', 'adjudicationFrozenBeforeAggregatesAndMapping']);
  keys(data.provenance.frozenFiles, Object.keys(result.provenance.frozenFiles));
  keys(data.provenance.originalInputSha256, ['result', 'terminal', 'blind', 'blind-mapping', 'rater-a', 'rater-b', 'adjudication']);
  for (const rater of data.provenance.raters) keys(rater, ['id', 'model', 'effort', 'calibratedBeforeOutputs']);
  const cardShape = (card, confidence) => {
    keys(card, ['content', 'kind', 'receipts', 'qualification', ...(confidence ? ['confidence'] : [])]);
    for (const receipt of card.receipts) keys(receipt, ['sourceIndex', 'role', 'excerpt']);
    keys(card.qualification, ['version', 'slot', 'value', 'attribution', 'commitment', 'anchors']);
    keys(card.qualification.slot, ['subject', 'property', 'scope', 'applies']);
    for (const anchor of card.qualification.anchors) keys(anchor, ['receiptIndex', 'start', 'end', 'text', 'fields']);
  };
  for (const a of data.attempts) {
    keys(a, ['id', 'repetition', 'arm', 'status', 'reason', 'failureStage', 'latencyMs', 'blindId', 'compiledCards', 'records']);
    a.compiledCards.forEach(c => cardShape(c, true));
    for (const r of a.records) {
      keys(r, ['method', 'endpoint', 'httpStatus', 'reservedMicroUsd', 'actualMicroUsd', 'usage', 'outcome',
        'failure', 'responseTruncated', 'latencyMs', 'inputText', 'outputText', 'outputStatus', 'countedInputTokens']);
      if (r.usage) keys(r.usage, ['input_tokens', 'output_tokens', 'total_tokens']);
      const input = JSON.parse(r.inputText);
      if (r.method === 'extract') {
        keys(input, ['messages']);
        input.messages.forEach(m => keys(m, ['index', 'role', 'content']));
      } else {
        keys(input, ['items']);
        for (const item of input.items) {
          keys(item, ['itemIndex', 'content', 'kind', 'candidates']);
          item.candidates.forEach(c => keys(c, ['candidateIndex', 'role', 'text']));
        }
      }
      if (r.outputText !== null) {
        const output = JSON.parse(r.outputText);
        if (r.method === 'extract') {
          keys(output, ['items']);
          output.items.forEach(i => keys(i, ['content', 'kind', 'confidence', 'sourceIndices']));
        } else {
          keys(output, ['wireVersion', 'qualifications']);
          keys(output.qualifications, input.items.map(i => `item_${i.itemIndex}`));
          for (const entry of Object.values(output.qualifications)) {
            const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
            keys(entry, ['itemIndex', 'pool', ...fields]);
            fields.forEach(f => keys(entry[f], ['value', 'evidenceSlots']));
          }
        }
      }
    }
  }
  keys(data.blind, ['projectionNotes', 'rubric', 'rows']);
  for (const row of data.blind.rows) {
    keys(row, ['id', 'scenarioId', 'mechanicalCompletion', 'sources', 'cards']);
    row.sources.forEach(s => keys(s, ['sourceIndex', 'role', 'text']));
    row.cards.forEach(c => cardShape(c, false));
  }
  keys(data.mapping, ['mapping']);
  data.mapping.mapping.forEach(m => keys(m, ['id', 'scenarioId', 'arm', 'repetition']));
  for (const name of ['raterA', 'raterB']) keys(data[name], ['rater', 'ratings']);
  keys(data.adjudication, ['schemaVersion', 'policy', 'rawRatingsSha256', 'blindSha256', 'decisions', 'ratings']);
  keys(data.adjudication.rawRatingsSha256, ['a', 'b']);
  data.adjudication.decisions.forEach(d => keys(d, ['id', 'dimensions', 'resolution', 'reason']));
  for (const ratings of [data.raterA.ratings, data.raterB.ratings, data.adjudication.ratings]) {
    for (const r of ratings) keys(r, ['id', ...dimensions, 'fullSuccess', 'unsupportedAssertions', 'omissions', 'notes']);
  }
  data.disagreements.forEach(d => keys(d, ['id', 'dimensions']));
  keys(data.agreement, ['rows', 'fullyAgreeingRows', 'disagreeingRows', 'dimensionComparisons', 'agreeingDimensions', 'disagreeingDimensions']);
  const scoreShape = s => { keys(s, ['denominator', 'mechanicalCompletion', 'fullSuccess', 'dimensions',
    'unsupportedAssertionAttempts', 'omissionAttempts']); keys(s.dimensions, dimensions); };
  keys(data.aggregates, ['adjudicated', 'rawRaterA', 'rawRaterB']);
  Object.values(data.aggregates).forEach(scoreShape);
  data.perCase.forEach(c => { keys(c, ['id', 'adjudicated', 'rawRaterA', 'rawRaterB']);
    ['adjudicated', 'rawRaterA', 'rawRaterB'].forEach(k => scoreShape(c[k])); });
  keys(data.resources, ['httpRequests', 'generations', 'cards', 'inputTokens', 'outputTokens',
    'knownUsageUncachedCeilingMicroUsd', 'reservedMicroUsd', 'unknownCostCountRequests',
    'medianInstrumentedAttemptLatencyMs', 'totalInstrumentedAttemptLatencyMs', 'totalGuardedHttpLatencyMs', 'instrumentedRunLatencyMs']);
  keys(data.campaignAggregates, ['initialRequestCount', 'finalRequestCount', 'initialReservedMicroUsd', 'newReservedMicroUsd',
    'finalReservedMicroUsd', 'remainingMicroUsd', 'pendingAttempts', 'limitMicroUsd']);
  const visit = value => {
    if (typeof value === 'string') assert.ok(!/\b(?:resp_|msg_)[a-z0-9]+|\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b|\/tmp\/|\/home\/|\bsk-[A-Za-z0-9]+/.test(value), 'private identifier/path');
    if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(data);
}

function integrity(data) {
  assert.equal(data.schemaVersion, 'qualification-meaning-public-results-v1');
  assert.equal(data.decision, 'continue-fresh-long-history-six-type-feasibility');
  assert.deepEqual([data.fixtureDenominator, data.repetitions, data.attemptDenominator, data.attempts.length], [12, 2, 24, 24]);
  const ids = data.mapping.mapping.map(r => r.id);
  sameIds(data.blind.rows, ids);
  assert.equal(ids.length, 24);
  for (const ratings of [data.raterA.ratings, data.raterB.ratings, data.adjudication.ratings]) sameIds(ratings, ids);
  const joins = new Set();
  for (const a of data.attempts) {
    const m = data.mapping.mapping.find(r => r.id === a.blindId), p = data.blind.rows.find(r => r.id === a.blindId);
    assert.ok(m && p);
    assert.deepEqual([m.scenarioId, m.arm, m.repetition], [a.id, a.arm, a.repetition]);
    assert.equal(p.scenarioId, a.id);
    joins.add(a.blindId);
    assert.equal(a.arm, 'baseline');
    assert.equal(p.mechanicalCompletion, a.status === 'completed');
    const fixture = fixtures.find(f => f.id === a.id);
    const retained = retainedSourceView(captureSnapshot(fixture.input, 'source-bound-v2'));
    assert.deepEqual(p.sources, retained.messages.map((m, sourceIndex) => ({ sourceIndex, role: m.role, text: m.content })));
    assert.deepEqual(a.compiledCards.map(({ confidence, ...card }) => card), p.cards);
    for (const c of a.compiledCards) {
      assert.ok(Number.isFinite(c.confidence) && c.confidence >= 0 && c.confidence <= 1);
      for (const receipt of c.receipts) {
        assert.equal(receipt.excerpt, p.sources[receipt.sourceIndex].text);
        assert.equal(receipt.role, p.sources[receipt.sourceIndex].role);
      }
      for (const anchor of c.qualification.anchors) {
        assert.ok(Number.isSafeInteger(anchor.start) && anchor.start >= 0 && anchor.end > anchor.start);
        assert.equal(c.receipts[anchor.receiptIndex].excerpt.slice(anchor.start, anchor.end), anchor.text);
        assert.equal(new Set(anchor.fields).size, anchor.fields.length);
        assert.ok(anchor.fields.every(f => ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'].includes(f)));
      }
    }
    for (const ratings of [data.raterA.ratings, data.raterB.ratings, data.adjudication.ratings]) {
      const r = ratings.find(r => r.id === a.blindId);
      dimensions.forEach(d => assert.ok(a.status === 'completed' ? typeof r[d] === 'boolean' : r[d] === null));
      assert.equal(r.fullSuccess, a.status === 'completed' && dimensions.every(d => r[d] === true));
    }
    if (a.status !== 'completed') assert.deepEqual(a.compiledCards, []);
    assert.ok(Number.isFinite(a.latencyMs) && a.latencyMs > 0);
    assert.equal(a.records.length, 4);
    for (let i = 0; i < a.records.length; i++) {
      const r = a.records[i];
      assert.equal(r.method, i < 2 ? 'extract' : 'qualifyCandidates');
      assert.equal(r.endpoint, i % 2 ? 'responses' : 'responses/input_tokens');
      assert.equal(r.httpStatus, 200); assert.equal(r.outcome, 'succeeded');
      assert.equal(r.failure, null); assert.equal(r.responseTruncated, false);
      assert.equal(r.reservedMicroUsd, 4448);
      assert.ok(Number.isFinite(r.latencyMs) && r.latencyMs > 0);
      if (i % 2) {
        assert.equal(r.inputText, a.records[i - 1].inputText);
        assert.equal(r.outputStatus, 'completed'); assert.equal(r.countedInputTokens, null);
        assert.equal(typeof r.outputText, 'string'); JSON.parse(r.outputText);
        const u = r.usage;
        assert.ok(Number.isSafeInteger(u.input_tokens) && u.input_tokens >= 0 && u.input_tokens <= 7024);
        assert.ok(Number.isSafeInteger(u.output_tokens) && u.output_tokens >= 0 && u.output_tokens <= 1024);
        assert.equal(u.total_tokens, u.input_tokens + u.output_tokens);
        assert.equal(r.actualMicroUsd, Math.ceil((u.input_tokens * 4 + u.output_tokens * 16) / 10));
      } else {
        assert.equal(r.actualMicroUsd, null); assert.equal(r.usage, null);
        assert.equal(r.outputText, null); assert.equal(r.outputStatus, null);
        assert.ok(Number.isSafeInteger(r.countedInputTokens) && r.countedInputTokens <= 7024);
      }
    }
  }
  assert.equal(joins.size, 24);
  sameIds(data.perCase, fixtures.map(f => f.id));
  const sets = { adjudicated: data.adjudication.ratings, rawRaterA: data.raterA.ratings, rawRaterB: data.raterB.ratings };
  for (const [name, ratings] of Object.entries(sets)) {
    assert.deepEqual(data.aggregates[name], scores(data.attempts, ratings));
    for (const fixture of fixtures) {
      const rows = data.attempts.filter(a => a.id === fixture.id);
      assert.deepEqual(rows.map(a => a.repetition).sort(), [0, 1]);
      assert.deepEqual(data.perCase.find(c => c.id === fixture.id)[name], scores(rows, ratings));
    }
  }
  const disagreements = data.raterA.ratings.flatMap(a => {
    const b = data.raterB.ratings.find(r => r.id === a.id), ds = dimensions.filter(d => a[d] !== b[d]);
    return ds.length ? [{ id: a.id, dimensions: ds }] : [];
  });
  assert.deepEqual(data.disagreements, disagreements);
  assert.deepEqual(data.adjudication.decisions.map(d => ({ id: d.id, dimensions: d.dimensions })), disagreements);
  const differing = disagreements.reduce((n, r) => n + r.dimensions.length, 0);
  assert.deepEqual(data.agreement, { rows: 24, fullyAgreeingRows: 24 - disagreements.length,
    disagreeingRows: disagreements.length, dimensionComparisons: 144, agreeingDimensions: 144 - differing, disagreeingDimensions: differing });
  const records = data.attempts.flatMap(a => a.records), times = data.attempts.map(a => a.latencyMs).sort((a, b) => a - b);
  const resources = { httpRequests: records.length, generations: records.filter(r => r.endpoint === 'responses').length,
    cards: data.attempts.reduce((n, a) => n + a.compiledCards.length, 0),
    inputTokens: records.reduce((n, r) => n + (r.usage?.input_tokens ?? 0), 0),
    outputTokens: records.reduce((n, r) => n + (r.usage?.output_tokens ?? 0), 0),
    knownUsageUncachedCeilingMicroUsd: records.reduce((n, r) => n + (r.actualMicroUsd ?? 0), 0),
    reservedMicroUsd: records.reduce((n, r) => n + r.reservedMicroUsd, 0),
    unknownCostCountRequests: records.filter(r => r.endpoint === 'responses/input_tokens' && r.actualMicroUsd === null).length,
    medianInstrumentedAttemptLatencyMs: (times[11] + times[12]) / 2,
    totalInstrumentedAttemptLatencyMs: data.attempts.reduce((n, a) => n + a.latencyMs, 0),
    totalGuardedHttpLatencyMs: records.reduce((n, r) => n + r.latencyMs, 0),
    instrumentedRunLatencyMs: data.resources.instrumentedRunLatencyMs };
  assert.deepEqual(data.resources, resources);
  assert.equal(resources.instrumentedRunLatencyMs, 152773.809438);
  const c = data.campaignAggregates;
  assert.equal(c.newReservedMicroUsd, resources.reservedMicroUsd);
  assert.equal(c.finalRequestCount, c.initialRequestCount + records.length);
  assert.equal(c.finalReservedMicroUsd, c.initialReservedMicroUsd + c.newReservedMicroUsd);
  assert.equal(c.remainingMicroUsd, c.limitMicroUsd - c.finalReservedMicroUsd);
  assert.deepEqual([c.finalRequestCount, c.finalReservedMicroUsd, c.remainingMicroUsd, c.pendingAttempts, c.limitMicroUsd],
    [18768, 121064614, 78935386, 0, 200000000]);
}

async function replay(attempt) {
  const fixture = fixtures.find(f => f.id === attempt.id), snapshot = captureSnapshot(fixture.input, 'source-bound-v2');
  const retained = retainedSourceView(snapshot);
  let cursor = 0;
  const adapter = createOpenAIModel({ apiKey: 'synthetic-offline', qualificationInputMode: 'adaptive-text-catalog-v1',
    fetchImpl: async (url, options) => {
      const r = attempt.records[cursor++], body = JSON.parse(options.body);
      assert.ok(r, 'no extra request');
      assert.ok(url.endsWith('/' + r.endpoint));
      assert.equal(body.input[0].content[0].text, r.inputText, 'retained exact model input');
      const response = r.endpoint === 'responses/input_tokens' ? { object: 'response.input_tokens', input_tokens: r.countedInputTokens }
        : { object: 'response', model: result.model, status: r.outputStatus, error: null, incomplete_details: null, usage: r.usage,
          output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: r.outputText }] }] };
      return new Response(JSON.stringify(response), { status: r.httpStatus, headers: { 'content-type': 'application/json' } });
    } });
  const output = await callModel(adapter, 'extract', read('core/prompts/extract-retained-sources.md'), {
    messages: retained.messages.map(({ role, content }, index) => ({ index, role, content })) });
  const items = extractedItems(output, snapshot, retained.messages);
  const compiled = items.length ? await qualifyCandidateItems(adapter, items) : [];
  assert.equal(cursor, attempt.records.length);
  const cards = compiled.map(c => ({ content: c.content, kind: c.kind,
    receipts: c.receipts.map(r => ({ sourceIndex: snapshot.messages.findIndex(m => m.id === r.eventId), role: r.role, excerpt: r.excerpt })),
    qualification: c.qualification, confidence: c.confidence }));
  assert.deepEqual(cards, attempt.compiledCards, 'actual adapter/decoder/core compiler projection');
}

test('meaning results bind frozen sources, calibration and original rating/adjudication documents', () => {
  assert.equal(fixtureSha256, 'f63f5a4c68390f16c9217b8826f4240e8d15d40295089269081fcb96ad495435');
  assert.equal(result.provenance.fixtureSha256, fixtureSha256);
  assert.equal(result.provenance.candidateSha, 'daf48d2fba4ddd7c3bb84300f06e69eefd053f77');
  for (const name of ['fixtures.mjs', 'rubric.json', 'calibration.json']) {
    const path = 'evaluation/qualification-meaning/' + name;
    assert.equal(hash(read(path)), result.provenance.frozenFiles[path]);
  }
  assert.equal(hash(read('evaluation/qualification-meaning/rubric.json')), '81028a9774780a624669ad715409b64fc7c1cd6dff34ebb388427e987feab948');
  assert.equal(hash(read('evaluation/qualification-meaning/calibration.json')), '4cdebbba440d8d128fd1838e2f0800ce4828cebe7fc9f8b1210732d89cec92f0');
  assert.equal(result.blind.rubric, JSON.parse(read('evaluation/qualification-meaning/rubric.json')).version);
  for (const [name, doc] of Object.entries({ blind: result.blind, 'blind-mapping': result.mapping,
    'rater-a': result.raterA, 'rater-b': result.raterB, adjudication: result.adjudication })) {
    assert.equal(documentHash(doc), result.provenance.originalInputSha256[name]);
  }
  assert.equal(documentHash(result.adjudication), 'f2b79f79ff3fe306f84a9153801e625fa987319beb8d97cfdf8bfd4a8469bc7a');
  assert.equal(result.adjudication.blindSha256, documentHash(result.blind));
  assert.equal(result.adjudication.rawRatingsSha256.a, documentHash(result.raterA));
  assert.equal(result.adjudication.rawRatingsSha256.b, documentHash(result.raterB));
  assert.equal(result.provenance.adjudicationFrozenBeforeAggregatesAndMapping, true);
  privacy(result); integrity(result);
  assert.deepEqual(dimensions.map(d => result.aggregates.adjudicated.dimensions[d]), [16, 16, 21, 22, 20, 15]);
  assert.deepEqual([result.aggregates.adjudicated.fullSuccess, result.aggregates.rawRaterA.fullSuccess, result.aggregates.rawRaterB.fullSuccess], [13, 12, 12]);
  assert.deepEqual([result.resources.httpRequests, result.resources.generations, result.resources.cards,
    result.resources.inputTokens, result.resources.outputTokens, result.resources.knownUsageUncachedCeilingMicroUsd,
    result.resources.reservedMicroUsd, result.resources.unknownCostCountRequests], [96, 48, 31, 62238, 5954, 34440, 427008, 48]);
});

test('all 24 original provider outputs reproduce public cards through the real adapter and core', async () => {
  for (const attempt of result.attempts) await replay(attempt);
});

test('integrity rejects denominator, joins, grades, anchors, resource and budget corruption', () => {
  const corruptions = [
    d => d.attempts.pop(),
    d => { d.attempts[1].blindId = d.attempts[0].blindId; },
    d => { d.attempts[12].repetition = 0; },
    d => { d.raterA.ratings[0].fullSuccess = false; },
    d => { d.adjudication.ratings[0].supportedMeaning = null; },
    d => { d.blind.rows[0].sources[0].text += ' changed'; },
    d => { d.attempts[0].compiledCards[0].receipts[0].sourceIndex = 1; },
    d => { d.attempts[0].compiledCards[0].qualification.anchors[0].end -= 1; },
    d => { d.aggregates.adjudicated.fullSuccess += 1; },
    d => { d.perCase[0].adjudicated.dimensions.supportedMeaning += 1; },
    d => { d.disagreements[0].dimensions.pop(); },
    d => { d.agreement.agreeingDimensions += 1; },
    d => { d.attempts[0].records[1].usage.total_tokens += 1; },
    d => { d.attempts[0].records[1].actualMicroUsd -= 1; },
    d => { d.attempts[0].records[0].actualMicroUsd = 0; },
    d => { d.resources.cards += 1; },
    d => { d.campaignAggregates.remainingMicroUsd += 1; },
  ];
  for (const corrupt of corruptions) {
    const data = structuredClone(result); corrupt(data); assert.throws(() => integrity(data));
  }
});

test('real replay rejects changed provider content and foreign field evidence without repairing it', async () => {
  const content = structuredClone(result.attempts[0]);
  const extraction = JSON.parse(content.records[1].outputText);
  extraction.items[0].content = 'The user mandated this for all collections.';
  content.records[1].outputText = JSON.stringify(extraction);
  await assert.rejects(replay(content));
  const foreign = structuredClone(result.attempts[0]);
  const wire = JSON.parse(foreign.records[3].outputText);
  wire.qualifications.item_0.subject.evidenceSlots = [99];
  foreign.records[3].outputText = JSON.stringify(wire);
  await assert.rejects(replay(foreign));
  const field = structuredClone(result.attempts[0]);
  field.compiledCards[0].qualification.anchors[0].fields.pop();
  await assert.rejects(replay(field));
});

test('privacy allowlists reject nested headers, provider IDs, owner metadata and private paths', () => {
  const corruptions = [
    d => { d.attempts[0].records[0].headers = { authorization: 'secret' }; },
    d => { d.attempts[0].compiledCards[0].receipts[0].sessionId = 'private'; },
    d => { d.provenance.operatorFiles = {}; },
    d => { d.campaignAggregates.runId = 'private'; },
    d => { const input = JSON.parse(d.attempts[0].records[0].inputText); input.messages[0].ownerId = 'private'; d.attempts[0].records[0].inputText = JSON.stringify(input); },
    d => { const output = JSON.parse(d.attempts[0].records[1].outputText); output.items[0].headers = {}; d.attempts[0].records[1].outputText = JSON.stringify(output); },
    d => { d.raterA.ratings[0].notes.push('resp_abcdef0123456789'); },
    d => { d.raterB.ratings[0].notes.push('/tmp/private/operator.json'); },
  ];
  for (const corrupt of corruptions) {
    const data = structuredClone(result); corrupt(data); assert.throws(() => privacy(data));
  }
});
