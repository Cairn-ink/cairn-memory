import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { openMemoryCore } from '../../../core/contract.mjs';
import {
  createRecallStageCollector,
  RECALL_STAGE_OBSERVATION_VERSION,
} from '../recall-stage-observations.mjs';

const request = ({ items = [], exhausted = true, candidates = [] } = {}) => ({
  system: 'synthetic system text',
  input: { maps: [{ namespaceIndex: 0, items, exhausted }], candidates },
  maxOutputTokens: 1024,
  signal: new AbortController().signal,
});
const unfiled = (memoryId) => ({ type: 'unfiled', ref: { memoryId, revision: 1 }, label: 'private label' });
const filed = (memoryId) => ({ type: 'ref', ref: { childType: 'memory', childId: memoryId,
  childRevision: 1, parentId: 'private parent', parentRevision: 1 }, label: 'private label' });
const ref = (memoryId) => ({ namespaceIndex: 0, memoryId, revision: 1 });

test('O1/O2: forwarding retains frozen-model receivers and exact values while projecting bounded counts', async () => {
  const selectionRequest = request({ items: [unfiled('private-unfiled'), filed('private-filed')], exhausted: false });
  const selectionResult = { refs: [ref('private-unfiled'), ref('private-filed')] };
  const rankRequest = request({ candidates: [{ namespaceIndex: 0, memory: { id: 'private-unfiled' } }] });
  const rankResult = { refs: [ref('private-unfiled')] };
  const receiverCalls = [];
  const diagnosticReceivers = [];
  const onDiagnostic = function () { diagnosticReceivers.push(this); };
  const model = {
    contextWindow: 8192,
    onDiagnostic,
    countTokens(value) { receiverCalls.push(['countTokens', this, value]); return 1; },
    extract(value) { receiverCalls.push(['extract', this, value]); return value; },
    select(value) { receiverCalls.push(['select', this, value]); return selectionResult; },
    rank(value) { receiverCalls.push(['rank', this, value]); return Promise.resolve(rankResult); },
  };
  Object.freeze(model);
  const collector = createRecallStageCollector();
  const observed = collector.observeModel(model);

  const counted = observed.countTokens('same-token-input');
  const extracted = { input: 'same-extract-input' };
  assert.equal(counted, 1);
  assert.equal(observed.extract(extracted), extracted);
  assert.equal(await observed.select(selectionRequest), selectionResult);
  assert.equal(await observed.rank(rankRequest), rankResult);
  const callback = observed.onDiagnostic;
  assert.equal(callback, onDiagnostic);
  callback({ version: 1 });
  assert.equal(diagnosticReceivers[0], undefined);
  assert.ok(receiverCalls.every(([, receiver]) => receiver === model));
  assert.equal(receiverCalls.find(([name]) => name === 'select')[2], selectionRequest);
  assert.equal(receiverCalls.find(([name]) => name === 'rank')[2], rankRequest);

  const recallResult = { ok: true, value: { memories: [], namespaces: [{ namespace: {},
    mapExhausted: false, fetchExhausted: true }], coverage: 'budget_exhausted' } };
  assert.equal(await collector.observeRecall(() => recallResult), recallResult);
  collector.close();
  assert.deepEqual(collector.snapshot(), {
    schemaVersion: RECALL_STAGE_OBSERVATION_VERSION,
    availability: 'available',
    closed: true,
    selection: { recordLimit: 2, invocationCount: 1, droppedRecords: 0, overflowed: false, records: [{
      invocationOrdinal: 0, status: 'completed', visibleMapCount: 1, visibleItemCount: 2,
      filedRefCount: 1, unfiledCount: 1, mapExhausted: [false], returnedRefCount: 2,
      cumulativeUniqueSelectedRefCount: 2,
    }] },
    ranking: { recordLimit: 1, invocationCount: 1, droppedRecords: 0, overflowed: false, records: [{
      invocationOrdinal: 0, status: 'completed', inputCandidateCount: 1, returnedRefCount: 1,
    }] },
    recall: { recordLimit: 1, invocationCount: 1, droppedRecords: 0, overflowed: false, records: [{
      invocationOrdinal: 0, status: 'completed', mapExhausted: [false], fetchExhausted: [true],
    }] },
  });
  assert.equal(JSON.stringify(collector.snapshot()).includes('private-'), false);
});

test('O1: one collector forwards a shared function to each original model receiver', () => {
  function shared() { return this.marker; }
  const first = Object.freeze({ marker: 'first', countTokens: shared });
  const second = Object.freeze({ marker: 'second', countTokens: shared });
  const collector = createRecallStageCollector();
  const observedFirst = collector.observeModel(first);
  const observedSecond = collector.observeModel(second);
  assert.equal(observedFirst.countTokens(), 'first');
  assert.equal(observedSecond.countTokens(), 'second');
  collector.close();
});

