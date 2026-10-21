import { parentPort, workerData } from 'node:worker_threads';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { openReadDatabase } from './read-database.mjs';
import { createTopicOverviewStorage } from './topic-overview-storage.mjs';
import { safeReaderFailure } from './topic-overview-input.mjs';
import { fail } from './validation.mjs';

let connection, storage, traversal;
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
async function read(request) {
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
parentPort.on('message', async request => {
  try { parentPort.postMessage(await read(request)); }
  catch (error) { traversal = undefined; parentPort.postMessage(safeReaderFailure(error)); }
});
