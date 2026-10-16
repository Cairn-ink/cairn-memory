import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after } from 'node:test';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStoreError } from '../../../core/validation.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { runRoleStratifiedQa, parseRoleStratifiedQaFixture, roleStratifiedQaCapture,
  ROLE_STRATIFIED_ANSWER_INSTRUCTION } from '../role-stratified-qa.mjs';

const [major, minor] = process.versions.node.split('.').map(Number);
const supportsSqlite = major > 22 || major === 22 && minor >= 16;
const DatabaseSync = supportsSqlite ? (await import('node:sqlite')).DatabaseSync : null;
const sqliteTest = (name, callback) => test(name,
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, callback);
const ambientParent = tmpdir();
// Test files run concurrently under one invocation TMPDIR. Inventory and fault
// injection must inspect only this file's stores, never another caller's store.
const fileWorkspace = createTestWorkspace(null, { prefix: 'role-stratified-runner-test-' });
const previousTmpdir = process.env.TMPDIR;
after(async () => {
  try { assert.deepEqual(readdirSync(fileWorkspace.path), [], 'all owned runner scratch must already be removed'); }
  finally {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
    await fileWorkspace.cleanup();
    assert.equal(existsSync(fileWorkspace.path), false);
  }
});
process.env.TMPDIR = fileWorkspace.path;

const item = (content, sourceIndices) => ({ content, kind: 'context', confidence: 0.8, sourceIndices });
const row = (id = '000000000001', messages = [{ role: 'user', content: 'I adopted Tuesday for the trip.' },
  { role: 'assistant', content: 'The ferry leaves at nine.' }], question = 'When is the trip?') => ({ id, messages, question });
const json = (cases = [row()]) => JSON.stringify({ version: 'role-stratified-qa-v1', cases });
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');
const classify = ({ input }) => ({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) });
const modelFor = (overrides = {}) => ({ contextWindow: 8192, countTokens: () => 1,
  extract: () => ({ items: [item('User chose Tuesday.', [0]), item('Assistant says nine.', [1])] }),
  extractRoleStratified: () => ({ userItems: [item('User chose Tuesday.', [0])], assistantItems: [item('Assistant says nine.', [1])] }),
  classify, ...overrides });
const run = (options = {}) => runRoleStratifiedQa({ fixtureJson: json(), model: modelFor(),
  answer: () => ({ answer: 'Tuesday.' }), onRecord() {}, assertActive() {}, ...options });
const workspaces = () => readdirSync(tmpdir()).filter(name => name.startsWith('role-stratified-qa-')).sort();
const newlyOwnedStore = before => {
  const current = workspaces().filter(name => !before.includes(name));
  assert.equal(current.length, 1);
  return join(tmpdir(), current[0], 'memory.sqlite');
};

test('Q1 pure source preflight rejects malformed/noncanonical fixtures before all callbacks', async () => {
  const fixture = parseRoleStratifiedQaFixture(json());
  assert.ok(Object.isFrozen(fixture.cases[0].messages[0]));
  assert.equal(roleStratifiedQaCapture(fixture.cases[0]).sessionId, 'case-000000000001');
  const bad = [undefined, {}, '', '{', json([row(), row()]), json([row('bad')]),
    JSON.stringify({ version: 'role-stratified-qa-v1', cases: [row()], rubric: {} }),
    json([row('000000000001', [{ role: 'user', content: ' padded ' }])]),
    json([row('000000000001', [{ role: 'user', content: '\ud800' }])]),
    json([row('000000000001', [{ role: 'user', content: 'Hidden\u0001control' }])]),
    json([row('000000000001', [{ role: 'assistant', content: 'A' }, { role: 'user', content: 'B' }])]),
    json([row('000000000001', [{ role: 'user', content: 'Ａ' }])]),
    json([row('000000000001', undefined, ' question ')]),
    json([row('000000000001', [{ role: 'user', content: 'x'.repeat(4001) }])]),
    json([row('000000000001', Array.from({ length: 7 }, () => ({ role: 'user', content: 'A' })))]),
  ];
  const before = workspaces();
  for (const fixtureJson of bad) await assert.rejects(run({ fixtureJson,
    onRecord() { assert.fail('observer'); }, assertActive() { assert.fail('guard'); } }), { code: 'invalid_fixture' });
  assert.deepEqual(workspaces(), before);
});

