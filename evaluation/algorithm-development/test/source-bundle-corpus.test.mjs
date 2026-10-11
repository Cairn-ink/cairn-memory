import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { packMixedAnswer } from '../../longmemeval/mixed-answer.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { SOURCE_BUNDLE_VERSION, sourceBundleRoster, sourceBundleLimits, sourceBundleOrders,
  loadSourceBundleCases, validateSourceBundleCases, prepareSourceBundleCase } from '../source-bundle-profile.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sourceUrl = new URL('../source-bundle-cases.json', import.meta.url);
const rubricUrl = new URL('../source-bundle-rubric.json', import.meta.url);
const rawCases = () => JSON.parse(readFileSync(sourceUrl, 'utf8'));
const rawRubric = () => JSON.parse(readFileSync(rubricUrl, 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const sorted = object => Object.keys(object).sort();

test('closed 24-case roster, interleaved families and twelve short source-only sessions', async () => {
  const cases = await loadSourceBundleCases();
  assert.equal(SOURCE_BUNDLE_VERSION, 'source-bundle-qa24-v1');
  assert.deepEqual(cases.map(c => c.id), Array.from({ length: 24 }, (_, i) => `BQ${String(i + 1).padStart(2, '0')}`));
  assert.deepEqual(sourceBundleRoster, cases.map(c => c.id));
  const cycle = ['two-card', 'three-card', 'missing-link', 'scope-time', 'proposal-uncertainty'];
  assert.deepEqual(cases.map(c => c.family), [...Array.from({ length: 20 }, (_, i) => cycle[i % 5]),
    'two-card', 'three-card', 'two-card', 'three-card']);
  assert.deepEqual(Object.fromEntries(cycle.map(f => [f, cases.filter(c => c.family === f).length])),
    { 'two-card': 6, 'three-card': 6, 'missing-link': 4, 'scope-time': 4, 'proposal-uncertainty': 4 });
  assert.equal(cases.flatMap(c => c.sessions).length, 288);
  assert.deepEqual(sourceBundleOrders, [['ordinary', 'source-bundle'], ['source-bundle', 'ordinary']]);
  assert.equal(sourceBundleLimits.physicalRequests, 192);
  for (const c of cases) {
    assert.deepEqual(sorted(c), ['family', 'id', 'question', 'sessions']);
    assert.deepEqual(sorted(c.question), ['date', 'text']);
    assert.equal(c.sessions.length, 12);
    assert.ok(Object.isFrozen(c) && Object.isFrozen(c.sessions));
    let previous = '';
    for (const s of c.sessions) {
      assert.deepEqual(sorted(s), ['eventTime', 'id', 'messages']);
      assert.equal(s.messages.length, 1);
      assert.deepEqual(sorted(s.messages[0]), ['content', 'role']);
      assert.ok(s.messages[0].content.length >= 40 && s.messages[0].content.length <= 360);
      assert.ok(s.eventTime > previous && s.eventTime.slice(0, 10) <= c.question.date);
      previous = s.eventTime;
      assert.ok(Object.isFrozen(s.messages[0]));
    }
  }
});

test('independent raw-source anchor oracle, complete evidence-set references and frozen rubric', () => {
  // Read literal fixture bytes directly, not through the source validator.
  const sources = rawCases(), rubric = rawRubric();
  assert.equal(sha256(readFileSync(sourceUrl)), '90bf9a3e294db114a0a2e264940221d7971a4e41c51af25b43e7453422de4cf9');
  assert.equal(sha256(JSON.stringify(sources)), '74c3664e31d1d35a74a614345c273faa2c7f1845811030fd0868141c74a44e7c');
  assert.equal(sha256(readFileSync(rubricUrl)), '16720244e6c20cb5c9228bbf595d6a8413d2fe16d2156e855e77776a267bf59d');
  assert.equal(sha256(JSON.stringify(rubric)), 'd3e34c207c927831c31e446e59f900d65c284cb29fc11ca242bc1302b896c8f3');
  assert.equal(rubric.version, 'source-bundle-qa24-rubric-v1');
  assert.deepEqual(rubric.cases.map(c => c.id), sources.map(c => c.id));
  let count = 0;
  for (const [ordinal, c] of rubric.cases.entries()) {
    assert.deepEqual(sorted(c), ['acceptableQualifiedAnswer', 'ambiguity', 'anchors', 'answerability',
      'expectedProposition', 'factualClaims', 'id', 'optionalContextClaims', 'provenance', 'requiredEvidenceSets',
      'severeConditions', 'staleUse', 'unanswerabilityReason', 'unsupportedConclusions']);
    const source = sources[ordinal], seen = new Set();
    for (const a of c.anchors) {
      assert.deepEqual(sorted(a), ['end', 'id', 'messageIndex', 'sessionId', 'start', 'text']);
      const session = source.sessions.find(s => s.id === a.sessionId);
      assert.ok(session);
      assert.equal(a.messageIndex, 0);
      assert.ok(Number.isSafeInteger(a.start) && Number.isSafeInteger(a.end));
      assert.ok(a.start >= 0 && a.end > a.start && a.end <= session.messages[0].content.length);
      assert.equal(session.messages[0].content.slice(a.start, a.end), a.text);
      assert.ok(!seen.has(a.id)); seen.add(a.id); count++;
    }
    const anchorCount = ['three-card', 'scope-time', 'proposal-uncertainty'].includes(source.family) ? 3 : 2;
    const offsets = anchorCount === 3 ? [0, 4, 8] : [0, 5];
    assert.deepEqual(c.anchors.slice(0, anchorCount).map(a => Number(a.sessionId.slice(-2))),
      offsets.map(offset => (ordinal * 5 + offset) % 12 + 1).sort((a, b) => a - b));
    assert.equal(c.anchors.length, anchorCount + (source.family === 'missing-link' || c.id === 'BQ20' ? 1 : 0));
    for (const set of c.requiredEvidenceSets) {
      assert.deepEqual(sorted(set), ['anchorIds', 'name']);
      assert.ok(set.name.length && set.anchorIds.length);
      assert.equal(new Set(set.anchorIds).size, set.anchorIds.length);
      assert.ok(set.anchorIds.every(id => seen.has(id)));
    }
    for (const claim of c.optionalContextClaims) {
      assert.deepEqual(sorted(claim), ['anchorIds', 'claim']);
      assert.ok(claim.claim.length && claim.anchorIds.length);
      assert.ok(claim.anchorIds.every(id => seen.has(id)));
    }
    if (['two-card', 'three-card'].includes(source.family)) {
      assert.equal(c.requiredEvidenceSets.length, 1);
      assert.equal(new Set(c.anchors.map(a => a.sessionId)).size, anchorCount);
      assert.deepEqual(c.requiredEvidenceSets[0].anchorIds, c.anchors.map(a => a.id));
    }
    assert.ok(c.expectedProposition && c.acceptableQualifiedAnswer && c.provenance && c.ambiguity && c.staleUse);
    assert.ok(c.factualClaims.length && c.unsupportedConclusions.length && c.severeConditions.length);
    if (source.family === 'missing-link') assert.ok(c.unanswerabilityReason && c.answerability === 'qualified');
  }
  assert.equal(count, 67);
  assert.deepEqual(rubric.cases[9].requiredEvidenceSets.map(s => s.anchorIds),
    [['BQ10-A1'], ['BQ10-A3']]);
  for (const index of [2, 7, 12, 17]) assert.deepEqual(rubric.cases[index].requiredEvidenceSets.map(s => s.anchorIds),
    [[`${rubric.cases[index].id}-A1`], [`${rubric.cases[index].id}-A3`]]);
  for (const [index, anchor] of [[4, 1], [8, 2], [18, 2]])
    assert.deepEqual(rubric.cases[index].requiredEvidenceSets[0].anchorIds, [`${rubric.cases[index].id}-A${anchor}`]);
  assert.deepEqual(rubric.cases[14].requiredEvidenceSets.map(s => s.anchorIds), [['BQ15-A1'], ['BQ15-A3']]);
  assert.deepEqual(rubric.cases[19].requiredEvidenceSets.map(s => s.anchorIds), [['BQ20-A3'], ['BQ20-A4']]);
});

test('literal semantic controls preserve association, scope, time, attribution and adoption distinctions', () => {
  // These authored literal controls expose edits for human review, not semantic proof.
  const c = rawCases(), r = rawRubric().cases;
  assert.equal(c[0].sessions[0].messages[0].content,
    'Nara is responsible for crate R17 in the Sable quilt exhibit; her assignment is to that crate, not the loose display rolls.');
  assert.equal(c[0].sessions[5].messages[0].content,
    'For crate R17 in the Sable quilt exhibit, the handling sheet requires a cotton sleeve whenever its lid is opened.');
  assert.equal(c[1].sessions[5].messages[0].content,
    'For the observatory night pilot, badge Orbit-6 is assigned to controller D4; badge Orbit-9 is assigned to controller D7.');
  assert.equal(c[1].sessions[9].messages[0].content,
    'Controller D4 in the observatory night pilot logs at a 22-minute cadence; the interval belongs to D4, not to a person.');
  assert.equal(r[2].unanswerabilityReason, 'No source links Leena’s booking to Q52 or any other tasting receipt.');
  assert.equal(c[3].sessions[7].messages[0].content,
    'The Bracken pump supervisor revised the western shaft test pressure to 65 kPa for inspections from October 9 onward.');
  assert.equal(c[4].sessions[4].messages[0].content,
    'For Fern, a designer later proposed an amber wash as an experiment; the note says the proposal awaits the lighting lead’s decision.');
  assert.equal(c[8].sessions[4].messages[0].content,
    'The Quince northern-block sensor failed on October 7; the manager says the 18-day plan needs reconfirmation, without choosing a replacement.');
  assert.equal(c[9].sessions[5].messages[0].content,
    'The Velvet customer quoted a draft request for V31 saying "Please guarantee 10 am"; the courier has not accepted that draft request.');
  assert.equal(c[14].sessions[6].messages[0].role, 'assistant');
  assert.equal(c[14].sessions[6].messages[0].content,
    'I suggest gate A for the Kite sailing lesson because it is closer to the boats; this is advice, and I have no approval from the coordinator.');
  assert.equal(c[17].sessions[6].messages[0].content,
    'Nimbus recording M3 attributes "I prefer silent introductions" to a guest labeled Jun; its record does not identify that guest as Ada.');
  assert.equal(c[18].sessions[10].messages[0].content,
    'Vale university’s spring extension uses protocol M7-S, revised on October 8 to export unblinded group labels.');
  assert.equal(c[19].sessions[11].messages[0].content,
    'The Linden gardener is considering a 14-day interval after the hose failure but explicitly has not adopted a new fertilizing schedule.');
  assert.equal(r[23].expectedProposition, 'Alder’s U8 permit authorizes N14, requiring 48 hours of curing before washing.');
  for (const i of [2, 7, 12, 17]) {
    assert.match(r[i].expectedProposition, /supplied evidence/u);
    assert.match(r[i].ambiguity, /does not prove global absence/u);
  }
});

test('all cases prepare as twelve original-role dated windows with canonical question binding', async () => {
  const cases = await loadSourceBundleCases();
  for (const source of cases) {
    const prepared = await prepareSourceBundleCase(cases, source.id), plan = prepared.plan;
    assert.deepEqual(sorted(prepared.question), ['date', 'text']);
    assert.deepEqual(prepared.question, { text: source.question.text, date: '2026-10-12 23:59' });
    assert.equal(prepared.question.text, plan.originalQuestion.text);
    assert.equal(prepared.question.date, plan.canonicalQuestionDate);
    // Actual consumer integration, with an explicit deterministic offline counter.
    // This checks the question contract, not provider token fit or QA quality.
    const packed = packMixedAnswer({ question: prepared.question, units: [],
      countTokens: text => Math.ceil(Buffer.byteLength(text, 'utf8') / 4) });
    assert.deepEqual(JSON.parse(packed.request.messages[1].content).currentQuestion,
      { text: source.question.text, date: '2026-10-12 23:59' });
    assert.equal(plan.counts.windows, 12);
    assert.equal(plan.counts.originalTurns, 12);
    assert.equal(plan.counts.excludedFutureSessions, 0);
    assert.equal(plan.cairnPlan.batches.length, 12);
    assert.ok(!JSON.stringify(prepared).includes('"family":'));
    assert.ok(!JSON.stringify(prepared).includes('"expectedProposition":'));
    for (const [index, batch] of plan.cairnPlan.batches.entries()) {
      const message = source.sessions[index].messages[0], window = batch.indexedWindows[0];
      assert.equal(batch.captureInput.messages.length, 1);
      assert.equal(batch.indexedWindows.length, 1);
      assert.equal(window.role, message.role);
      assert.ok(window.content.length <= 800);
      assert.ok(window.content.includes(message.content));
      const time = source.sessions[index].eventTime.slice(0, 16).replace('T', ' ');
      assert.equal(window.content, `[session-date: ${time}; clock: dataset-local] source{${message.content} }`);
      assert.equal(plan.renderedHistory.sessions[index].date, time);
      assert.equal(plan.originMap.turns[index].normalizationChanged, false);
      assert.equal(prepared.sourceProvenance[index].originalSessionId, source.sessions[index].id);
      assert.equal(prepared.sourceProvenance[index].eventTime, source.sessions[index].eventTime);
      assert.equal(prepared.sourceProvenance[index].role, message.role);
    }
  }
  await assert.rejects(prepareSourceBundleCase(cases, 'BQ25'), /invalid_source_bundle_case/u);
});

test('schema rejects malformed dates, roles, unknown fields, duplicates, overflow and bad Unicode', () => {
  const mutations = [
    c => c.pop(), c => c.push(c[0]), c => { c[1].id = 'BQ01'; },
    c => { c[0].family = 'answerable'; }, c => { c[0].question.answer = 'cotton'; },
    c => { c[0].question.date = '2026-02-30'; }, c => { c[0].question.date = '2026-1-12'; },
    c => { c[0].question.text = ''; }, c => { c[0].question.text = 'x'.repeat(401); },
    c => { c[0].sessions.pop(); }, c => { c[0].sessions.push(c[0].sessions[0]); },
    c => { c[0].sessions[1].id = c[0].sessions[0].id; },
    c => { c[0].sessions[1].eventTime = c[0].sessions[0].eventTime; },
    c => { c[0].sessions[0].eventTime = '2026-10-10T25:00:00.000Z'; },
    c => { c[0].sessions[0].eventTime = '2026-10-13T08:00:00.000Z'; },
    c => { c[0].sessions[0].eventTime = '2026-10-10T08:00:00+00:00'; },
    c => { c[0].sessions[0].messages.push(c[0].sessions[0].messages[0]); },
    c => { c[0].sessions[0].messages[0].role = 'system'; },
    c => { c[0].sessions[0].messages[0].anchor = 'BQ01-A1'; },
    ...['x'.repeat(39), 'x'.repeat(361), 'x'.repeat(40) + '\n', '\ud800' + 'x'.repeat(40),
      'x'.repeat(40) + '\u0000', 'x'.repeat(40) + '\u200b',
      'A synthetic token is sk-' + 'a'.repeat(40)].map(content => c => { c[0].sessions[0].messages[0].content = content; }),
  ];
  for (const mutate of mutations) { const c = rawCases(); mutate(c); assert.throws(() => validateSourceBundleCases(c)); }
  const unicode = rawCases(); unicode[0].sessions[0].messages[0].content = '🔭 '.repeat(40).trim();
  assert.equal(validateSourceBundleCases(unicode)[0].sessions[0].messages[0].content.length, 119);
});

test('descriptor-safe rejection does not invoke getters or toJSON; dense prototype hazards rejected', () => {
  let invoked = 0;
  const poisons = [
    c => Object.defineProperty(c[0], 'question', { enumerable: true, get() { invoked++; throw new Error('getter'); } }),
    c => Object.defineProperty(c[0].sessions[0].messages[0], 'content', { enumerable: true, get() { invoked++; return 'x'.repeat(80); } }),
    c => Object.defineProperty(c, '0', { enumerable: true, get() { invoked++; return {}; } }),
    c => { c[0].toJSON = () => { invoked++; return {}; }; },
    c => { Object.setPrototypeOf(c[0], { toJSON() { invoked++; return {}; } }); },
    c => { Object.setPrototypeOf(c[0].question, { text: c[0].question.text }); delete c[0].question.text; },
    c => { delete c[0].sessions[0]; }, c => { c.extra = true; },
    c => { c[0][Symbol('hidden')] = true; },
    c => { Object.defineProperty(c[0], 'hidden', { value: true }); },
    c => { c[0].question = c[0]; }, c => { c[0].sessions.length = 1000000; },
    c => { Object.defineProperty(c[0], '__proto__', { value: {}, enumerable: true }); },
  ];
  for (const poison of poisons) { const c = rawCases(); poison(c); assert.throws(() => validateSourceBundleCases(c)); }
  assert.equal(invoked, 0);
});

test('loading rejects byte drift and preparation rejects semantically well-shaped value drift', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-source-bundle-drift-' });
  const file = join(workspace.path, 'sources.json');
  writeFileSync(file, readFileSync(sourceUrl));
  assert.equal((await loadSourceBundleCases(file)).length, 24);
  writeFileSync(file, `${readFileSync(sourceUrl, 'utf8')} `);
  await assert.rejects(loadSourceBundleCases(file), /source_bundle_hash_drift/u);
  writeFileSync(file, 'x'.repeat(sourceBundleLimits.sourceBytes + 1));
  await assert.rejects(loadSourceBundleCases(file), /source_bundle_limit/u);
  const changed = rawCases(); changed[0].question.text = 'What handling sleeve does Nara’s exhibit assignment require?';
  assert.equal(validateSourceBundleCases(changed).length, 24);
  await assert.rejects(prepareSourceBundleCase(changed, 'BQ01'), /source_bundle_hash_drift/u);
});

test('source-facing import graph contains no evaluator, closed runner, SQLite or optional adapter', () => {
  const visited = new Set();
  const walk = url => {
    const filename = fileURLToPath(url);
    if (visited.has(filename)) return;
    visited.add(filename);
    const code = readFileSync(url, 'utf8');
    const matches = [...code.matchAll(/(?:from\s+|import\(\s*|import\s+)['"]([^'"]+)['"]/gu)];
    for (const match of matches) {
      assert.ok(match[1] !== 'node:sqlite');
      if (match[1].startsWith('node:')) continue;
      assert.ok(match[1].startsWith('.'), `non-built-in dependency ${match[1]}`);
      assert.doesNotMatch(match[1], /rubric|scor|runner|transport|adapter|cases\.json/u);
      walk(new URL(match[1], url));
    }
  };
  walk(new URL('../source-bundle-profile.mjs', import.meta.url));
  assert.ok([...visited].some(p => p.endsWith('/longmemeval/mixed-source.mjs')));
  assert.ok([...visited].every(p => !p.endsWith('/core/index.mjs')));
});

for (const mode of ['success', 'assertion', 'setup']) {
  test(`owned test scratch is removed after ${mode} subprocess`, t => {
    const workspace = createTestWorkspace(t, { prefix: 'cairn-source-bundle-lifecycle-' });
    const child = join(workspace.path, 'probe.mjs');
    const helper = new URL('../../../tools/testing/workspace.mjs', import.meta.url).href;
    writeFileSync(child, `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { createTestWorkspace } from ${JSON.stringify(helper)};\ntest('owned probe', t => {\n const w=createTestWorkspace(t,{prefix:'cairn-source-bundle-child-'});\n console.log('OWNED_SCRATCH='+w.path);\n ${mode === 'success' ? 'assert.ok(true);' : mode === 'assertion' ? "assert.fail('intentional assertion failure');" : "throw new Error('intentional setup failure');"}\n});\n`);
    const result = spawnSync(process.execPath, [join(root, 'tools/testing/run.mjs'), child], {
      cwd: root, encoding: 'utf8', timeout: 30000,
      env: { PATH: process.env.PATH, TMPDIR: workspace.path, TMP: workspace.path, TEMP: workspace.path,
        NODE_DISABLE_COMPILE_CACHE: '1' },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, mode === 'success' ? 0 : 1, result.stdout + result.stderr);
    const scratch = /OWNED_SCRATCH=(.*)/u.exec(result.stdout)?.[1].trim();
    assert.ok(scratch);
    assert.equal(existsSync(scratch), false);
  });
}
