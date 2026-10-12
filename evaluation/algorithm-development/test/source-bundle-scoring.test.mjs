import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createSourceBundleJudgePackets, parseSourceBundleFirstJudgments } from '../source-bundle-judging.mjs';
import { prepareSourceBundleScoring, scoreSourceBundleComparison } from '../source-bundle-scoring.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const clone = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const bindings = { sourcesSha256: '1'.repeat(64), rubricSha256: '2'.repeat(64),
  preparationManifestSha256: '3'.repeat(64), runManifestSha256: '4'.repeat(64),
  resultSha256: '5'.repeat(64), runtimeCommitSha: '6'.repeat(40) };
const seedHex = '07'.repeat(32);

// Generic explicit normalized inputs, not CF/BR provenance or model judgments.
function input(count = 48) {
  return { bindings: clone(bindings), seedHex, items: Array.from({ length: count }, (_, i) => {
    const number = Math.floor(i / 2) + 1, id = `PRIVATE_CASE_${number}`;
    const first = `PRIVATE_SOURCE_${number}_ONE`, second = `PRIVATE_SOURCE_${number}_TWO`;
    const content = `Mira handles cabinet ${number}. A cotton sleeve is required. 🧵`;
    const other = 'An assistant proposed linen; no adoption was recorded.';
    return { slotId: `${id}_${i % 2 ? 'PRIVATE_TREATMENT_RIGHT' : 'PRIVATE_TREATMENT_LEFT'}`,
      question: { text: `Which sleeve is required for cabinet ${number}?`, date: '2026-10-12 23:59' },
      sources: [{ id: first, eventTime: '2026-10-10T09:00:00.000Z', messages: [{ role: 'user', content }] },
        { id: second, eventTime: '2026-10-11T09:00:00.000Z', messages: [{ role: 'assistant', content: other }] }],
      rubric: { id, answerability: number % 4 ? 'answerable' : 'qualified',
        expectedProposition: 'Cotton is the recorded requirement.', acceptableQualifiedAnswer: 'Use cotton.',
        unanswerabilityReason: null, factualClaims: ['The note requires cotton.'],
        anchors: [{ id: 'PRIVATE_ANCHOR_ONE', sessionId: first, messageIndex: 0, start: 0, end: content.length, text: content },
          { id: 'PRIVATE_ANCHOR_TWO', sessionId: second, messageIndex: 0, start: 0, end: other.length, text: other }],
        requiredEvidenceSets: [{ name: 'minimum-required', anchorIds: ['PRIVATE_ANCHOR_ONE'] }],
        unsupportedConclusions: ['Linen was adopted.'], staleUse: 'Using the proposal as an adopted requirement.',
        severeConditions: ['Claim linen was required.', 'Assert all proposed changes were adopted.'],
        provenance: 'Submitted synthetic claims, not authenticated authority.', ambiguity: 'Optional background is not mandatory.',
        optionalContextClaims: [{ claim: 'An assistant proposed linen.', anchorIds: ['PRIVATE_ANCHOR_TWO'] }] },
      passages: [{ recordedRole: 'assistant', text: other }, { recordedRole: 'user', text: content }],
      answer: i % 2 ? 'Cotton is required.' : 'Use a cotton sleeve.' };
  }) };
}
function knownBody(packet) {
  const field = (value, target) => ({ value, rationale: 'A synthetic parser control, not a semantic reliability claim.',
    refs: [{ targetId: target.targetId, start: 0, end: target.text.length }] });
  return { version: 'first-answer-judgment-v1', packetSha256: packet.packetSha256,
    items: packet.payload.items.map(item => ({ itemId: item.itemId,
      correctness: field('yes', item.originalSources[0]), support: field('yes', item.packedPassages[1]),
      unsupportedClaims: field(0, item.answer), staleClaims: field(0, item.originalSources[1]),
      severe: JSON.parse(item.rubric.text).severeConditions.map(condition =>
        ({ conditionId: condition.conditionId, ...field('no', item.originalSources[0]) })) })) };
}
function responses(set) { return set.packets.map(packet => ({ judgeId: packet.judgeId, rawResponse: JSON.stringify(knownBody(packet)) })); }
function parsed(set, raw = responses(set)) { return parseSourceBundleFirstJudgments({ packetSet: set, rawFirstResponses: raw }); }
function change(set, judge, operation) {
  const raw = responses(set), body = JSON.parse(raw[judge].rawResponse); operation(body, set.packets[judge]);
  raw[judge].rawResponse = JSON.stringify(body); return raw;
}

test('48 neutral items produce stable distinct opaque packets without direct private mapping or treatment metadata', () => {
  const original = input(), set = createSourceBundleJudgePackets(original);
  assert.deepEqual(set, createSourceBundleJudgePackets(original)); assert.equal(set.packets.length, 2);
  assert.deepEqual(set.packets, createSourceBundleJudgePackets({ ...original, items: [...original.items].reverse() }).packets);
  assert.notDeepEqual(set.packets, createSourceBundleJudgePackets({ ...original, seedHex: '08'.repeat(32) }).packets);
  const orders = set.packets.map(packet => packet.payload.items.map(item => set.privateMapping.find(row =>
    row.judgeId === packet.judgeId && row.itemId === item.itemId).slotId));
  assert.notDeepEqual(orders[0], orders[1]);
  for (const packet of set.packets) {
    assert.equal(packet.payload.items.length, 48); assert.equal(packet.packetSha256, sha(JSON.stringify(packet.payload)));
    const body = JSON.stringify(packet.payload);
    for (const hidden of ['PRIVATE_CASE_', 'PRIVATE_SOURCE_', 'PRIVATE_ANCHOR_', 'PRIVATE_TREATMENT_',
      'slotId', 'normalizationSha256', 'runtimeCommitSha', 'sourcesSha256', 'privateMapping',
      'query-local-source-bundle-evidence-v1', 'source-role-evidence-v1']) assert.equal(body.includes(hidden), false, hidden);
    assert.match(packet.payload.instructions, /independently/u); assert.match(packet.payload.instructions, /not perfect|no perfect/u);
    assert.deepEqual(clone(packet.payload.bounds), { items: 48, claimCount: 128, rationaleUtf16: 1600, references: 16, rawBytes: 4194304 });
    for (const visible of packet.payload.items) {
      const map = set.privateMapping.find(row => row.judgeId === packet.judgeId && row.itemId === visible.itemId);
      const item = original.items.find(item => item.slotId === map.slotId);
      assert.equal(JSON.stringify(visible.question), JSON.stringify(item.question)); assert.equal(visible.answer.text, item.answer);
      assert.deepEqual(visible.packedPassages.map(({ recordedRole, text }) => ({ recordedRole, text })), item.passages);
      assert.deepEqual(visible.originalSources.map(source => [source.recordedRole, source.text, source.eventTime]),
        item.sources.map(source => [source.messages[0].role, source.messages[0].content, source.eventTime]));
      const rubric = JSON.parse(visible.rubric.text);
      assert.equal(rubric.expectedProposition, item.rubric.expectedProposition);
      assert.equal(rubric.anchors[0].sessionId, visible.originalSources[0].targetId);
      assert.deepEqual(rubric.requiredEvidenceSets[0].anchorIds, [rubric.anchors[0].id]);
      assert.deepEqual(rubric.optionalContextClaims[0].anchorIds, [rubric.anchors[1].id]);
      const expectedId = 'item-' + sha(JSON.stringify([seedHex, `first-answer-independent-judge-${packet.judgeId}-v1`,
        'identity', item.slotId])).slice(0, 32);
      assert.equal(visible.itemId, expectedId);
    }
  }
  assert.equal(Object.isFrozen(set), true); assert.equal(Object.isFrozen(set.packets[0].payload.items[0]), true);
});

test('strict generic normalized inputs reject unknown fields, duplicates, poison and over-bounds without accessors', () => {
  const bad = mutation => { const value = input(2); mutation(value); assert.throws(() => createSourceBundleJudgePackets(value), /invalid_judging_input/u); };
  bad(value => { value.extra = true; }); bad(value => { value.seedHex = 'f'.repeat(63); });
  bad(value => { value.bindings.factory = 'not-allowed'; }); bad(value => { value.items[1].slotId = value.items[0].slotId; });
  bad(value => { value.items[0].organization = 'private grouping'; }); bad(value => { value.items[0].passages[0].recordedRole = 'system'; });
  bad(value => { value.items[0].rubric.anchors[0].end--; }); bad(value => { value.items[0].sources[0].messages.push({ role: 'user', content: 'extra' }); });
  assert.throws(() => createSourceBundleJudgePackets(input(49)), /invalid_judging_input/u);
  let reads = 0; const getter = { bindings, seedHex, get items() { reads++; return []; } };
  assert.throws(() => createSourceBundleJudgePackets(getter)); assert.equal(reads, 0);
  assert.throws(() => createSourceBundleJudgePackets(new Proxy({}, { ownKeys() { reads++; return []; } }))); assert.equal(reads, 0);
  const sparse = input(2); delete sparse.items[0]; assert.throws(() => createSourceBundleJudgePackets(sparse));
  const cyclic = input(1); cyclic.items[0].answer = cyclic; assert.throws(() => createSourceBundleJudgePackets(cyclic));
  const reordered = input(2); reordered.items.forEach(item => { item.passages = item.passages.map(p => ({ text: p.text, recordedRole: p.recordedRole })); });
  assert.deepEqual(createSourceBundleJudgePackets(reordered).packets, createSourceBundleJudgePackets(input(2)).packets);
});

test('first raw binding and all 48 identities preserve literals and independent fieldwise agreement', () => {
  const set = createSourceBundleJudgePackets(input()), raw = responses(set);
  raw[0].rawResponse = '\n  ' + raw[0].rawResponse + '\n'; const result = parsed(set, raw);
  assert.equal(result.items.length, 48); assert.equal(result.judges.length, 2);
  assert.equal(result.judges[0].rawResponse, raw[0].rawResponse); assert.equal(result.judges[0].rawSha256, sha(raw[0].rawResponse));
  for (const item of result.items) {
    assert.equal(item.fields.correctness.value, 'yes'); assert.equal(item.fields.support.value, 'yes');
    assert.equal(item.fields.unsupportedClaims.value, 0); assert.equal(item.fields.staleClaims.value, 0);
    assert.equal(item.fields.correctness.status, 'known'); assert.ok(item.severe.every(condition => condition.value === 'no'));
  }
  assert.match(result.provenance, /required-not-verified/u); assert.equal('promising' in result, false);
  const empty = createSourceBundleJudgePackets(input(0)); assert.deepEqual(parsed(empty).items, []);
});