sqliteTest('Q2/Q3 independent first extractions alternate; real cold stores preserve exact receipts and compiled output', async () => {
  const records = [], dispatch = [];
  const report = await run({ fixtureJson: json([row(), row('000000000002')]), onRecord(record) {
    records.push(record);
    if (record.kind === 'model-start') dispatch.push([record.caseId, record.arm, record.phase]);
  } });
  assert.equal(report.status, 'completed');
  assert.equal(report.fixtureVersion, 'role-stratified-qa-v1');
  assert.equal(report.fixtureSha256, sha256(json([row(), row('000000000002')])));
  assert.equal(report.completedArms, 4);
  assert.deepEqual(report.counts, { extract: 4, classify: 4, answer: 4 });
  assert.deepEqual(dispatch.filter(entry => entry[2] === 'extract').map(entry => entry[1]), ['baseline', 'candidate', 'candidate', 'baseline']);
  assert.notEqual(report.rows[0].baseline.extraction.request.system, report.rows[0].candidate.extraction.request.system);
  assert.deepEqual(report.rows[0].candidate.extraction.output.items, [item('User chose Tuesday.', [0]), item('Assistant says nine.', [1])]);
  assert.deepEqual(report.rows[0].candidate.extraction.groups, { userItems: { start: 0, count: 1 }, assistantItems: { start: 1, count: 1 } });
  for (const result of report.rows) for (const name of result.order) {
    const arm = result[name];
    assert.equal(arm.cleanupCompleted, true);
    assert.equal(arm.coldRead.verified, true);
    assert.deepEqual(arm.coldRead.generationMethods, []);
    assert.deepEqual(arm.coldRead.memories, arm.admittedMemories);
    assert.equal(arm.admittedMemories.length, 2);
    assert.deepEqual(arm.admittedMemories.flatMap(memory => memory.receipts).map(bound => bound.windowIndex).sort(), [0, 1]);
    for (const memory of arm.admittedMemories) for (const bound of memory.receipts) {
      assert.equal(bound.receipt.client, 'role-stratified-qa');
      assert.equal(bound.receipt.sessionId, `case-${result.id}`);
      assert.equal(bound.receipt.eventId, `source-${bound.messageIndex}`);
      assert.equal(bound.start, 0); assert.equal(bound.end, bound.receipt.excerpt.length);
    }
    assert.equal(arm.packed.request.system, ROLE_STRATIFIED_ANSWER_INSTRUCTION);
    assert.deepEqual(arm.packed.request.input.sources.map(source => Object.keys(source)), [['sourceId', 'speaker', 'text'], ['sourceId', 'speaker', 'text']]);
    assert.equal(JSON.stringify(arm.extraction.request).includes('When is the trip?'), false);
    assert.equal(JSON.stringify(arm.packed.request).includes('User chose Tuesday.'), false);
  }
  assert.equal(records.filter(record => record.kind === 'run-final').length, 1);
  assert.equal(records.filter(record => record.kind === 'source-bound').length, 4);
});

sqliteTest('Q3 deduplicated admissions retain their own union of receipts rather than proposal ordering', async () => {
  const report = await run({ model: modelFor({
    extract: () => ({ items: [item('Same claim.', [1]), item('Same claim.', [0])] }),
    extractRoleStratified: () => ({ userItems: [item('Same claim.', [0])], assistantItems: [item('Same claim.', [1])] }),
  }) });
  assert.equal(report.status, 'completed');
  for (const name of report.rows[0].order) {
    const arm = report.rows[0][name];
    assert.equal(arm.status, 'completed', JSON.stringify(arm));
    assert.equal(arm.admittedMemories.length, 1);
    assert.equal(arm.admittedMemories[0].receipts.length, 2);
    assert.deepEqual(arm.packed.retainedIds, ['window-0', 'window-1']);
  }
});

