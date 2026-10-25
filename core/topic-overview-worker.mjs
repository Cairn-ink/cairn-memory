import { parentPort, workerData } from 'node:worker_threads';
import { createTopicTokens } from './topic-snapshot.mjs';
import { createTopicSession } from './topic-members-session.mjs';
import { createTopicMemberReader } from './topic-members-reader.mjs';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { openReadDatabase } from './read-database.mjs';
import { createTopicOverviewStorage } from './topic-overview-storage.mjs';
import { safeReaderFailure, safeLegacyReaderFailure } from './topic-overview-input.mjs';
import { fail } from './validation.mjs';

let connection, storage, traversal;
let tokens, topicSession, memberReader;
function prepareTopicReaders() {
  if (memberReader) return;
  const nextTokens = createTopicTokens(), nextSession = createTopicSession(workerData.path);
  const nextReader = createTopicMemberReader({ ...nextSession, tokens: nextTokens });
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
  connection.db.exec('BEGIN');
  try { const value = work(); connection.db.exec('COMMIT'); return value; }
  catch (error) { connection.db.exec('ROLLBACK'); throw error; }
}
async function readLegacy(request) {
  if (!connection) {
    const opened = openReadDatabase(workerData.path);
    try { storage = createTopicOverviewStorage(opened.db); connection = opened; }
    catch { opened.db.close(); fail('unsupported_database'); }
  }
  const { cursor, ...bound } = request, binding = JSON.stringify(bound);
  if (cursor) {
    if (!traversal) fail('cursor_stale');
    if (binding !== traversal.binding) fail('invalid_cursor');
    transaction(() => snapshot(request, traversal.snapshot));
    if (cursor === traversal.lastInput) return traversal.lastOutput;
    if (cursor !== traversal.nextCursor) fail('cursor_stale');
  } else {
    const captured = transaction(() => snapshot(request));
    traversal = { binding, snapshot: captured, data: storage.create(request.namespace, request, captured),
      offset: 0, nextCursor: null };
  }
  const state = traversal;
  let used = 0;
  try {
    while (!state.items && used < request.workLimit) {
      const done = transaction(() => {
        snapshot(request, state.snapshot);
        const start = performance.now();
        let quantum = 0;
        while (used < request.workLimit && quantum < 64 && performance.now() - start < 5) {
          used++; quantum++;
          if (state.data.scan.next().done) return true;
        }
        return false;
      });
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
    state.offset += value.items.length;
    if (state.offset === state.items.length) { value.coverage.complete = true; value.coverage.reason = null; value.nextCursor = null; }
  }
  if (Buffer.byteLength(JSON.stringify(success(value))) > request.maxBytes) fail('context_item_too_large');
  transaction(() => snapshot(request, state.snapshot));
  state.lastInput = cursor; state.lastOutput = success(value); state.nextCursor = value.nextCursor;
  return state.lastOutput;
}
async function readOptin(request) {
  let used = 0;
  const charge = n => { used += n; if (used > request.workLimit) fail('reader_failed'); };
  topicSession.prepare({ charge, request });
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
  let state;
  try {
    topicSession.transaction(() => {
      const start = performance.now(), before = used;
      const { captured, origin } = fence(cursor ? traversal : undefined);
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
        state.data.scan.next();
      }
    });
    if (replay) return traversal.lastOutput;
    charge(1);
    while (!state.items && used + 4 + state.data.cost() <= request.workLimit - 4) {
      const done = topicSession.transaction(() => {
        fence(state);
        const start = performance.now(); let quantum = 4;
        while (used + state.data.cost() <= request.workLimit - 4 && quantum + state.data.cost() <= 64 && performance.now() - start < 5) {
          const cost = state.data.cost(); charge(cost); quantum += cost;
          if (state.data.scan.next().done) return true;
        }
        return false;
      });
      if (done) { state.items = state.data.finish(); break; }
      await yieldTurn();
    }
  } catch (error) {
    if (error.code !== 'state_limit' || !state) throw error;
    topicSession.transaction(() => fence(state)); traversal = undefined;
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
    state.offset += value.items.length;
    if (state.offset === state.items.length) { value.coverage = { complete: true, countsComplete: true, reason: null }; value.nextCursor = null; }
  }
  if (Buffer.byteLength(JSON.stringify(success(value))) > request.maxBytes) fail('context_item_too_large');
  topicSession.transaction(() => fence(state)); topicSession.accept(state.data);
  state.lastInput = cursor; state.lastOutput = success(value); state.nextCursor = value.nextCursor;
  return state.lastOutput;
}
parentPort.on('message', async request => {
  try {
    if (request.method === 'members' || request.snapshotVersion) prepareTopicReaders();
    if (request.method === 'members') parentPort.postMessage(await memberReader.read(request.request, request.deadlineAt));
    else parentPort.postMessage(await (request.snapshotVersion ? readOptin(request) : readLegacy(request)));
  }
  catch (error) {
    if (request.method !== 'members') traversal = undefined;
    const failure = request.method === 'members' || request.snapshotVersion ? safeReaderFailure : safeLegacyReaderFailure;
    parentPort.postMessage(failure(error));
  }
});