test('malformed, missing, duplicate decoded keys, unexpected identity and wrong packet binding are never replacement judgments', () => {
  const set = createSourceBundleJudgePackets(input(2));
  for (const rawResponse of [null, '{"partial":', '', responses(set)[0].rawResponse.replace('"version":',
    '"version":"ignored","version":')]) {
    const raw = responses(set); raw[0].rawResponse = rawResponse; const result = parsed(set, raw);
    assert.equal(result.judges[0].rawResponse, rawResponse); assert.equal(result.judges[0].rawSha256, rawResponse === null ? null : sha(rawResponse));
    assert.ok(result.items.every(item => item.fields.correctness.status === 'unknown'));
    assert.ok(result.items.every(item => item.fields.unsupportedClaims.value === null));
  }
  for (const operation of [body => { body.packetSha256 = '0'.repeat(64); }, body => { body.version = 'future'; },
    body => { body.extra = true; }, body => { body.items[0].itemId = 'unexpected'; },
    body => { body.items.push(clone(body.items[0])); }, body => { body.items = []; }]) {
    const raw = change(set, 0, operation), result = parsed(set, raw);
    assert.equal(result.judges[0].rawResponse, raw[0].rawResponse); assert.notEqual(result.judges[0].status, 'valid');
    assert.ok(result.items.some(item => item.fields.correctness.status === 'unknown'));
  }
  const escaped = responses(set); escaped[0].rawResponse = '{"version":"first-answer-judgment-v1","ver\\u0073ion":"first-answer-judgment-v1"}';
  assert.equal(parsed(set, escaped).judges[0].status, 'malformed');
});

test('fieldwise unknown, disagreement, malformed fields and contradictions do not become favorable zeros', () => {
  const set = createSourceBundleJudgePackets(input(2));
  const raw = change(set, 0, body => {
    body.items[0].correctness.value = 'no'; body.items[0].unsupportedClaims.value = null;
    body.items[0].unsupportedClaims.refs = []; body.items[0].severe[0].value = 'yes';
  });
  const result = parsed(set, raw), slot = result.judges[0].items[0].slotId;
  const item = result.items.find(item => item.slotId === slot);
  assert.equal(item.fields.correctness.reason, 'disagreement'); assert.equal(item.fields.support.status, 'known');
  assert.equal(item.fields.unsupportedClaims.value, null); assert.equal(item.severe[0].reason, 'disagreement');
  const conflicting = parsed(set, change(set, 0, body => { body.items[0].unsupportedClaims.value = 1; }));
  const a = conflicting.judges[0].items[0]; assert.equal(a.fields.support.status, 'contradictory');
  assert.equal(a.fields.unsupportedClaims.value, null); assert.equal(a.fields.correctness.status, 'known');
  for (const operation of [field => { field.value = 129; }, field => { field.value = -1; },
    field => { field.value = 0.5; }, field => { field.refs = []; }, field => { field.extra = true; }]) {
    const out = parsed(set, change(set, 0, body => operation(body.items[0].unsupportedClaims)));
    assert.equal(out.judges[0].items[0].fields.unsupportedClaims.status, 'invalid');
    assert.equal(out.judges[0].items[0].fields.unsupportedClaims.value, null);
    assert.equal(out.judges[0].items[0].fields.correctness.status, 'known');
  }
  const missing = parsed(set, change(set, 0, body => { delete body.items[0].correctness; }));
  assert.equal(missing.judges[0].items[0].fields.correctness.status, 'missing');
  assert.equal(missing.judges[0].items[0].fields.support.status, 'known');
});

test('support references are restricted to own answer and packed passages, unlike full-source correctness/stale/severe', () => {
  const set = createSourceBundleJudgePackets(input(2));
  const badSource = parsed(set, change(set, 0, (body, packet) => {
    const ref = { targetId: packet.payload.items[0].originalSources[0].targetId, start: 0, end: 5 };
    body.items[0].support.refs = [ref]; body.items[0].unsupportedClaims.refs = [ref];
  }));
  assert.equal(badSource.judges[0].items[0].fields.support.status, 'invalid');
  assert.equal(badSource.judges[0].items[0].fields.unsupportedClaims.status, 'invalid');
  assert.equal(badSource.judges[0].items[0].fields.correctness.status, 'known');
  assert.equal(badSource.judges[0].items[0].fields.staleClaims.status, 'known');
  assert.equal(badSource.judges[0].items[0].severe[0].status, 'known');
  for (const operation of [(ref, packet) => { ref.targetId = packet.payload.items[1].answer.targetId; },
    ref => { ref.end = 999999; }, ref => { ref.end = ref.start; }, ref => { ref.start = -1; }]) {
    const result = parsed(set, change(set, 0, (body, packet) => operation(body.items[0].support.refs[0], packet)));
    assert.equal(result.judges[0].items[0].fields.support.status, 'invalid');
  }
  const split = parsed(set, change(set, 0, (body, packet) => {
    const source = packet.payload.items[0].originalSources[0], start = source.text.indexOf('🧵');
    body.items[0].correctness.refs = [{ targetId: source.targetId, start, end: start + 1 }];
  })); assert.equal(split.judges[0].items[0].fields.correctness.status, 'invalid');
});

test('rationale, reference, item and first-raw size bounds preserve malformed originals and unknown severe fields', () => {
  const set = createSourceBundleJudgePackets(input(2));
  for (const operation of [body => { body.items[0].correctness.rationale = 'x'.repeat(1601); },
    body => { body.items[0].correctness.refs = Array.from({ length: 17 }, () => clone(body.items[0].correctness.refs[0])); }]) {
    assert.equal(parsed(set, change(set, 0, operation)).judges[0].items[0].fields.correctness.status, 'invalid');
  }
  for (const operation of [body => { body.items[0].severe = []; }, body => { body.items[0].severe.push(clone(body.items[0].severe[0])); },
    body => { body.items[0].severe[0].conditionId = 'unexpected-condition'; }]) {
    assert.ok(parsed(set, change(set, 0, operation)).judges[0].items[0].severe.some(condition => condition.value === 'unknown'));
  }
  const large = responses(set); large[0].rawResponse = 'x'.repeat(4194305); const denied = parsed(set, large);
  assert.equal(denied.judges[0].retention, 'external-oversized-first-artifact'); assert.equal(denied.judges[0].rawResponse, null);
  assert.equal(denied.judges[0].rawSha256, sha(large[0].rawResponse)); assert.equal(denied.judges[0].rawBytes, 4194305);
  assert.equal(denied.judges[0].status, 'oversized'); assert.ok(denied.items.every(item => item.fields.staleClaims.value === null));
  const exact = responses(set); exact[0].rawResponse += ' '.repeat(4194304 - Buffer.byteLength(exact[0].rawResponse));
  assert.equal(parsed(set, exact).judges[0].status, 'valid');
  const fortyNine = change(set, 0, body => { body.items = Array.from({ length: 49 }, () => clone(body.items[0])); });
  assert.equal(parsed(set, fortyNine).judges[0].status, 'invalid_binding');
});

test('packet payload tampering and structural parser poison deny attribution without evaluating hostile input', () => {
  const set = createSourceBundleJudgePackets(input(2));
  const altered = clone(set); altered.packets[0].payload.items[0].answer.text = 'changed';
  assert.throws(() => parsed(altered), /invalid_judging_input/u);
  const invalidMap = clone(set); invalidMap.privateMapping[0].itemId = 'not-present'; assert.throws(() => parsed(invalidMap));
  const unknownRubric = clone(set), rubric = JSON.parse(unknownRubric.packets[0].payload.items[0].rubric.text);
  rubric.organization = 'not an accepted neutral field'; unknownRubric.packets[0].payload.items[0].rubric.text = JSON.stringify(rubric);
  unknownRubric.packets[0].packetSha256 = sha(JSON.stringify(unknownRubric.packets[0].payload)); assert.throws(() => parsed(unknownRubric));
  const duplicateRaw = responses(set); duplicateRaw[1].judgeId = 'A'; assert.throws(() => parsed(set, duplicateRaw));
  let reads = 0; const options = { packetSet: set, get rawFirstResponses() { reads++; return []; } };
  assert.throws(() => parseSourceBundleFirstJudgments(options)); assert.equal(reads, 0);
  const raw = responses(set); Object.defineProperty(raw[0], 'rawResponse', { get() { reads++; return 'secret'; }, enumerable: true });
  assert.throws(() => parsed(set, raw)); assert.equal(reads, 0);
  const module = readFileSync(new URL('../source-bundle-judging.mjs', import.meta.url), 'utf8');
  const imports = [...module.matchAll(/from\s+['"]([^'"]+)['"]/gu)].map(match => match[1]);
  assert.deepEqual(imports, ['node:crypto', 'node:util']);
  assert.doesNotMatch(module, /\b(?:process|fetch|readFile|writeFile|DatabaseSync)\b/u);
});

test('owned pure-subpacket workspace cleanup covers success, assertion and setup failure', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-judge-cleanup-' });
  for (const mode of ['success', 'assertion', 'setup']) {
    const fixture = join(workspace.path, `${mode}.test.mjs`);
    const code = `import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestWorkspace } from ${JSON.stringify(new URL('../../../tools/testing/workspace.mjs', import.meta.url).href)};
test('owned normalized-data fixture', async t => {
  const owned = createTestWorkspace(t, { prefix: 'cairn-judge-child-' });
  console.log('OWNED_SCRATCH=' + owned.path);
  if (${JSON.stringify(mode)} === 'setup') throw new Error('deliberate_setup_failure');
  if (${JSON.stringify(mode)} === 'assertion') assert.fail('deliberate_assertion_failure');
  assert.ok(owned.path);
});`;
    await writeFile(fixture, code, { flag: 'wx', mode: 0o600 });
    const child = spawnSync(process.execPath, [join(root, 'tools/testing/run.mjs'), fixture], { cwd: root, encoding: 'utf8', timeout: 30000 });
    assert.equal(child.error, undefined); assert.equal(child.status, mode === 'success' ? 0 : 1, child.stdout + child.stderr);
    const owned = child.stdout.match(/OWNED_SCRATCH=(\/[^\s]+)/u)?.[1]; assert.ok(owned); assert.equal(existsSync(owned), false);
  }
});

const frozenSources = JSON.parse(readFileSync(new URL('../source-bundle-cases.json', import.meta.url), 'utf8'));
const frozenRubric = JSON.parse(readFileSync(new URL('../source-bundle-rubric.json', import.meta.url), 'utf8'));
const hashValue = value => sha(JSON.stringify(value));
const MODEL = 'gpt-4.1-mini-2025-04-14';
const POSITIVE = new Set(['BQ01', 'BQ03', 'BQ08']);