sqliteTest('Q3/Q4 multiple windows retain exact UTF-16 coordinates, repeated-source dedup and original source order', async () => {
  const content = 'a'.repeat(799) + '😀' + 'b'.repeat(120);
  const messages = [{ role: 'user', content }, { role: 'assistant', content: 'Useful assistant information.' }];
  const report = await run({ fixtureJson: json([row('000000000001', messages)]), model: modelFor({
    extract: () => ({ items: [item('Later window.', [2, 1]), item('Earlier window.', [0, 1])] }),
    extractRoleStratified: () => ({ userItems: [item('Earlier window.', [1, 0])], assistantItems: [item('Later window.', [2, 1])] }),
  }) });
  assert.equal(report.completedArms, 2, JSON.stringify(report));
  for (const name of report.rows[0].order) {
    const arm = report.rows[0][name];
    assert.deepEqual(arm.packed.retainedIds, ['window-0', 'window-1', 'window-2']);
    const bound = arm.admittedMemories.flatMap(memory => memory.receipts).find(source => source.windowIndex === 1);
    assert.equal(bound.messageIndex, 0);
    assert.equal(bound.start, 799);
    assert.equal(bound.end, content.length);
    assert.equal(bound.receipt.excerpt, content.slice(799));
    assert.deepEqual(arm.packed.request.input.sources.map(source => source.sourceId), arm.packed.retainedIds);
  }
});

sqliteTest('Q4 exact complete answer request budget skips overflowing whole windows and still tries later sources', async () => {
  const messages = [{ role: 'user', content: 'First source.' }, { role: 'assistant', content: 'Overflowing source.' },
    { role: 'user', content: 'Last source.' }];
  const counts = [];
  const countTokens = value => {
    let parsed;
    try { parsed = JSON.parse(value); } catch { return 1; }
    if (parsed.maxOutputTokens !== 512) return 1;
    counts.push(value);
    return parsed.input.sources.some(source => source.sourceId === 'window-1') ? 4001
      : parsed.input.sources.length === 2 ? 4000 : 3990;
  };
  const report = await run({ fixtureJson: json([row('000000000001', messages)]), model: modelFor({ countTokens,
    extract: () => ({ items: [item('All sources.', [2, 0, 1])] }),
    extractRoleStratified: () => ({ userItems: [item('All sources.', [2, 0, 1])], assistantItems: [] }),
  }) });
  assert.equal(report.completedArms, 2, JSON.stringify(report));
  for (const name of report.rows[0].order) {
    const packed = report.rows[0][name].packed;
    assert.equal(packed.inputTokens, 4000);
    assert.deepEqual(packed.includedIds, ['window-0', 'window-2']);
    assert.deepEqual(packed.omittedIds, ['window-1']);
    assert.equal(packed.omittedBytes, Buffer.byteLength(messages[1].content));
    assert.equal(packed.request.input.sources[1].text, messages[2].content);
    assert.equal(counts.includes(JSON.stringify(packed.request)), true);
  }
});

sqliteTest('Q2/Q4 assistant-only useful information and empty memories both reach the same source-only answer policy', async () => {
  const cases = [row('000000000001', [{ role: 'assistant', content: 'Take platform four.' }]), row('000000000002')];
  let invocation = 0;
  const report = await run({ fixtureJson: json(cases), model: modelFor({
    extract: () => ({ items: invocation++ === 0 ? [item('Platform four.', [0])] : [] }),
    extractRoleStratified: () => ({ userItems: [], assistantItems: invocation++ === 1 ? [item('Platform four.', [0])] : [] }),
  }), answer: ({ input }) => ({ answer: input.sources.length ? 'Platform four.' : 'Unknown.' }) });
  assert.equal(report.completedArms, 4);
  assert.equal(report.rows[0].candidate.packed.request.input.sources[0].speaker, 'assistant');
  assert.deepEqual(report.rows[1].baseline.packed.request.input.sources, []);
  assert.equal(report.rows[1].candidate.answer, 'Unknown.');
  assert.equal(report.rows[1].candidate.capture.value.classification.status, 'skipped');
  assert.deepEqual(report.counts, { extract: 4, classify: 2, answer: 4 });
});

