import { cachedContentLayout } from './content-safety-schema.mjs';
import { withContentSuppressionRequest, inContentSuppressionRequestInside, assertContentSuppressionRequestInside, resetContentSuppressionRequestInside } from './content-suppression-storage.mjs';
import { createTopicRetryPolicy, topicReadTransaction, unsupportedTopicStorage } from './topic-reader-sqlite.mjs';
import { parentPort, workerData } from 'node:worker_threads';
import { createTopicTokens } from './topic-snapshot.mjs';
import { createTopicSession } from './topic-members-session.mjs';
import { createTopicMemberReader } from './topic-members-reader.mjs';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { openReadDatabase } from './read-database.mjs';
import { isStorageBusy } from './database.mjs';
import { createTopicOverviewStorage } from './topic-overview-storage.mjs';
import { safeReaderFailure, safeLegacyReaderFailure } from './topic-overview-input.mjs';
import { fail } from './validation.mjs';

const topicPolicy = createTopicRetryPolicy({
  diagnostics: workerData.diagnostics,
  isRetryableBusy: isStorageBusy,
  onRetry: error => parentPort.postMessage({ retryingStorage: error ? safeReaderFailure(error, workerData.diagnostics) : null }),
});
let connection, storage, traversal;
let tokens, topicSession, memberReader, requestNamespace;
function prepareTopicReaders() {
  if (memberReader) return;
  const nextTokens = createTopicTokens(), nextSession = createTopicSession(workerData.path, topicPolicy);
  const nextReader = createTopicMemberReader({ ...nextSession, prepare: nextSession.prepareRequest, tokens: nextTokens });
  tokens = nextTokens; topicSession = nextSession; memberReader = nextReader;
}
function publicSnapshot(state, request) {
  const value = { indexRevision: state.snapshot.indexRevision, generation: state.snapshot.generation };
  if (request.snapshotVersion) value.originToken = state.originToken;
  return value;
}
const token = () => 'e1.' + randomBytes(32).toString('base64url');
const success = value => ({ ok: true, value });
function snapshot(request, expected) {
  connection.assertFile();
  const current = storage.snapshot(request.namespace);
  if (expected && JSON.stringify(current) !== JSON.stringify(expected)) fail('cursor_stale');
  return current;
}
function transaction(work) {
  const { db } = connection, run = callback => topicReadTransaction(db, callback, topicPolicy.isDelete(db) ? isStorageBusy : undefined);
  if (!cachedContentLayout(db)?.suppressionRevision) return run(work);
  return withContentSuppressionRequest(() => run(() => inContentSuppressionRequestInside(db, work, [requestNamespace])));
}
function retryLegacy(work, restore) {
  return topicPolicy.retryRead(connection.db, work, restore);
}
function retryLegacyTransaction(work, canResume = () => true) {
  return retryLegacy(() => transaction(work), () => {
    if (!canResume()) return false;
    resetContentSuppressionRequestInside(connection.db);
    return true;
  });
}
function openLegacy() {
  const opened = openReadDatabase(workerData.path, { topicPolicy });
  try { storage = createTopicOverviewStorage(opened.db); connection = opened; }
  catch (error) {
    opened.db.close();
    if (topicPolicy.isDelete(opened.db) && isStorageBusy(error)) throw error;
    throw unsupportedTopicStorage(error);
  }
}
async function readLegacy(request) {
  if (!connection?.db.isOpen) await topicPolicy.retryOpening(openLegacy);
  const { cursor, ...bound } = request, binding = JSON.stringify(bound);
  if (cursor) {
    if (!traversal) fail('cursor_stale');
    if (binding !== traversal.binding) fail('invalid_cursor');
    await retryLegacyTransaction(() => snapshot(request, traversal.snapshot));
    if (cursor === traversal.lastInput) return traversal.lastOutput;
    if (cursor !== traversal.nextCursor) fail('cursor_stale');
  } else {
    let captured;
    await retryLegacyTransaction(() => { captured = snapshot(request, captured); });
    traversal = { binding, snapshot: captured, data: storage.create(request.namespace, request, captured),
      offset: 0, nextCursor: null };
  }
  const state = traversal;
  let used = 0;
  try {
    while (!state.items && used < request.workLimit) {
      let scanStarted = false;
      const done = await retryLegacyTransaction(() => {
        snapshot(request, state.snapshot);
        const start = performance.now();
        let quantum = 0;
        while (used < request.workLimit && quantum < 64 && performance.now() - start < 5) {
          used++; quantum++;
          // The overview generator cannot rewind a .next() or a failed commit.
          scanStarted = true;
          if (state.data.scan.next().done) return true;
        }
        return false;
      }, () => !scanStarted);
      if (done) { state.items = state.data.finish(); break; }
      await yieldTurn();
    }
  } catch (error) {
    if (error?.code !== 'state_limit') throw error;
    traversal = undefined;
    return success({ snapshot: { indexRevision: state.snapshot.indexRevision, generation: state.snapshot.generation },
      items: [], totals: null, coverage: { complete: false, countsComplete: false, reason: 'state_limit' }, nextCursor: null });
  }
  const value = { snapshot: { indexRevision: state.snapshot.indexRevision, generation: state.snapshot.generation },
    items: [], totals: state.items ? state.data.totals : null,
    coverage: { complete: false, countsComplete: Boolean(state.items), reason: 'work_limit' }, nextCursor: token() };
  if (state.items) {
    value.coverage.reason = 'node_limit';
    while (value.items.length < request.nodeLimit && state.offset + value.items.length < state.items.length) {
      value.items.push(state.items[state.offset + value.items.length]);
      if (Buffer.byteLength(JSON.stringify(success(value))) > request.maxBytes) {
        value.items.pop(); value.coverage.reason = 'byte_limit'; break;
      }
    }
    if (!value.items.length && state.offset < state.items.length) fail('context_item_too_large');
    if (state.offset + value.items.length === state.items.length) { value.coverage.complete = true; value.coverage.reason = null; value.nextCursor = null; }
  }
  if (Buffer.byteLength(JSON.stringify(success(value))) > request.maxBytes) fail('context_item_too_large');
  await retryLegacyTransaction(() => snapshot(request, state.snapshot));
  state.offset += value.items.length;
  state.lastInput = cursor; state.lastOutput = success(value); state.nextCursor = value.nextCursor;
  return state.lastOutput;
}
async function readOptin(request) {
  let used = 0;
  const charge = n => { used += n; if (used > request.workLimit) fail('reader_failed'); };
  await topicSession.prepareRequest({ charge, request });
  function retryTransaction(work, restore = () => true) {
    const before = used;
    return topicSession.retryTransaction(work, () => {
      if (!restore()) return false;
      used = before;
      return true;
    });
  }
  const { cursor, ...bound } = request, binding = JSON.stringify(bound);
  function fence(state) {
    charge(4);
    let captured;
    try { captured = topicSession.snapshot(request.namespace); }
    catch (error) { if (state && error.code === 'index_unavailable') fail('cursor_stale'); throw error; }
    if (state && JSON.stringify(captured) !== JSON.stringify(state.snapshot)) fail('cursor_stale');
    const origin = topicSession.originBinding(request.namespace, captured);
    if (state) tokens.verifyOrigin(state.originToken, origin);
    return { captured, origin };
  }
  if (cursor) {
    if (!traversal) fail('cursor_stale');
    if (binding !== traversal.binding) fail('invalid_cursor');
    if (cursor !== traversal.lastInput && cursor !== traversal.nextCursor) fail('cursor_stale');
  }
  const replay = cursor && cursor === traversal.lastInput;
  let state, attempted;
  const initialization = cursor && !replay && topicSession.canRetry() && !traversal.data.initialization.done
    ? structuredClone(traversal.data.initialization) : undefined;
  try {
    await retryTransaction(() => {
      const start = performance.now(), before = used;
      const { captured, origin } = fence(cursor ? traversal : attempted);
      if (replay) return;
      if (!cursor) {
        charge(1);
        traversal = { binding, snapshot: captured, originToken: tokens.issueOrigin(origin),
          data: topicSession.overviewCreate(request.namespace, request, captured), offset: 0, nextCursor: null };
      }
      state = traversal;
      while (!state.data.initialization.done && used + state.data.cost() <= request.workLimit - 5 &&
          used - before + state.data.cost() <= 64 && performance.now() - start < 5) {
        charge(state.data.cost());
        state.data.stepOpening();
      }
    }, () => {
      if (initialization) traversal.data.restoreOpening(structuredClone(initialization));
      if (!cursor && state) attempted = state;
      return true;
    });
    if (replay) return traversal.lastOutput;
    charge(1);
    while (!state.items && used + 4 + state.data.cost() <= request.workLimit - 4) {
      let scanStarted = false;
      const initialization = topicSession.canRetry() && !state.data.initialization.done
        ? structuredClone(state.data.initialization) : undefined;
      const done = await retryTransaction(() => {
        fence(state);
        const start = performance.now(); let quantum = 4;
        while (used + state.data.cost() <= request.workLimit - 4 && quantum + state.data.cost() <= 64 && performance.now() - start < 5) {
          const cost = state.data.cost(); charge(cost); quantum += cost;
          if (!state.data.initialization.done) state.data.stepOpening();
          else {
            scanStarted = true;
            if (state.data.scan.next().done) return true;
          }
        }
        return false;
      }, () => {
        if (scanStarted) return false;
        if (initialization) state.data.restoreOpening(structuredClone(initialization));
        return true;
      });
      if (done) { state.items = state.data.finish(); break; }
      await yieldTurn();
    }
  } catch (error) {
    if (error.code !== 'state_limit' || !state) throw error;
    await retryTransaction(() => fence(state)); traversal = undefined;
    return success({ snapshot: publicSnapshot(state, request), items: [], totals: null,
      coverage: { complete: false, countsComplete: false, reason: 'state_limit' }, nextCursor: null });
  }
  const value = { snapshot: publicSnapshot(state, request), items: [], totals: state.items ? state.data.totals : null,
    coverage: { complete: false, countsComplete: Boolean(state.items), reason: 'work_limit' }, nextCursor: token() };
  if (state.items) {
    value.coverage.reason = 'node_limit';
    while (value.items.length < request.nodeLimit && state.offset + value.items.length < state.items.length) {
      value.items.push(state.items[state.offset + value.items.length]);
      if (Buffer.byteLength(JSON.stringify(success(value))) > request.maxBytes) {
        value.items.pop(); value.coverage.reason = 'byte_limit'; break;
      }
    }
    if (!value.items.length && state.offset < state.items.length) fail('context_item_too_large');
    if (state.offset + value.items.length === state.items.length) { value.coverage = { complete: true, countsComplete: true, reason: null }; value.nextCursor = null; }
  }
  if (Buffer.byteLength(JSON.stringify(success(value))) > request.maxBytes) fail('context_item_too_large');
  await retryTransaction(() => fence(state)); topicSession.accept(state.data);
  state.offset += value.items.length;
  state.lastInput = cursor; state.lastOutput = success(value); state.nextCursor = value.nextCursor;
  return state.lastOutput;
}
parentPort.on('message', async message => {
  const { deadlineAt, ...request } = message;
  topicPolicy.start(deadlineAt);
  try {
    await withContentSuppressionRequest(async()=>{
      requestNamespace=request.method==='members'?request.request.namespace:request.namespace;
      if (request.method === 'members' || request.snapshotVersion) prepareTopicReaders();
      const result = request.method === 'members' ? await memberReader.read(request.request, deadlineAt)
        : await (request.snapshotVersion ? readOptin(request) : readLegacy(request));
      // Worker yields are engine work, never E1 ports. One request proof spans
      // their snapshots; a single independent delivery fence follows all work.
      if (request.method === 'members' || request.snapshotVersion) await topicSession.assertDelivery(requestNamespace);
      else if (cachedContentLayout(connection.db)?.suppressionRevision) await retryLegacy(() => {
        try { assertContentSuppressionRequestInside(connection.db, [requestNamespace]); }
        catch (error) { if (error.code === 'evidence_unavailable') fail('cursor_stale'); throw error; }
      });
      parentPort.postMessage(result);
    },{fresh:true});
  }
  catch (error) {
    if (request.method !== 'members') traversal = undefined;
    const failure = request.method === 'members' || request.snapshotVersion ? safeReaderFailure : safeLegacyReaderFailure;
    parentPort.postMessage(failure(error, workerData.diagnostics));
  }
});