async function newLedger(workspace) {
  const budget = await import('../../experiment-budget/index.mjs');
  const configuration = { directory: join(workspace.path, 'synthetic-budget'), runId: randomUUID(),
    limitMicroUsd: 400000000, requestCap: 100000 };
  budget.createExperimentBudget(configuration).close();
  const initial = budget.inspectExperimentBudgetForEmbeddingUpgrade(configuration);
  const checkpoint = { requestCount: initial.requestCount, reservedMicroUsd: initial.reservedMicroUsd };
  budget.upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: checkpoint, expectedHistorySha256: initial.historySha256 });
  return { configuration, checkpoint, historySha256: initial.historySha256 };
}
function padding(value, maximum) {
  const raw = JSON.stringify(value); assert.ok(Buffer.byteLength(raw) < maximum);
  return new Response(raw + ' '.repeat(maximum - Buffer.byteLength(raw)));
}
// Fixed prospectively: only literal exposed chronology/source indices are read
// by rank/planner ports. Question/rubric/gold is not an input to this policy.
function chronological(rows, passage) {
  return [...rows].sort((a, b) => {
    const date = row => { const match = passage(row).match(/^\[session-date: ([^;]+); clock: dataset-local\]/u);
      assert.ok(match, 'literal rendered date prefix'); return match[1]; };
    return date(a).localeCompare(date(b)) || (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0)
      || (a.memoryId ?? a.memory.id).localeCompare(b.memoryId ?? b.memory.id);
  });
}
function chronologicalProvider(url, init, answerCalls) {
  const body = JSON.parse(init.body);
  if (url.endsWith('/input_tokens')) return padding({ object: 'response.input_tokens', input_tokens: 500 }, 65536);
  if (url.endsWith('/chat/completions')) {
    // QA answer order is frozen, not chosen after observing an answer or gold.
    const ordinal = ++answerCalls.count;
    return padding({ object: 'chat.completion', model: MODEL,
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: ordinal === 48 ? '' : 'Offline plumbing control.' } }],
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } }, 262144);
  }
  const input = JSON.parse(body.input[0].content[0].text), format = body.text.format.name;
  let proposal;
  if (format === 'cairn_source_bundle_plan_rank_v1') {
    const selected = chronological(input.catalog, row => row.excerpt).slice(0, 6).map(row => row.sourceIndex);
    proposal = { bundles: [selected.slice(0, 3), selected.slice(3)].map(sourceIndices => ({ sourceIndices, terminalSourceIndex: sourceIndices.at(-1) })) };
  } else if (format === 'cairn_rank') {
    const candidate = chronological(input.candidates, row => row.receipts[0].excerpt)[0];
    proposal = { refs: [{ namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision }] };
  } else proposal = { refs: input.maps[0].items.slice(0, 3).map(item => ({ namespaceIndex: input.maps[0].namespaceIndex, ...item.ref })) };
  const text = JSON.stringify(proposal), cut = Math.floor(text.length / 3);
  const message = parts => ({ type: 'message', role: 'assistant', status: 'completed', content: parts.map(text => ({ type: 'output_text', text })) });
  // Ordinary accepts ordered concatenation across messages/parts; QT retains
  // its stricter single-message/single-part envelope.
  const output = format === 'cairn_source_bundle_plan_rank_v1' ? [message([text])]
    : [message([text.slice(0, cut), text.slice(cut, cut * 2)]), message([text.slice(cut * 2)])];
  return padding({ object: 'response', id: 'resp_synthetic', model: MODEL, status: 'completed', error: null, incomplete_details: null,
    output,
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } }, 262144);
}
function fixtureInput(preparation, result) { return { frozenSources, preparation, result, rubric: frozenRubric, seedHex }; }
function scriptedRaw(prepared, operation = () => {}) {
  return prepared.packets.map(packet => {
    const mapping = new Map(prepared.privateMapping.filter(row => row.judgeId === packet.judgeId).map(row => [row.itemId, row.slotId]));
    const field = (value, target) => ({ value, rationale: 'Scripted arithmetic control, not semantic model evidence.',
      refs: value === 'unknown' || value === null ? [] : [{ targetId: target.targetId, start: 0, end: target.text.length }] });
    const body = { version: 'first-answer-judgment-v1', packetSha256: packet.packetSha256,
      items: packet.payload.items.map(item => {
        const slot = mapping.get(item.itemId), caseId = slot.slice(0, 4), treatment = slot.includes('_source_bundle_');
        const row = { itemId: item.itemId, correctness: field(treatment && POSITIVE.has(caseId) ? 'yes' : 'no', item.answer),
          support: field('yes', item.answer), unsupportedClaims: field(0, item.answer), staleClaims: field(0, item.originalSources[0]),
          severe: JSON.parse(item.rubric.text).severeConditions.map(condition => ({ conditionId: condition.conditionId, ...field('no', item.answer) })) };
        operation({ row, item, slot, caseId, treatment, judgeId: packet.judgeId, field }); return row;
      }) };
    return { judgeId: packet.judgeId, rawResponse: JSON.stringify(body) };
  });
}
async function assess(base, prepared, operation) {
  return scoreSourceBundleComparison({ ...base, packetBindings: prepared.packets.map(({ judgeId, packetSha256 }) => ({ judgeId, packetSha256 })),
    rawFirstResponses: scriptedRaw(prepared, operation) });
}