sqliteTest('Q3/Q5 failed classification preserves admitted claims and cold receipts, isolates accounted failures', async () => {
  let calls = 0;
  const report = await run({ model: modelFor({ classify(request) {
    if (calls++ === 0) throw new MemoryStoreError('classification_failed');
    return classify(request);
  } }) });
  assert.equal(report.status, 'completed');
  const baseline = report.rows[0].baseline;
  assert.equal(baseline.status, 'failed');
  assert.equal(baseline.failedPhase, 'classify');
  assert.equal(baseline.admittedMemories.length, 2);
  assert.equal(baseline.coldRead.verified, true);
  assert.equal(baseline.answer, null);
  assert.equal(report.rows[0].candidate.status, 'completed');
  assert.deepEqual(report.counts, { extract: 2, classify: 2, answer: 1 });
});

sqliteTest('Q5 malformed extraction/answer output is an accounted arm failure without retry', async () => {
  let answers = 0;
  const report = await run({ model: modelFor({ extract: () => ({ items: [item('Bad source.', [999])] }) }),
    answer() { answers++; return { unexpected: 'bad answer' }; } });
  assert.equal(report.status, 'completed');
  assert.equal(report.failedArms, 2);
  assert.equal(report.rows[0].baseline.reason, 'invalid_model_output');
  assert.equal(report.rows[0].candidate.reason, 'invalid_model_output');
  assert.equal(answers, 1);
  assert.deepEqual(report.counts, { extract: 2, classify: 1, answer: 1 });
});

sqliteTest('Q5 unknown transport/operator error stops whole run and retains every not-run denominator row', async () => {
  const before = workspaces();
  const records = [];
  const report = await run({ fixtureJson: json([row(), row('000000000002')]),
    model: modelFor({ extract() { throw new Error('secret transport details'); } }), onRecord(record) { records.push(record); } });
  assert.equal(report.status, 'stopped');
  assert.equal(report.fixtureVersion, 'role-stratified-qa-v1');
  assert.equal(report.fixtureSha256, sha256(json([row(), row('000000000002')])));
  assert.equal(report.reason, 'model_dispatch_failed');
  assert.equal(report.caseCount, 2); assert.equal(report.armCount, 4);
  assert.equal(report.failedArms, 1); assert.equal(report.notRunArms, 3);
  assert.equal(records.filter(record => record.kind === 'arm-final').length, 4);
  assert.equal(records.filter(record => record.kind === 'case-final').length, 2);
  assert.equal(JSON.stringify(report).includes('secret transport'), false);
  assert.deepEqual(workspaces(), before);
});

sqliteTest('Q5 observer mutations are detached and received outputs survive a post-call guard stop', async () => {
  const detached = await run({ onRecord(record) {
    if (record.kind === 'model-output') record.output.items = [];
    if (record.kind === 'source-bound') record.admittedMemories.length = 0;
  } });
  assert.equal(detached.rows[0].baseline.admittedMemories.length, 2);
  let settled = false;
  const report = await run({ model: modelFor({ extract() { settled = true; return { items: [item('Received claim.', [0])] }; } }),
    assertActive() { if (settled) throw new Error('stop after settlement'); } });
  assert.equal(report.status, 'stopped');
  assert.equal(report.reason, 'assert_active_failed');
  assert.equal(report.rows[0].baseline.extraction.proposal.items[0].content, 'Received claim.');
  assert.equal(report.rows[0].baseline.cleanupCompleted, true);
  assert.equal(report.counts.extract, 1);
});

sqliteTest('Q5 observer throws or returns a Promise; guard async return stops before dispatch', async () => {
  for (const onRecord of [() => { throw new Error('observer'); }, async () => {}]) {
    const report = await run({ onRecord });
    assert.equal(report.reason, 'record_failed');
    assert.equal(report.counts.extract, 0);
    assert.equal(report.rows[0].baseline.cleanupCompleted, true);
  }
  const report = await run({ assertActive: async () => {} });
  assert.equal(report.reason, 'assert_active_failed');
  assert.equal(report.notRunArms, 2);
});