test('O3: malformed accessors are unavailable without getter/toJSON effects and throws retain identity', async () => {
  let inputReads = 0;
  let refsReads = 0;
  let toJsonCalls = 0;
  const hostileRequest = { get input() { inputReads += 1; return {}; } };
  const hostileResult = { get refs() { refsReads += 1; return []; }, toJSON() { toJsonCalls += 1; return {}; } };
  const sentinel = new Error('private model error');
  let shouldThrow = false;
  const model = Object.freeze({
    select(value) { assert.equal(value, hostileRequest); if (shouldThrow) throw sentinel; return hostileResult; },
    rank() { return { refs: [] }; },
  });
  const collector = createRecallStageCollector();
  const observed = collector.observeModel(model);
  assert.equal(await observed.select(hostileRequest), hostileResult);
  shouldThrow = true;
  let caught;
  try { await observed.select(hostileRequest); } catch (error) { caught = error; }
  assert.equal(caught, sentinel);
  assert.deepEqual([inputReads, refsReads, toJsonCalls], [0, 0, 0]);
  collector.close();
  assert.deepEqual(collector.snapshot().selection.records.map((entry) => ({
    status: entry.status, visibleMapCount: entry.visibleMapCount,
    returnedRefCount: entry.returnedRefCount,
  })), [
    { status: 'unavailable', visibleMapCount: null, returnedRefCount: null },
    { status: 'failed', visibleMapCount: null, returnedRefCount: null },
  ]);
  assert.equal(JSON.stringify(collector.snapshot()).includes('private model error'), false);
});

test('O3: overflow, close, late settlement and concurrent collectors remain explicit and isolated', async () => {
  let resolveLate;
  let call = 0;
  const firstModel = Object.freeze({
    select() {
      call += 1;
      if (call === 2) return new Promise((resolve) => { resolveLate = resolve; });
      return { refs: [] };
    },
    rank() { return { refs: [] }; },
  });
  const secondModel = Object.freeze({ select: () => ({ refs: [ref('second-private-id')] }), rank: () => ({ refs: [] }) });
  const first = createRecallStageCollector();
  const second = createRecallStageCollector();
  const firstObserved = first.observeModel(firstModel);
  const secondObserved = second.observeModel(secondModel);
  const emptyRequest = request();
  await firstObserved.select(emptyRequest);
  const late = firstObserved.select(emptyRequest);
  first.close();
  const closedSnapshot = first.snapshot();
  resolveLate({ refs: [ref('late-private-id')] });
  assert.deepEqual(await late, { refs: [ref('late-private-id')] });
  assert.deepEqual(first.snapshot(), closedSnapshot);
  assert.deepEqual(await firstObserved.select(emptyRequest), { refs: [] });
  assert.deepEqual(first.snapshot(), closedSnapshot);

  await secondObserved.select(emptyRequest);
  await secondObserved.select(emptyRequest);
  await secondObserved.select(emptyRequest);
  second.close();
  const secondSnapshot = second.snapshot();
  assert.equal(secondSnapshot.selection.invocationCount, 3);
  assert.equal(secondSnapshot.selection.records.length, 2);
  assert.equal(secondSnapshot.selection.droppedRecords, 1);
  assert.ok(secondSnapshot.selection.records.every((entry) => entry.cumulativeUniqueSelectedRefCount === 1));
  assert.equal(JSON.stringify(secondSnapshot).includes('second-private-id'), false);
  assert.equal(first.snapshot().selection.invocationCount, 2);
  assert.equal(first.snapshot().selection.records[1].status, 'unavailable');
});