test('actual24 padded chronology fixture validates integrity, all67 anchors and conservative offline gates', { timeout: 240000 }, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-scoring-actual24-' });
  const { prepareSourceBundleComparison } = await import('../source-bundle-store.mjs');
  const { createSourceBundleComparisonManifest, runSourceBundleComparison } = await import('../source-bundle-runner.mjs');
  const preparation = await prepareSourceBundleComparison({ outputRoot: workspace.path });
  const ledger = await newLedger(workspace), answerCalls = { count: 0 }, callbacks = [];
  const result = await runSourceBundleComparison({ preparation, ...ledger, manifest: createSourceBundleComparisonManifest(preparation.observation),
    apiKey: 'synthetic_source_scoring_key', signal: new AbortController().signal,
    fetchImpl: (url, init) => chronologicalProvider(url, init, answerCalls), onRecord(record) { callbacks.push(record); }, onCheckpoint() {} });
  assert.equal(result.status, 'accounted', JSON.stringify({ stopReason: result.stopReason, failures: result.cases.map(c => [c.id, c.answers.ordinary.failure, c.answers['source-bundle'].failure]) }));
  assert.equal(result.intents.length, 192); assert.equal(result.transitions.length, 120);
  assert.equal(result.cases.flatMap(c => Object.values(c.answers)).filter(slot => slot.artifacts.answerResult !== null).length, 47);
  assert.equal(result.cases[23].answers.ordinary.failure, 'invalid_answer_response');
  assert.equal(result.cases[23].answers.ordinary.answerInvoked, true);
  assert.equal(result.cases.filter(c => c.probe.execution === 'completed').length, 24);
  const retainedBodies = result.intents.map(intent => intent.final.responseBody);
  for (const intent of result.intents.filter(row => row.method !== 'answer' &&
    (row.ownerKind === 'planner' ? row.final.kind === 'generation' : row.final.endpoint === 'responses'))) {
    const output = JSON.parse(intent.final.responseBody).output;
    assert.equal(output.length, intent.ownerKind === 'ordinary' ? 2 : 1);
    assert.equal(output[0].content.length, intent.ownerKind === 'ordinary' ? 2 : 1);
  }
  assert.equal(retainedBodies.reduce((sum, body) => sum + Buffer.byteLength(body), 0), 36175872);
  assert.deepEqual(JSON.parse(readFileSync(join(workspace.path, 'comparison', 'result.json'), 'utf8')), result);
  assert.deepEqual(callbacks.filter(row => row.normalized?.phase === 'post').map(row => row.raw.responseBody), retainedBodies);
  const base = fixtureInput(preparation.observation, result), prepared = await prepareSourceBundleScoring(base);
  console.log('SC_ACTUAL=' + JSON.stringify({ status: prepared.status, issues: prepared.issues, intents: result.intents.length, owners: result.transitions.length }));
  assert.equal(prepared.status, 'ready', JSON.stringify(prepared.issues));
  assert.deepEqual(Object.keys(prepared).sort(), ['version', 'status', 'issues', 'bindings', 'mechanical', 'packets', 'privateMapping', 'excludedAnswers'].sort());
  const baselineComplete = prepared.mechanical.stages.filter(row => row.arm === 'ordinary' && row.actualPacked.complete).map(row => row.caseId);
  const bundleComplete = prepared.mechanical.stages.filter(row => row.arm === 'source-bundle' && row.actualPacked.complete).map(row => row.caseId);
  assert.deepEqual(baselineComplete, ['BQ05', 'BQ13']);
  assert.deepEqual(bundleComplete, ['BQ01', 'BQ03', 'BQ05', 'BQ08', 'BQ09', 'BQ10', 'BQ13', 'BQ14', 'BQ15', 'BQ18']);
  let originalAnchorCount = 0;
  for (const [index, r] of frozenRubric.cases.entries()) {
    const source = frozenSources[index];
    for (const anchor of r.anchors) {
      const session = source.sessions.find(s => s.id === anchor.sessionId); originalAnchorCount++;
      assert.equal(session.messages[anchor.messageIndex].content.slice(anchor.start, anchor.end), anchor.text);
    }
    for (const arm of ['ordinary', 'source-bundle']) {
      const stage = prepared.mechanical.stages.find(s => s.caseId === source.id && s.arm === arm);
      const selectedSessionIds = new Set(source.sessions.slice(0, arm === 'ordinary' ? 1 : 6).map(s => s.id));
      for (const name of ['capture', 'rank', 'selected', 'preparedPacked', 'actualPacked']) {
        assert.equal(stage[name].status, 'observed');
        assert.deepEqual(stage[name].anchors, r.anchors.map(a => ({ id: a.id, present: ['capture', 'rank'].includes(name) || selectedSessionIds.has(a.sessionId) })));
        assert.deepEqual(stage[name].sets, r.requiredEvidenceSets.map(set => ({ name: set.name,
          complete: set.anchorIds.every(id => ['capture', 'rank'].includes(name) || selectedSessionIds.has(r.anchors.find(a => a.id === id).sessionId)) })));
      }
    }
  }
  assert.equal(originalAnchorCount, 67);
  assert.equal(prepared.packets[0].payload.items.length, 47); assert.equal(prepared.excludedAnswers.length, 1);
  assert.deepEqual((await prepareSourceBundleScoring({ ...base, seedHex: seedHex.toUpperCase() })).packets, prepared.packets);
  await t.test('positive labels require actual minimal sets; no-answer has no credit; optional context omitted', async () => {
    const report = await assess(base, prepared); assert.equal(report.status, 'assessed');
    assert.deepEqual(report.paired, { lower: 3, upper: 3, wins: 3, losses: 0, ties: 21, uncertain: 0 });
    assert.equal(report.gate.promising, true); assert.equal(report.summaries.ordinary.all.retainedCompleteCases, 2);
    assert.equal(report.summaries['source-bundle'].all.retainedCompleteCases, 10);
    assert.equal(report.denominators.qaSlots, 48); assert.equal(report.summaries.ordinary.all.actualAnswers, 23);
    assert.equal(report.summaries.ordinary.qualified.cases, 6); assert.equal(report.summaries.ordinary.answerable.cases, 18);
    assert.equal(report.cases[23].arms.ordinary.supportedCorrect, false);
    assert.equal(report.cases[2].arms['source-bundle'].supportedCorrect, true);
    assert.equal(report.harms.D12Cleared, false); assert.equal(report.resources.peakRss, null);
    assert.equal(report.resources.dispatchedIntents, 192); assert.equal(report.resources.finalRecordIntents, 192);
    assert.equal(report.resources.deltaConfirmedSettledIntents, 192); assert.equal(report.resources.settlementNotIndependentlyConfirmedIntents, 0);
    const incomplete = await assess(base, prepared, ({ row, caseId }) => { if (caseId === 'BQ02') row.correctness.value = 'yes'; });
    assert.equal(incomplete.cases[1].arms['source-bundle'].supportedCorrect, false);
    assert.deepEqual(incomplete.paired, report.paired);
    const wrongSubject = await assess(base, prepared, ({ row, caseId, treatment }) => {
      if (caseId === 'BQ01' && treatment) row.correctness.value = 'no';
    }); assert.equal(wrongSubject.paired.lower, 2); assert.equal(wrongSubject.gate.promising, false);
  });
  await t.test('unknown mechanically complete baseline cannot manufacture plus3', async () => {
    const report = await assess(base, prepared, ({ row, item, caseId, treatment, field }) => {
      row.correctness = field(treatment && ['BQ01', 'BQ05', 'BQ13'].includes(caseId) ? 'yes'
        : !treatment && ['BQ05', 'BQ13'].includes(caseId) ? 'unknown' : 'no', item.answer);
    });
    assert.equal(report.paired.lower, 1); assert.equal(report.paired.upper, 3); assert.equal(report.gate.promising, false);
  });
  await t.test('unsupported/stale question AND claim gates; each new/shared severe; known safety', async () => {
    for (const name of ['unsupportedClaims', 'staleClaims']) {
      const report = await assess(base, prepared, ({ row, item, caseId, treatment, field }) => {
        if (caseId === 'BQ02' && treatment) { row[name] = field(2, item.answer); if (name === 'unsupportedClaims') row.support.value = 'no'; }
      });
      assert.equal(report.gate.promising, false); assert.ok(report.gate.reasons.includes('added-unsupported-or-stale'));
      const harm = name === 'unsupportedClaims' ? report.harms.unsupported : report.harms.stale;
      assert.equal(harm.addedQuestions, 1); assert.equal(harm.addedClaims, 2);
    }
    for (let condition = 0; condition < frozenRubric.cases[1].severeConditions.length; condition++) {
      for (const shared of [false, true]) {
        const report = await assess(base, prepared, ({ row, caseId, treatment }) => {
          if (caseId === 'BQ02' && (shared || treatment)) row.severe[condition].value = 'yes';
        });
        const harm = report.harms.severe.find(row => row.caseId === 'BQ02' && row.conditionIndex === condition);
        assert.equal(harm.newlyPositive, !shared); assert.equal(harm.sharedPositive, shared);
        assert.equal(report.gate.promising, shared); assert.equal(report.harms.D12Cleared, false);
      }
    }
    for (const kind of ['unknown', 'disagreement', 'contradiction', 'optional']) {
      const report = await assess(base, prepared, ({ row, item, caseId, treatment, judgeId, field }) => {
        if (caseId !== (kind === 'optional' ? 'BQ03' : 'BQ02') || !treatment) return;
        if (kind === 'unknown') row.unsupportedClaims = field(null, item.answer);
        if (kind === 'disagreement' && judgeId === 'A') row.staleClaims = field(1, item.answer);
        if (kind === 'contradiction') row.unsupportedClaims = field(1, item.answer);
        if (kind === 'optional') { row.unsupportedClaims = field(1, item.answer); row.support.value = 'no'; }
      }); assert.equal(report.gate.promising, false);
      if (kind === 'unknown') { assert.equal(report.summaries['source-bundle'].all.unsupported.claims, null);
        assert.equal(report.summaries['source-bundle'].all.unsupported.coverage, 'partial-known-only'); }
    }
  });
  await t.test('raw missing/malformed/duplicate first judgments retained, fieldwise uncertainty not replacement', async () => {
    for (const mode of ['missing', 'malformed', 'duplicate']) {
      const raw = scriptedRaw(prepared);
      if (mode === 'missing') raw[0].rawResponse = null;
      if (mode === 'malformed') raw[0].rawResponse = '{broken FIRST';
      if (mode === 'duplicate') { const body = JSON.parse(raw[0].rawResponse); body.items.push(clone(body.items[0])); raw[0].rawResponse = JSON.stringify(body); }
      const report = await scoreSourceBundleComparison({ ...base, packetBindings: prepared.packets.map(({ judgeId, packetSha256 }) => ({ judgeId, packetSha256 })), rawFirstResponses: raw });
      assert.equal(report.status, 'assessed'); assert.equal(report.gate.promising, false);
      assert.equal(report.judgments.judges[0].rawResponse, raw[0].rawResponse);
    }
  });
  await t.test('literal origin/read/whole-evidence/question/answer/wire/hash mutations deny assessment', async () => {
    const operations = [
      x => { x.frozenSources[0].sessions[0].messages[0].content += 'x'; },
      x => { x.rubric.cases[0].anchors[0].start++; },
      x => { x.preparation.cases[0].plan.originMap.turns[0].bodyStart++; },
      x => { delete x.preparation.cases[0].tokenCounts.ordinaryPrepared; },
      x => { x.preparation.cases[0].hashes.extraSha256 = '0'.repeat(64); },
      x => { x.preparation.cases[0].omissionCounters = {}; },
      x => { x.result.cases[0].answers.ordinary.artifacts.authoritativeReads[0].input.receiptLimit = 99; },
      x => { x.result.cases[0].answers.ordinary.artifacts.authoritativeReads[0].returned.value.receipts[0].role = 'assistant'; },
      x => { x.result.cases[0].answers['source-bundle'].artifacts.evidence.units.reverse(); },
      x => { const unit = x.result.cases[0].answers.ordinary.artifacts.evidence.units[0]; const body = JSON.parse(unit.text); body.sources[0].text = body.sources[0].text.slice(1); unit.text = JSON.stringify(body); },
      x => { x.result.cases[0].answers['source-bundle'].artifacts.sidecar.proposal.bundles[0].sourceIndices = [0]; },
      x => { x.result.cases[0].answers.ordinary.artifacts.packed.request.messages[1].content += ' '; },
      x => { x.result.cases[0].answers.ordinary.answer = 'forged first answer'; },
      x => { x.result.intents.find(i => i.method === 'answer').final.requestBody += ' '; },
      x => { x.result.resources.unknownUsageIntents = 0; },
      x => { x.result.transitions[0].state.appendedAttempts[0].reservedMicroUsd = 0; },
      x => { x.result.cases[0].answers.ordinary.artifacts.packed.inputTokens++; },
      x => { x.result.intents[0].final.localInputTokens++; },
      x => { x.result.transitions[0].caseDeadline++; },
      x => { x.result.cases[0].probe.artifacts.selectFailure = { code: 'context_budget_exceeded' }; },
      x => { const raw = x.result.intents[0].final; raw.providerInputTokens = 7025; raw.responseBody = JSON.stringify({ object: 'response.input_tokens', input_tokens: 7025 }); raw.responseBytes = Buffer.byteLength(raw.responseBody); raw.failure = 'context_budget_exceeded'; },
    ];
    for (const [index, operation] of operations.entries()) {
      const mutated = clone(base); operation(mutated); const denied = await prepareSourceBundleScoring(mutated);
      assert.equal(denied.status, 'denied', 'mutation ' + index); assert.equal(denied.mechanical, null);
    }
    const probe = clone(base); probe.result.cases[1].probe.artifacts.selected.refs = probe.preparation.cases[1].recallMap.items.slice(0, 6).map(item => ({ namespaceIndex: 0, ...item.ref }));
    const prep = await prepareSourceBundleScoring(probe); assert.equal(prep.status, 'denied');
    const score = await assess(base, prepared, ({ row, caseId }) => { if (caseId === 'BQ02') row.correctness.value = 'yes'; });
    assert.equal(score.cases[1].arms['source-bundle'].supportedCorrect, false);
  });
  await t.test('ordinary success/fatal outcome contradictions deny the public retained seam', async () => {
    const observations = [];
    for (const [outcome, failure] of [['succeeded', 'provider_failure'], ['succeeded', 'algorithm_auth_transport_failure'],
      ['failed', 'algorithm_auth_transport_failure'], ['unknown', 'algorithm_auth_transport_failure']]) {
      // Explicit corruption controls, not claimed runtime executions. Keep the
      // directly bound delta outcome consistent; wires/source/answer stay fixed.
      const mutated = clone(base), intent = mutated.result.intents[0];
      intent.final.outcome = outcome; intent.final.failure = failure;
      mutated.result.transitions[0].state.appendedAttempts[0].outcome = outcome;
      const denied = await prepareSourceBundleScoring(mutated);
      observations.push({ outcome, failure, status: denied.status, issues: denied.issues });
    }
    console.log('SC_C1_ORDINARY=' + JSON.stringify(observations));
    assert.deepEqual(observations.map(row => row.status), ['denied', 'denied', 'denied', 'denied']);
  });
  await t.test('completed probe progress binds each reached artifact, calls and actual intents', async () => {
    const controls = [
      ['all-artifacts-missing', probe => { probe.artifacts = {}; }],
      ...['beforeStore', 'afterStore', 'selectRequest', 'selected', 'recall', 'selectCalls', 'rankCalls', 'rankRequest']
        .map(key => ['missing-' + key, probe => { delete probe.artifacts[key]; }]),
      ['selectCalls-zero', probe => { probe.artifacts.selectCalls = 0; }],
      ['selectCalls-two', probe => { probe.artifacts.selectCalls = 2; }],
      ['rankCalls-zero', probe => { probe.artifacts.rankCalls = 0; }],
      ['rankCalls-two', probe => { probe.artifacts.rankCalls = 2; }],
      ['completed-with-failure', probe => { probe.failure = 'invalid_model_output'; }],
      ['completed-with-selectFailure', probe => { probe.artifacts.selectFailure = { code: 'provider_failed' }; }],
      ['failed-with-successful-recall', probe => { probe.execution = 'failed'; probe.failure = 'invalid_model_output'; }],
      ['not-run-with-reached-artifacts', probe => { probe.execution = 'not-run'; }],
      ['before-store-hash', probe => { probe.artifacts.beforeStore.sha256 = '0'.repeat(64); }],
      ['after-store-size', probe => { probe.artifacts.afterStore.fileBytes++; }],
      ['select-query', probe => { probe.artifacts.selectRequest.input.query += 'x'; }],
      ['select-system', probe => { probe.artifacts.selectRequest.system += 'x'; }],
      ['select-limit', probe => { probe.artifacts.selectRequest.maxOutputTokens = 512; }],
      ['select-namespace', probe => { probe.artifacts.selectRequest.input.maps[0].namespaceIndex = 1; }],
      ['rank-system', probe => { probe.artifacts.rankRequest.system += 'x'; }],
      ['rank-query', probe => { probe.artifacts.rankRequest.input.query += 'x'; }],
      ['rank-limit', probe => { probe.artifacts.rankRequest.input.limit = 5; }],
      ['rank-output-cap', probe => { probe.artifacts.rankRequest.maxOutputTokens = 512; }],
      ['rank-candidate-omission', probe => { probe.artifacts.rankRequest.input.candidates.pop(); }],
      ['rank-candidate-order', probe => { probe.artifacts.rankRequest.input.candidates.reverse(); }],
      ['rank-receipt', probe => { probe.artifacts.rankRequest.input.candidates[0].receipts[0].excerpt += 'x'; }],
      ['recall-must-be-empty', (probe, c) => { probe.artifacts.recall.value.memories = [clone(c.rankRequest.input.candidates[0])]; }],
      ['recall-namespace', probe => { probe.artifacts.recall.value.namespaces[0].namespace.scopeId += 'x'; }],
      ['recall-coverage', probe => { probe.artifacts.recall.value.coverage = 'budget_exhausted'; }],
      ['completed-error-recall', probe => { probe.artifacts.recall = { ok: false, error: { code: 'invalid_model_output' } }; }],
      ['selected-missing-refs', probe => { probe.artifacts.selected = {}; }],
    ];
    const observations = [];
    for (const [name, operation] of controls) {
      // Explicit artifact corruption of one genuine completed probe. The actual
      // wires, history, immutable sources, QA answers and all other slots stay
      // unchanged; this does not claim these alterations were executed.
      const probe = clone(result.cases[0].probe); operation(probe, preparation.observation.cases[0]);
      const mutated = { ...base, result: { ...result, cases: result.cases.map((row, i) => i ? row : { ...row, probe }) } };
      const denied = await prepareSourceBundleScoring(mutated);
      const score = await assess(mutated, prepared);
      observations.push({ name, prepare: denied.status, score: score.status, issues: denied.issues });
    }
    console.log('SC_C4_CORRUPTION=' + JSON.stringify(observations));
    assert.ok(observations.every(row => row.prepare === 'denied' && row.score === 'denied'), JSON.stringify(observations));
  });
  await t.test('large raw allowance does not cover metadata; accessors/proxies never invoked', async () => {
    const oversized = { ...base, result: { ...result, intents: result.intents.map((row, index) => index ? row : { ...row, final: { ...row.final, requestBody: 'x'.repeat(32 * 1024 * 1024 + 1) } }) } };
    assert.deepEqual((await prepareSourceBundleScoring(oversized)).issues, ['metadata_limit']);
    let touched = 0;
    const accessor = { ...result }; Object.defineProperty(accessor, 'intents', { enumerable: true, get() { touched++; return []; } });
    assert.equal((await prepareSourceBundleScoring({ ...base, result: accessor })).status, 'denied');
    const proxy = new Proxy(result.intents[0], { ownKeys() { touched++; return []; }, get() { touched++; return null; } });
    assert.equal((await prepareSourceBundleScoring({ ...base, result: { ...result, intents: [proxy] } })).status, 'denied');
    assert.equal(touched, 0);
  });
  await assert.rejects(runSourceBundleComparison({ preparation }), /invalid_source_bundle_preparation/u);
  await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
});