sqliteTest('Q5 accessors and toJSON in model output never execute', async () => {
  let reads = 0;
  const output = {};
  Object.defineProperty(output, 'items', { enumerable: true, get() { reads++; throw new Error('model getter'); } });
  const report = await run({ model: modelFor({ extract: () => output,
    extractRoleStratified: () => ({ userItems: [], assistantItems: [], toJSON() { reads++; return {}; } }) }) });
  assert.equal(reads, 0);
  assert.equal(report.failedArms, 2);
  assert.equal(report.rows[0].baseline.reason, 'invalid_model_output');
  assert.equal(report.rows[0].candidate.reason, 'invalid_model_output');
});

sqliteTest('Q6 cancelled port and answer timeout are bounded accounted failures with cleanup', async t => {
  const originalSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => originalSetTimeout(callback, delay === 60_000 ? 5 : delay, ...args));
  const before = workspaces();
  const report = await run({ model: modelFor({ extract() { const error = new Error('cancel'); error.name = 'AbortError'; throw error; } }),
    answer: () => new Promise(() => {}) });
  assert.equal(report.status, 'completed');
  assert.equal(report.rows[0].baseline.reason, 'model_cancelled');
  assert.equal(report.rows[0].candidate.reason, 'model_timeout');
  assert.equal(report.failedArms, 2);
  assert.deepEqual(workspaces(), before);
});

sqliteTest('Q3 foreign and missing retained receipt identity stop the entire run before answering', async () => {
  for (const sql of ["UPDATE receipts SET session_id = 'foreign-session'", 'DELETE FROM receipts']) {
    const before = workspaces();
    let altered = false;
    const report = await run({ onRecord(record) {
      if (!altered && record.kind === 'model-output' && record.phase === 'classify') {
        altered = true;
        const db = new DatabaseSync(newlyOwnedStore(before));
        try { db.exec(sql); } finally { db.close(); }
      }
    } });
    assert.equal(altered, true);
    assert.equal(report.status, 'stopped');
    assert.equal(report.reason, 'source_binding_failed');
    assert.equal(report.counts.answer, 0);
    assert.equal(report.notRunArms, 1);
    assert.deepEqual(workspaces(), before);
  }
});

sqliteTest('test fault injection excludes a concurrently created ambient workspace with the same runner prefix', async t => {
  const before = workspaces();
  let ambient, altered = false;
  const report = await run({ onRecord(record) {
    if (!ambient && record.kind === 'model-start' && record.phase === 'extract') {
      ambient = createTestWorkspace(t, { prefix: 'role-stratified-qa-', parent: ambientParent });
    }
    if (!altered && record.kind === 'model-output' && record.phase === 'classify') {
      const db = new DatabaseSync(newlyOwnedStore(before));
      try { db.exec("UPDATE receipts SET session_id = 'foreign-session'"); altered = true; }
      finally { db.close(); }
    }
  } });
  assert.equal(report.reason, 'source_binding_failed');
  assert.equal(altered, true);
  assert.equal(existsSync(ambient.path), true);
  assert.deepEqual(workspaces(), before);
});

sqliteTest('Q3 cold reopen detects changed memory content/revision and receipt disagreement', async t => {
  const originalClose = DatabaseSync.prototype.close;
  for (const sql of ["UPDATE memories SET content = 'Changed during reopen'", 'UPDATE memories SET revision = revision + 1',
    "UPDATE receipts SET client = 'foreign-client'"]) {
    const before = workspaces();
    let path, altered = false;
    const mock = t.mock.method(DatabaseSync.prototype, 'close', function () {
      const result = originalClose.call(this);
      if (path && !altered && existsSync(path)) {
        altered = true;
        const db = new DatabaseSync(path);
        try { db.exec(sql); } finally { originalClose.call(db); }
      }
      return result;
    });
    const report = await run({ onRecord(record) {
      if (record.kind === 'model-output' && record.phase === 'classify') path = newlyOwnedStore(before);
    } });
    mock.mock.restore();
    assert.equal(altered, true);
    assert.equal(report.status, 'stopped');
    assert.equal(report.reason, 'source_binding_failed');
    assert.equal(report.counts.answer, 0);
    assert.equal(report.rows[0].baseline.admittedMemories.length, 2);
    assert.equal(report.rows[0].baseline.coldRead, null);
    assert.deepEqual(workspaces(), before);
  }
});