test('O2/O5: actual core reports two incomplete empty-selection map rounds without retaining identifiers', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'cairn-recall-stage-core-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const namespace = { ownerId: 'synthetic-observation', scope: 'personal', projectId: null };
  const model = Object.freeze({
    contextWindow: 8192,
    countTokens() { return 1; },
    select() { return { refs: [] }; },
    rank() { throw new Error('rank must not run after empty selection'); },
  });
  const collector = createRecallStageCollector();
  const core = openMemoryCore({ path: path.join(root, 'memory.sqlite'), model: collector.observeModel(model) });
  t.after(() => core.close());
  for (let index = 0; index < 201; index += 1) {
    const content = `private synthetic memory ${index}`;
    const admitted = core.admit({ namespace, memory: { content, kind: 'fact' }, receipts: [{
      client: 'synthetic', sessionId: 'private-session', eventId: `private-event-${index}`,
      role: 'user', excerpt: content,
    }] });
    assert.equal(admitted.ok, true, JSON.stringify(admitted));
  }
  const response = await collector.observeRecall(() => core.recall({ readSet: [namespace],
    query: 'unmatched query', limit: 6 }));
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.value.coverage, 'budget_exhausted');
  assert.deepEqual(response.value.memories, []);
  collector.close();
  const snapshot = collector.snapshot();
  assert.deepEqual(snapshot.selection.records.map((entry) => ({
    status: entry.status, visibleItemCount: entry.visibleItemCount, mapExhausted: entry.mapExhausted,
    returnedRefCount: entry.returnedRefCount,
  })), [
    { status: 'completed', visibleItemCount: 100, mapExhausted: [false], returnedRefCount: 0 },
    { status: 'completed', visibleItemCount: 100, mapExhausted: [false], returnedRefCount: 0 },
  ]);
  assert.equal(snapshot.ranking.invocationCount, 0);
  assert.deepEqual(snapshot.recall.records, [{ invocationOrdinal: 0, status: 'completed',
    mapExhausted: [false], fetchExhausted: [true] }]);
  assert.doesNotMatch(JSON.stringify(snapshot), /private|synthetic memory/u);
});

test('O2/O3: cumulative selection and rank-input bounds cover the core 24-plus-12 maximum', async () => {
  let selectionCall = 0;
  const model = Object.freeze({
    select() {
      const offset = selectionCall++ * 24;
      const length = offset === 0 ? 24 : 12;
      return { refs: Array.from({ length }, (_, index) => ref(`bounded-${offset + index}`)) };
    },
    rank() { return { refs: Array.from({ length: 12 }, (_, index) => ref(`bounded-${index}`)) }; },
  });
  const collector = createRecallStageCollector();
  const observed = collector.observeModel(model);
  const maps = request({ items: [unfiled('visible')] });
  await observed.select(maps);
  await observed.select(maps);
  const candidates = Array.from({ length: 36 }, () => ({}));
  await observed.rank(request({ candidates }));
  collector.close();
  const snapshot = collector.snapshot();
  assert.deepEqual(snapshot.selection.records.map((entry) => entry.cumulativeUniqueSelectedRefCount), [24, 36]);
  assert.equal(snapshot.ranking.records[0].inputCandidateCount, 36);
  assert.equal(snapshot.ranking.records[0].returnedRefCount, 12);

  const uncertain = createRecallStageCollector();
  let call = 0;
  const uncertainModel = uncertain.observeModel(Object.freeze({
    select() { return call++ === 0 ? { refs: [{ namespaceIndex: 0 }] } : { refs: [ref('later-valid')] }; },
    rank() { return { refs: [] }; },
  }));
  await uncertainModel.select(maps);
  await uncertainModel.select(maps);
  uncertain.close();
  assert.deepEqual(uncertain.snapshot().selection.records.map((entry) =>
    entry.cumulativeUniqueSelectedRefCount), [null, null]);
  assert.deepEqual(uncertain.snapshot().selection.records.map((entry) => entry.status),
    ['unavailable', 'unavailable']);

  const saturated = createRecallStageCollector();
  const saturatedModel = saturated.observeModel(Object.freeze({ select: () => ({ refs: [] }), rank: () => ({ refs: [] }) }));
  for (let index = 0; index < 65; index += 1) await saturatedModel.select(request());
  saturated.close();
  assert.deepEqual({ invocationCount: saturated.snapshot().selection.invocationCount,
    droppedRecords: saturated.snapshot().selection.droppedRecords,
    overflowed: saturated.snapshot().selection.overflowed },
  { invocationCount: null, droppedRecords: null, overflowed: true });
});

test('O3/O5: rank and recall errors retain identity while observations expose only closed failure status', async () => {
  const rankError = new Error('private rank failure');
  const recallError = new Error('private recall failure');
  const model = Object.freeze({
    select() { return { refs: [] }; },
    rank() { throw rankError; },
  });
  const collector = createRecallStageCollector();
  const observed = collector.observeModel(model);
  let caughtRank;
  try { await observed.rank(request({ candidates: [{}] })); } catch (error) { caughtRank = error; }
  assert.equal(caughtRank, rankError);
  let caughtRecall;
  try { await collector.observeRecall(() => { throw recallError; }); } catch (error) { caughtRecall = error; }
  assert.equal(caughtRecall, recallError);
  collector.close();
  const snapshot = collector.snapshot();
  assert.equal(snapshot.ranking.records[0].status, 'failed');
  assert.equal(snapshot.recall.records[0].status, 'failed');
  assert.equal(JSON.stringify(snapshot).includes('private'), false);
});