test('actual stopped planner overflow retains healthy failed/unknown ordinary slots without claiming compliance', { timeout: 180000 }, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-scoring-c1-overflow-' });
  const { prepareSourceBundleComparison } = await import('../source-bundle-store.mjs');
  const { createSourceBundleComparisonManifest, runSourceBundleComparison } = await import('../source-bundle-runner.mjs');
  const preparation = await prepareSourceBundleComparison({ outputRoot: workspace.path }), ledger = await newLedger(workspace);
  let counts = 0;
  const result = await runSourceBundleComparison({ preparation, ...ledger,
    manifest: createSourceBundleComparisonManifest(preparation.observation), apiKey: 'synthetic_source_scoring_key',
    signal: new AbortController().signal, onRecord() {}, onCheckpoint() {},
    fetchImpl(url, init) {
      if (url.endsWith('/input_tokens') && ++counts === 4)
        return new Response(JSON.stringify({ object: 'response.input_tokens', input_tokens: 7025 }));
      if (url.endsWith('/chat/completions')) throw new Error('synthetic unavailable response');
      if (!url.endsWith('/input_tokens') && JSON.parse(init.body).text.format.name === 'cairn_rank')
        return new Response(JSON.stringify({ error: { type: 'synthetic_unavailable' } }), { status: 503 });
      return chronologicalProvider(url, init, { count: 0 });
    } });
  assert.equal(result.status, 'stopped'); assert.equal(result.stopReason, 'usage_overrun');
  assert.equal(result.intents.length, 8); assert.equal(result.transitions.length, 5);
  assert.equal(result.cases.length, 24); assert.equal(result.cases.flatMap(c => Object.values(c.answers)).length, 48);
  assert.equal(result.cases.map(c => c.probe).length, 24);
  const failed = result.intents.find(i => i.final.httpStatus === 503), unknown = result.intents.find(i => i.method === 'answer');
  assert.equal(failed.final.outcome, 'failed'); assert.equal(failed.final.failure, 'provider_failure');
  assert.equal(unknown.final.outcome, 'unknown'); assert.equal(unknown.final.failure, 'provider_failed');
  assert.equal(result.cases[0].answers.ordinary.execution, 'failed');
  assert.equal(result.cases[0].answers['source-bundle'].execution, 'failed');
  assert.equal(result.cases[0].probe.execution, 'completed');
  const overflow = result.intents.at(-1);
  assert.equal(overflow.caseId, 'BQ02'); assert.equal(overflow.ownerKind, 'planner'); assert.equal(overflow.final.kind, 'count');
  assert.equal(overflow.final.inputTokens, 7025); assert.equal(overflow.final.outputTokens, null);
  assert.equal(overflow.final.failureCode, 'usage_overrun'); assert.equal(overflow.final.outcome, 'failed');
  assert.equal(overflow.final.settlementPersisted, true);
  assert.equal(JSON.parse(overflow.final.responseBody).input_tokens, 7025);
  assert.deepEqual(JSON.parse(readFileSync(join(workspace.path, 'comparison', 'result.json'), 'utf8')), result);
  const base = fixtureInput(preparation.observation, result), prepared = await prepareSourceBundleScoring(base);
  assert.equal(prepared.status, 'ready', JSON.stringify(prepared.issues));
  const report = await assess(base, prepared);
  console.log('SC_C1_STOPPED=' + JSON.stringify({ status: report.status, compliance: report.resources.compliance.status,
    intents: result.intents.length, owners: result.transitions.length, ordinaryOutcomes: [failed.final.outcome, unknown.final.outcome],
    planner: { inputTokens: overflow.final.inputTokens, outputTokens: overflow.final.outputTokens,
      failureCode: overflow.final.failureCode, outcome: overflow.final.outcome, settlementPersisted: overflow.final.settlementPersisted,
      responseBody: overflow.final.responseBody, responseSha256: overflow.final.responseSha256 } }));
  assert.equal(report.status, 'assessed'); assert.equal(report.gate.promising, false);
  assert.equal(report.denominators.qaSlots, 48); assert.equal(report.probes.length, 24);
  assert.equal(report.resources.compliance.status, 'not-satisfied');
  for (const tokenField of ['inputTokens', 'outputTokens']) {
    const mutated = clone(base); mutated.result.intents.at(-1).final[tokenField] = 7026;
    assert.equal((await prepareSourceBundleScoring(mutated)).status, 'denied', tokenField + ' must bind actual count body');
  }
  await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
});

test('actual fresh pre-aborted24 preserves honest not-reached, zero dispatch and fixed denominator', { timeout: 180000 }, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-scoring-preaborted-' });
  const { prepareSourceBundleComparison } = await import('../source-bundle-store.mjs');
  const { createSourceBundleComparisonManifest, runSourceBundleComparison } = await import('../source-bundle-runner.mjs');
  const preparation = await prepareSourceBundleComparison({ outputRoot: workspace.path }), ledger = await newLedger(workspace);
  const controller = new AbortController(); controller.abort();
  const result = await runSourceBundleComparison({ preparation, ...ledger, manifest: createSourceBundleComparisonManifest(preparation.observation),
    apiKey: 'synthetic_source_scoring_key', signal: controller.signal, fetchImpl() { assert.fail('no dispatch'); }, onRecord() { assert.fail('no record'); }, onCheckpoint() { assert.fail('no owner'); } });
  assert.equal(result.status, 'stopped'); assert.equal(result.stopReason, 'cancelled'); assert.equal(result.intents.length, 0);
  assert.equal(result.transitions.length, 0); assert.equal(result.history.base, null); assert.equal(result.finalState, null);
  const base = fixtureInput(preparation.observation, result), prepared = await prepareSourceBundleScoring(base);
  assert.equal(prepared.status, 'ready', JSON.stringify(prepared.issues)); assert.equal(prepared.packets[0].payload.items.length, 0);
  const report = await assess(base, prepared); assert.equal(report.denominators.qaSlots, 48); assert.equal(report.probes.length, 24);
  assert.equal(report.summaries.ordinary.all.notRun, 24); assert.equal(report.summaries['source-bundle'].all.notRun, 24);
  assert.equal(report.gate.promising, false); assert.ok(report.gate.reasons.includes('stopped-run'));
  assert.ok(report.stages.every(stage => stage.actualPacked.status === 'not-reached' && stage.rank.status === 'not-reached'));
  await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
});