sqliteTest('Q5 cleanup failure is fatal and visible while owned workspace removal is still attempted', async t => {
  const originalClose = DatabaseSync.prototype.close;
  let injected = false;
  t.mock.method(DatabaseSync.prototype, 'close', function () {
    originalClose.call(this);
    if (!injected) { injected = true; throw new Error('synthetic close failure'); }
  });
  const before = workspaces();
  const report = await run();
  assert.equal(injected, true);
  assert.equal(report.status, 'stopped');
  // A writer-close failure is a persistence stop, and deferred cleanup retries it.
  assert.equal(report.reason, 'cleanup_failed');
  assert.equal(report.rows[0].baseline.cleanupCompleted, false);
  assert.equal(report.notRunArms, 1);
  assert.deepEqual(workspaces(), before);
});

sqliteTest('Q3 indistinguishable repeated windows fail closed instead of guessing an offset', async () => {
  const report = await run({ fixtureJson: json([row('000000000001', [{ role: 'user', content: 'a'.repeat(1600) }])]),
    model: modelFor({ extract: () => ({ items: [item('One repeated source.', [0])] }) }) });
  assert.equal(report.status, 'stopped');
  assert.equal(report.reason, 'source_binding_failed');
  assert.equal(report.counts.answer, 0);
});

sqliteTest('Q6 core extraction and classification deadline signals remain model_timeout, with no retry', async t => {
  const originalSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => originalSetTimeout(callback, delay > 25_000 && delay <= 30_000 ? 5 : delay, ...args));
  const report = await run({ model: modelFor({
    extract: () => new Promise(() => {}), classify: () => new Promise(() => {}),
  }) });
  assert.equal(report.status, 'completed');
  assert.equal(report.failedArms, 2);
  assert.equal(report.rows[0].baseline.reason, 'model_timeout');
  assert.equal(report.rows[0].candidate.reason, 'model_timeout');
  assert.equal(report.rows[0].candidate.admittedMemories.length, 2);
  assert.equal(report.rows[0].candidate.coldRead.verified, true);
  assert.deepEqual(report.counts, { extract: 2, classify: 1, answer: 0 });
});

sqliteTest('Q3 actual admitted canonical prose is distinct from the original baseline proposal', async () => {
  const proposalContent = '  Memory  summary.  ';
  const report = await run({ model: modelFor({ extract: () => ({ items: [item(proposalContent, [0])] }),
    extractRoleStratified: () => ({ userItems: [item(proposalContent, [0])], assistantItems: [] }) }) });
  assert.equal(report.completedArms, 2);
  assert.equal(report.rows[0].baseline.extraction.proposal.items[0].content, proposalContent);
  assert.equal(report.rows[0].baseline.extraction.output.items[0].content, proposalContent);
  assert.equal(report.rows[0].candidate.extraction.proposal.userItems[0].content, proposalContent);
  assert.equal(report.rows[0].candidate.extraction.output.items[0].content, 'Memory summary.');
  for (const name of report.rows[0].order) assert.equal(report.rows[0][name].admittedMemories[0].content, 'Memory summary.');
  const formattedJson = JSON.stringify(JSON.parse(json()), null, 2) + '\n';
  const formatted = await run({ fixtureJson: formattedJson, assertActive: async () => {} });
  assert.equal(formatted.status, 'stopped');
  assert.equal(formatted.fixtureVersion, report.fixtureVersion);
  assert.equal(formatted.fixtureSha256, sha256(formattedJson));
  assert.notEqual(formatted.fixtureSha256, report.fixtureSha256);
});