test('C4 actual empty, invalid selection and settled ordinary timeout preserve conditional probe progress', { timeout: 180000 }, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-scoring-c4-conditional-' });
  const { prepareSourceBundleComparison } = await import('../source-bundle-store.mjs');
  const { createSourceBundleComparisonManifest, runSourceBundleComparison } = await import('../source-bundle-runner.mjs');
  const preparation = await prepareSourceBundleComparison({ outputRoot: workspace.path }), ledger = await newLedger(workspace);
  const answerCalls = { count: 0 }; let selects = 0, caseOrdinal = 0;
  const result = await runSourceBundleComparison({ preparation, ...ledger,
    manifest: createSourceBundleComparisonManifest(preparation.observation), apiKey: 'synthetic_source_scoring_key', signal: new AbortController().signal,
    onCheckpoint() {}, onRecord(record) {
      if (record.normalized?.phase === 'pre') caseOrdinal = record.caseOrdinal;
    }, fetchImpl(url, init) {
      if (caseOrdinal > 3) {
        assert.ok(url.endsWith('/input_tokens'), 'later planned slots fail at their first count');
        return Response.json({ error: { type: 'synthetic_count_unavailable' } }, { status: 503 });
      }
      if (url.endsWith('/responses') && JSON.parse(init.body).text.format.name === 'cairn_select') {
        if (++selects === 3) return new Promise(() => {}); // Real unchanged30s ordinary/core timeout.
        const input = JSON.parse(JSON.parse(init.body).input[0].content[0].text), visible = { namespaceIndex: 0, ...input.maps[0].items[0].ref };
        const output = { refs: selects === 1 ? [] : [visible, visible] };
        return Response.json({ object: 'response', model: MODEL, status: 'completed', error: null, incomplete_details: null,
          output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
          usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
      }
      return chronologicalProvider(url, init, answerCalls);
    } });
  assert.equal(selects, 3);
  assert.equal(result.status, 'accounted'); assert.equal(result.stopReason, null);
  assert.equal(result.cases.length, 24); assert.equal(result.cases.flatMap(c => Object.values(c.answers)).length, 48);
  assert.equal(result.cases.map(c => c.probe).length, 24);
  const empty = result.cases[0].probe, invalid = result.cases[1].probe, timed = result.cases[2].probe;
  assert.equal(empty.execution, 'completed'); assert.equal(empty.failure, null);
  assert.deepEqual(empty.artifacts.selected, { refs: [] }); assert.equal(empty.artifacts.selectCalls, 1);
  assert.equal(empty.artifacts.rankCalls, 0); assert.equal(Object.hasOwn(empty.artifacts, 'rankRequest'), false);
  assert.equal(empty.artifacts.recall.ok, true); assert.deepEqual(empty.artifacts.recall.value.memories, []);
  assert.equal(invalid.execution, 'failed'); assert.equal(invalid.failure, 'invalid_model_output');
  assert.equal(invalid.artifacts.selectCalls, 1); assert.equal(invalid.artifacts.rankCalls, 0);
  assert.equal(Object.hasOwn(invalid.artifacts, 'rankRequest'), false); assert.equal(Object.hasOwn(invalid.artifacts, 'selectFailure'), false);
  assert.deepEqual(invalid.artifacts.selected.refs[0], invalid.artifacts.selected.refs[1]);
  assert.equal(invalid.artifacts.recall.ok, false); assert.equal(invalid.artifacts.recall.error.code, 'invalid_model_output');
  const invalidIntent = result.intents.find(intent => intent.slotId === 'BQ02_probe' && intent.final?.endpoint === 'responses');
  assert.equal(invalidIntent.final.outcome, 'succeeded'); assert.equal(invalidIntent.final.httpStatus, 200);
  const probeOwners = result.transitions.filter(row => ['BQ01_probe', 'BQ02_probe', 'BQ03_probe'].includes(row.slotId));
  assert.deepEqual(probeOwners.map(row => [row.slotId, row.phaseId, row.method, row.kind]),
    [['BQ01_probe', 'BQ01_probe_select', 'select', 'ordinary'], ['BQ02_probe', 'BQ02_probe_select', 'select', 'ordinary'],
      ['BQ03_probe', 'BQ03_probe_select', 'select', 'ordinary']]);
  assert.ok(probeOwners.every(row => row.closed && row.healthy));
  assert.equal(timed.execution, 'failed'); assert.equal(timed.failure, 'model_timeout');
  assert.deepEqual(timed.artifacts.selectFailure, { code: 'provider_failed' });
  assert.equal(timed.artifacts.recall.error.code, 'model_timeout');
  assert.equal(timed.artifacts.selectCalls, 1); assert.equal(timed.artifacts.rankCalls, 0);
  assert.equal(Object.hasOwn(timed.artifacts, 'selected'), false); assert.equal(Object.hasOwn(timed.artifacts, 'rankRequest'), false);
  const timeoutIntent = result.intents.find(intent => intent.slotId === 'BQ03_probe' && intent.final?.endpoint === 'responses');
  assert.equal(timeoutIntent.dispatched, true); assert.equal(timeoutIntent.final.failure, 'model_timeout');
  assert.equal(timeoutIntent.final.outcome, 'unknown'); assert.equal(timeoutIntent.final.actualMicroUsd, null);
  const timeoutDelta = probeOwners[2].state.appendedAttempts.find(row => row.attemptId === timeoutIntent.attemptId);
  assert.deepEqual(timeoutDelta, { attemptId: timeoutIntent.attemptId, channel: 'cairn-generation', reservedMicroUsd: 5000,
    outcome: 'unknown', actualMicroUsd: null });
  assert.ok(result.transitions.every(row => row.closed && row.healthy));
  assert.ok(result.cases.slice(3).every(row => row.probe.execution === 'failed' && row.probe.failure === 'provider_failed'
    && Object.values(row.answers).every(slot => slot.execution === 'failed' && slot.failure === 'provider_failed')));
  assert.deepEqual(JSON.parse(readFileSync(join(workspace.path, 'comparison', 'result.json'), 'utf8')), result);
  const base = fixtureInput(preparation.observation, result), prepared = await prepareSourceBundleScoring(base), report = await assess(base, prepared);
  console.log('SC_C4_CONDITIONAL=' + JSON.stringify({ prepare: prepared.status, score: report.status, issues: prepared.issues,
    intents: result.intents.length, owners: result.transitions.length, empty: empty.execution, invalid: invalid.execution,
    invalidHttpOutcome: invalidIntent.final.outcome, stopReason: result.stopReason, runtimeStatus: result.status,
    timeout: { port: timed.artifacts.selectFailure.code, core: timed.artifacts.recall.error.code, slot: timed.failure,
      raw: timeoutIntent.final.failure, outcome: timeoutIntent.final.outcome, delta: timeoutDelta.outcome } }));
  assert.equal(prepared.status, 'ready', JSON.stringify(prepared.issues)); assert.equal(report.status, 'assessed');
  assert.equal(report.denominators.qaSlots, 48); assert.equal(report.probes.length, 24); assert.equal(report.gate.promising, false);
  assert.equal(report.probes[0].selected.status, 'observed'); assert.equal(report.probes[0].selected.complete, false);
  assert.equal(report.probes[0].rank.status, 'not-reached'); assert.equal(report.probes[0].recall.status, 'observed');
  assert.equal(report.probes[1].selected.status, 'observed'); assert.equal(report.probes[1].selected.complete, false);
  assert.equal(report.probes[1].rank.status, 'not-reached'); assert.equal(report.probes[1].recall.status, 'not-reached');
  const controls = [
    ['empty-fabricated-rank-count', 0, probe => { probe.artifacts.rankCalls = 1; }],
    ['empty-fabricated-rank-request', 0, probe => { probe.artifacts.rankRequest = clone(preparation.observation.cases[0].rankRequest); }],
    ['empty-missing-selected', 0, probe => { delete probe.artifacts.selected; }],
    ['empty-missing-recall', 0, probe => { delete probe.artifacts.recall; }],
    ['invalid-fabricated-rank-count', 1, probe => { probe.artifacts.rankCalls = 1; }],
    ['invalid-fabricated-rank-request', 1, probe => { probe.artifacts.rankRequest = clone(preparation.observation.cases[1].rankRequest); }],
    ['invalid-promoted-completed', 1, probe => { probe.execution = 'completed'; probe.failure = null; }],
    ['invalid-fabricated-success-recall', 1, probe => { probe.artifacts.recall = clone(empty.artifacts.recall); }],
    ['invalid-missing-selected', 1, probe => { delete probe.artifacts.selected; }],
    ['invalid-wrong-core-cause', 1, probe => { probe.artifacts.recall.error.code = 'provider_failed'; }],
    ['invalid-unwitnessed-slot-failure', 1, probe => { probe.failure = 'provider_failed'; }],
    ['timeout-wrong-core-cause', 2, probe => { probe.artifacts.recall.error.code = 'invalid_model_output'; }],
    ['timeout-port-cause', 2, probe => { probe.artifacts.selectFailure.code = 'invalid_model_output'; }],
    ['timeout-slot-cause', 2, probe => { probe.failure = 'provider_failed'; }],
    ['timeout-missing-port-cause', 2, probe => { delete probe.artifacts.selectFailure; }],
    ['failed-fabricated-rank-count', 3, probe => { probe.artifacts.rankCalls = 1; }],
  ];
  const observations = [];
  for (const [name, index, operation] of controls) {
    const probe = clone(result.cases[index].probe); operation(probe);
    const mutated = { ...base, result: { ...result, cases: result.cases.map((row, i) => i === index ? { ...row, probe } : row) } };
    observations.push({ name, prepare: (await prepareSourceBundleScoring(mutated)).status, score: (await assess(mutated, prepared)).status });
  }
  console.log('SC_C4_CONDITIONAL_CORRUPTION=' + JSON.stringify(observations));
  assert.ok(observations.every(row => row.prepare === 'denied' && row.score === 'denied'), JSON.stringify(observations));
  const witnesses = [
    ['timeout-wrong-raw-cause', run => { run.intents = result.intents.map(intent => intent === timeoutIntent
      ? { ...intent, final: { ...intent.final, failure: 'provider_failed' } } : intent); }],
    ['timeout-unhealthy-owner', run => { run.transitions = result.transitions.map(row => row.slotId === 'BQ03_probe'
      ? { ...row, healthy: false } : row); }],
    ['timeout-unclosed-owner', run => { run.transitions = result.transitions.map(row => row.slotId === 'BQ03_probe'
      ? { ...row, closed: false } : row); }],
    ['timeout-missing-owner', run => { run.transitions = result.transitions.filter(row => row.slotId !== 'BQ03_probe'); }],
    ['invalid-unwitnessed-stopped-failure', run => {
      // Explicit status/cause corruption, not a claimed stopped execution.
      run.status = 'stopped'; run.stopReason = 'cancelled';
      run.cases = result.cases.map((row, i) => i === 1 ? { ...row, probe: { ...row.probe, failure: 'provider_failed' } } : row);
    }],
  ];
  const witnessObservations = [];
  for (const [name, operation] of witnesses) {
    const mutated = { ...base, result: { ...result } }; operation(mutated.result);
    witnessObservations.push({ name, prepare: (await prepareSourceBundleScoring(mutated)).status,
      score: (await assess(mutated, prepared)).status });
  }
  console.log('SC_C4_TIMEOUT_WITNESSES=' + JSON.stringify(witnessObservations));
  assert.ok(witnessObservations.every(row => row.prepare === 'denied' && row.score === 'denied'), JSON.stringify(witnessObservations));
  const generic = result.cases[3].probe;
  assert.deepEqual(generic.artifacts.selectFailure, { code: 'provider_failed' });
  assert.deepEqual(generic.artifacts.recall, { ok: false, error: { code: 'recall_failed', retryable: false } });
  const genericIntent = result.intents.find(intent => intent.slotId === 'BQ04_probe');
  assert.equal(genericIntent.final.failure, 'provider_failure'); assert.equal(genericIntent.final.outcome, 'failed');
  assert.equal(genericIntent.final.httpStatus, 503);
  const causeControls = [
    ['provider-port-invalid-output', probe => { probe.artifacts.selectFailure.code = 'invalid_model_output'; }],
    ['provider-port-invented', probe => { probe.artifacts.selectFailure.code = 'invented_failure'; }],
    ['provider-equal-invalid-output', probe => { probe.artifacts.selectFailure.code = probe.failure = 'invalid_model_output'; }],
    ['provider-equal-invented', probe => { probe.artifacts.selectFailure.code = probe.failure = 'invented_failure'; }],
    ['provider-equal-timeout', probe => { probe.artifacts.selectFailure.code = probe.failure = 'model_timeout'; }],
    ['provider-core-invalid-output', probe => { probe.artifacts.recall.error.code = 'invalid_model_output'; }],
    ['provider-core-port-code', probe => { probe.artifacts.recall.error.code = 'provider_failed'; }],
    ['provider-core-invented', probe => { probe.artifacts.recall.error.code = 'invented_failure'; }],
    ['provider-core-retryable', probe => { probe.artifacts.recall.error.retryable = true; }],
    ['provider-core-storage-busy-false', probe => { probe.artifacts.recall.error.code = 'storage_busy'; }],
    ['provider-core-storage-busy-true', probe => { probe.artifacts.recall.error = { code: 'storage_busy', retryable: true }; }],
    ['provider-unwitnessed-fatal-slot', probe => { probe.failure = 'cancelled'; }],
  ];
  const causeObservations = [];
  for (const [name, operation] of causeControls) {
    const probe = clone(generic); operation(probe);
    const mutated = { ...base, result: { ...result, cases: result.cases.map((row, i) => i === 3 ? { ...row, probe } : row) } };
    causeObservations.push({ name, prepare: (await prepareSourceBundleScoring(mutated)).status,
      score: (await assess(mutated, prepared)).status });
  }
  console.log('SC_C5_ACCOUNTED_CAUSES=' + JSON.stringify(causeObservations));
  assert.ok(causeObservations.every(row => row.prepare === 'denied' && row.score === 'denied'), JSON.stringify(causeObservations));
  await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
});

test('C5 actual stopped provider, settled timeout, invalid selection and checkpoint cancellation bind probe causes', { timeout: 180000 }, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-scoring-c5-stopped-' });
  const { prepareSourceBundleComparison } = await import('../source-bundle-store.mjs');
  const { createSourceBundleComparisonManifest, runSourceBundleComparison } = await import('../source-bundle-runner.mjs');
  const preparation = await prepareSourceBundleComparison({ outputRoot: workspace.path }), ledger = await newLedger(workspace);
  const controller = new AbortController(); let caseOrdinal = 0, arm = null, cancelCheckpoints = 0;
  const result = await runSourceBundleComparison({ preparation, ...ledger,
    manifest: createSourceBundleComparisonManifest(preparation.observation), apiKey: 'synthetic_source_scoring_key', signal: controller.signal,
    onRecord(record) { if (record.normalized?.phase === 'pre') { caseOrdinal = record.caseOrdinal; arm = record.arm; } },
    onCheckpoint(owner) {
      if (owner.phaseId === 'BQ04_probe_select') {
        assert.equal(owner.closed, true); assert.equal(owner.healthy, true); cancelCheckpoints++; controller.abort();
      }
    }, fetchImpl(url, init) {
      if (arm !== 'probe' || caseOrdinal === 1 || caseOrdinal === 4) {
        assert.ok(url.endsWith('/input_tokens'), 'declared ordinary failures stop at first count');
        return Response.json({ error: { type: 'synthetic_count_unavailable' } }, { status: 503 });
      }
      assert.ok(caseOrdinal === 2 || caseOrdinal === 3, 'no later provider dispatch');
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 500 });
      assert.ok(url.endsWith('/responses'));
      if (caseOrdinal === 2) return new Promise(() => {}); // Actual unchanged30s ordinary/core timeout.
      const input = JSON.parse(JSON.parse(init.body).input[0].content[0].text), visible = { namespaceIndex: 0, ...input.maps[0].items[0].ref };
      return Response.json({ object: 'response', model: MODEL, status: 'completed', error: null, incomplete_details: null,
        output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ refs: [visible, visible] }) }] }],
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
    } });
  assert.equal(cancelCheckpoints, 1); assert.equal(result.status, 'stopped'); assert.equal(result.stopReason, 'cancelled');
  assert.equal(result.cases.length, 24); assert.equal(result.cases.flatMap(row => Object.values(row.answers)).length, 48);
  assert.equal(result.cases.map(row => row.probe).length, 24);
  const [generic, timed, invalid, cancelled] = result.cases.map(row => row.probe);
  for (const probe of [generic, timed, invalid, cancelled]) {
    assert.equal(probe.execution, 'failed'); assert.equal(probe.artifacts.selectCalls, 1); assert.equal(probe.artifacts.rankCalls, 0);
    assert.equal(Object.hasOwn(probe.artifacts, 'rankRequest'), false);
  }
  for (const [probe, failure] of [[generic, 'provider_failed'], [cancelled, 'cancelled']]) {
    assert.equal(probe.failure, failure); assert.deepEqual(probe.artifacts.selectFailure, { code: 'provider_failed' });
    assert.deepEqual(probe.artifacts.recall, { ok: false, error: { code: 'recall_failed', retryable: false } });
  }
  assert.equal(timed.failure, 'model_timeout'); assert.deepEqual(timed.artifacts.selectFailure, { code: 'provider_failed' });
  assert.deepEqual(timed.artifacts.recall, { ok: false, error: { code: 'model_timeout', retryable: false } });
  assert.equal(invalid.failure, 'invalid_model_output'); assert.equal(Object.hasOwn(invalid.artifacts, 'selectFailure'), false);
  assert.deepEqual(invalid.artifacts.selected.refs[0], invalid.artifacts.selected.refs[1]);
  assert.deepEqual(invalid.artifacts.recall, { ok: false, error: { code: 'invalid_model_output', retryable: false } });
  const probeOwners = result.transitions.filter(row => row.arm === 'probe');
  assert.deepEqual(probeOwners.map(row => [row.slotId, row.phaseId, row.method, row.kind]),
    [1, 2, 3, 4].map(n => [`BQ0${n}_probe`, `BQ0${n}_probe_select`, 'select', 'ordinary']));
  assert.ok(probeOwners.every(row => row.closed && row.healthy)); assert.ok(result.transitions.every(row => row.closed && row.healthy));
  const timeoutIntent = result.intents.find(intent => intent.slotId === 'BQ02_probe' && intent.final?.endpoint === 'responses');
  assert.equal(timeoutIntent.dispatched, true); assert.equal(timeoutIntent.final.failure, 'model_timeout'); assert.equal(timeoutIntent.final.outcome, 'unknown');
  assert.equal(timeoutIntent.final.actualMicroUsd, null);
  const timeoutDelta = probeOwners[1].state.appendedAttempts.find(row => row.attemptId === timeoutIntent.attemptId);
  assert.deepEqual(timeoutDelta, { attemptId: timeoutIntent.attemptId, channel: 'cairn-generation', reservedMicroUsd: 5000,
    outcome: 'unknown', actualMicroUsd: null });
  for (const ordinal of [1, 4]) {
    const intent = result.intents.find(row => row.slotId === `BQ0${ordinal}_probe`);
    assert.equal(intent.final.endpoint, 'responses/input_tokens'); assert.equal(intent.final.httpStatus, 503);
    assert.equal(intent.final.outcome, 'failed'); assert.equal(intent.final.failure, 'provider_failure');
  }
  const invalidIntent = result.intents.find(row => row.slotId === 'BQ03_probe' && row.final?.endpoint === 'responses');
  assert.equal(invalidIntent.final.httpStatus, 200); assert.equal(invalidIntent.final.outcome, 'succeeded');
  assert.ok(result.cases.slice(4).every(row => row.probe.execution === 'not-run' && row.probe.failure === 'cancelled'
    && Object.values(row.answers).every(slot => slot.execution === 'not-run' && slot.failure === 'cancelled')));
  assert.deepEqual(JSON.parse(readFileSync(join(workspace.path, 'comparison', 'result.json'), 'utf8')), result);
  const base = fixtureInput(preparation.observation, result), prepared = await prepareSourceBundleScoring(base), report = await assess(base, prepared);
  console.log('SC_C5_STOPPED=' + JSON.stringify({ runtime: result.status, stopReason: result.stopReason,
    prepare: prepared.status, score: report.status, issues: prepared.issues, intents: result.intents.length, owners: result.transitions.length,
    probes: [generic, timed, invalid, cancelled].map(probe => ({ slot: probe.failure, port: probe.artifacts.selectFailure?.code ?? null,
      core: probe.artifacts.recall.error, selected: Object.hasOwn(probe.artifacts, 'selected') })) }));
  assert.equal(prepared.status, 'ready', JSON.stringify(prepared.issues)); assert.equal(report.status, 'assessed');
  assert.equal(report.denominators.qaSlots, 48); assert.equal(report.probes.length, 24); assert.equal(report.gate.promising, false);
  const controls = [
    ['stopped-provider-port', 0, probe => { probe.artifacts.selectFailure.code = 'invalid_model_output'; }],
    ['stopped-provider-equal-invalid', 0, probe => { probe.artifacts.selectFailure.code = probe.failure = 'invalid_model_output'; }],
    ['stopped-provider-equal-invented', 0, probe => { probe.artifacts.selectFailure.code = probe.failure = 'invented_failure'; }],
    ['stopped-provider-slot-timeout', 0, probe => { probe.failure = 'model_timeout'; }],
    ['stopped-provider-core', 0, probe => { probe.artifacts.recall.error.code = 'invalid_model_output'; }],
    ['stopped-provider-retryable', 0, probe => { probe.artifacts.recall.error.retryable = true; }],
    ['stopped-provider-other-fatal', 0, probe => { probe.failure = 'authentication_failed'; }],
    ['earlier-provider-port-and-slot-cancelled', 0, probe => { probe.artifacts.selectFailure.code = probe.failure = 'cancelled'; }],
    ['earlier-provider-slot-cancelled', 0, probe => { probe.failure = 'cancelled'; }],
    ['stopped-timeout-port', 1, probe => { probe.artifacts.selectFailure.code = 'invalid_model_output'; }],
    ['stopped-timeout-slot', 1, probe => { probe.failure = 'provider_failed'; }],
    ['stopped-timeout-core', 1, probe => { probe.artifacts.recall.error.code = 'recall_failed'; }],
    ['stopped-timeout-retryable', 1, probe => { probe.artifacts.recall.error.retryable = true; }],
    ['earlier-timeout-slot-cancelled', 1, probe => { probe.failure = 'cancelled'; }],
    ['stopped-invalid-core', 2, probe => { probe.artifacts.recall.error.code = 'recall_failed'; }],
    ['stopped-invalid-retryable', 2, probe => { probe.artifacts.recall.error.retryable = true; }],
    ['earlier-invalid-slot-cancelled', 2, probe => { probe.failure = 'cancelled'; }],
    ['cancel-override-port', 3, probe => { probe.artifacts.selectFailure.code = 'invalid_model_output'; }],
    ['cancel-override-core', 3, probe => { probe.artifacts.recall.error.code = 'invalid_model_output'; }],
    ['cancel-override-retryable', 3, probe => { probe.artifacts.recall.error.retryable = true; }],
    ['cancel-override-nonfatal', 3, probe => { probe.failure = 'model_timeout'; }],
    ['cancel-override-other-fatal', 3, probe => { probe.failure = 'deadline_exceeded'; }],
  ];
  const observations = [];
  for (const [name, index, operation] of controls) {
    const probe = clone(result.cases[index].probe); operation(probe);
    const mutated = { ...base, result: { ...result, cases: result.cases.map((row, i) => i === index ? { ...row, probe } : row) } };
    observations.push({ name, prepare: (await prepareSourceBundleScoring(mutated)).status, score: (await assess(mutated, prepared)).status });
  }
  console.log('SC_C5_STOPPED_CAUSES=' + JSON.stringify(observations));
  assert.ok(observations.every(row => row.prepare === 'denied' && row.score === 'denied'), JSON.stringify(observations));
  const changedRaw = { ...base, result: { ...result, intents: result.intents.map(intent => intent === timeoutIntent
    ? { ...intent, final: { ...intent.final, failure: 'provider_failure' } } : intent) } };
  assert.equal((await prepareSourceBundleScoring(changedRaw)).status, 'denied'); assert.equal((await assess(changedRaw, prepared)).status, 'denied');
  await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
});

test('actual healthy planner failed/unknown counts and local timeout require coherent closed causes', { timeout: 180000 }, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-scoring-c2-count-failures-' });
  const { prepareSourceBundleComparison } = await import('../source-bundle-store.mjs');
  const { createSourceBundleComparisonManifest, runSourceBundleComparison } = await import('../source-bundle-runner.mjs');
  const preparation = await prepareSourceBundleComparison({ outputRoot: workspace.path }), ledger = await newLedger(workspace);
  let plannerCalls = 0;
  const result = await runSourceBundleComparison({ preparation, ...ledger,
    manifest: createSourceBundleComparisonManifest(preparation.observation), apiKey: 'synthetic_source_scoring_key',
    signal: new AbortController().signal, onRecord() {}, onCheckpoint() {},
    fetchImpl(url, init) {
      assert.ok(url.endsWith('/input_tokens'), 'no generation or answer is dispatched');
      // Method identity and a predeclared ordinal only: no question, rubric,
      // source-family or answer selection drives this failure schedule.
      if (JSON.parse(init.body).text.format.name === 'cairn_source_bundle_plan_rank_v1') {
        plannerCalls++;
        if (plannerCalls === 1) return new Promise(() => {}); // Actual unchanged 30s core/QT settlement.
        if (plannerCalls % 2) throw new Error('synthetic count unavailable');
      }
      return new Response(JSON.stringify({ error: { type: 'synthetic_count_unavailable' } }), { status: 503 });
    } });
  assert.equal(result.status, 'accounted'); assert.equal(result.stopReason, null);
  assert.equal(result.intents.length, 72); assert.equal(result.transitions.length, 72);
  assert.ok(result.transitions.every(row => row.closed && row.healthy));
  assert.equal(result.cases.flatMap(c => Object.values(c.answers)).length, 48);
  assert.ok(result.cases.flatMap(c => Object.values(c.answers)).every(slot => slot.execution === 'failed' && !slot.answerInvoked));
  assert.equal(result.cases.map(c => c.probe).length, 24); assert.ok(result.cases.every(c => c.probe.execution === 'failed'));
  assert.equal(result.resources.reservedMicroUsd, 360000); assert.equal(result.resources.unknownUsageIntents, 72);
  assert.equal(result.resources.unknownUsageReservedMicroUsd, 360000); assert.equal(result.resources.missingFinalRecords, 0);
  const planner = result.intents.filter(intent => intent.ownerKind === 'planner');
  assert.equal(planner.length, 24); assert.equal(planner.filter(i => i.final.outcome === 'failed').length, 12);
  assert.equal(planner.filter(i => i.final.outcome === 'unknown').length, 12);
  assert.ok(planner.every(i => i.final.inputTokens === null && i.final.outputTokens === null && i.final.settlementPersisted));
  const timed = planner[0], timedSlot = result.cases[0].answers['source-bundle'], witness = timedSlot.artifacts.plannerFailure;
  assert.ok(['cancelled', 'deadline_exceeded'].includes(timed.final.failureCode));
  assert.equal(witness.rawCode, timed.final.failureCode); assert.equal(witness.normalizedCode, 'model_timeout');
  assert.equal(witness.normalization, 'healthy-settled-per-call-timeout');
  assert.deepEqual(witness.health, { state: 'consumed', fatalCode: null });
  assert.equal(witness.callerAborted, false); assert.equal(witness.absoluteDeadlineLive, true);
  assert.equal(timedSlot.artifacts.rankFailure.code, 'model_timeout'); assert.equal(timedSlot.failure, 'model_timeout');
  assert.deepEqual(JSON.parse(readFileSync(join(workspace.path, 'comparison', 'result.json'), 'utf8')), result);
  const base = fixtureInput(preparation.observation, result), prepared = await prepareSourceBundleScoring(base), report = await assess(base, prepared);
  assert.equal(prepared.status, 'ready', JSON.stringify(prepared.issues)); assert.equal(report.status, 'assessed');
  assert.equal(report.denominators.qaSlots, 48); assert.equal(report.probes.length, 24);
  assert.equal(report.resources.compliance.status, 'satisfied'); assert.equal(report.gate.promising, false);
  assert.equal(prepared.excludedAnswers.length, 48); assert.equal(prepared.packets[0].payload.items.length, 0);
  console.log('SC_C2_ACTUAL=' + JSON.stringify({ preparation: prepared.status, report: report.status, intents: result.intents.length,
    owners: result.transitions.length, plannerFailed: 12, plannerUnknown: 12, rawTimeout: timed.final.failureCode,
    normalization: witness, reservations: result.resources.reservedMicroUsd, missingFinals: result.resources.missingFinalRecords }));
  const observations = [];
  async function deniedMutation(label, mutate) {
    const corrupted = clone(base); mutate(corrupted);
    const candidate = await prepareSourceBundleScoring(corrupted);
    const scored = await assess(corrupted, candidate.status === 'ready' ? candidate : prepared);
    observations.push({ label, preparation: candidate.status, score: scored.status });
  }
  for (const outcome of ['failed', 'unknown']) {
    const original = planner.find(i => i.final.outcome === outcome && i.final.failureCode === 'provider_failed');
    assert.ok(original);
    for (const failureCode of ['authentication_failed', 'redirect_rejected', 'request_mutated', null, '', 'invented_cause', { code: 'provider_failed' }]) {
      // Cause-only corruption; actual raw wire/body/outcome/history stay fixed.
      await deniedMutation(outcome + ':' + JSON.stringify(failureCode), x => { x.result.intents[original.ordinal - 1].final.failureCode = failureCode; });
    }
    for (const settlementPersisted of [false, null, 'false', 0, {}]) {
      // Settlement-only corruption: retain the real provider failure and its
      // confirmed healthy ledger delta, rather than inventing a failed write.
      await deniedMutation(outcome + ':settlement:' + JSON.stringify(settlementPersisted),
        x => { x.result.intents[original.ordinal - 1].final.settlementPersisted = settlementPersisted; });
    }
  }
  const ordinary = result.intents.find(intent => intent.ownerKind === 'ordinary' && intent.final.outcome === 'failed');
  assert.ok(ordinary);
  for (const failure of [null, '']) await deniedMutation('ordinary-failure:' + JSON.stringify(failure),
    x => { x.result.intents[ordinary.ordinal - 1].final.failure = failure; });
  const witnessMutations = [
    x => { x.plannerFailure = null; },
    x => { x.plannerFailure.rawCode = timed.final.failureCode === 'cancelled' ? 'deadline_exceeded' : 'cancelled'; },
    x => { x.plannerFailure.normalizedCode = 'provider_failed'; },
    x => { x.plannerFailure.normalization = 'unchanged'; },
    x => { x.plannerFailure.health.state = 'ready'; },
    x => { x.plannerFailure.health.fatalCode = 'authentication_failed'; },
    x => { x.plannerFailure.callerAborted = true; },
    x => { x.plannerFailure.absoluteDeadlineLive = false; },
    x => { x.rankFailure.code = 'provider_failed'; },
    x => { x.plannerFailure.extra = true; },
  ];
  for (const [index, mutate] of witnessMutations.entries()) await deniedMutation('timeout-witness:' + index,
    x => mutate(x.result.cases[0].answers['source-bundle'].artifacts));
  await deniedMutation('timeout-slot-cause', x => { x.result.cases[0].answers['source-bundle'].failure = 'provider_failed'; });
  console.log('SC_C2_CORRUPTION=' + JSON.stringify(observations));
  assert.ok(observations.every(row => row.preparation === 'denied' && row.score === 'denied'));
  await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
});
