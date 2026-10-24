import { parentPort, workerData } from 'node:worker_threads';
import { lstatSync } from 'node:fs';
import { createTopicTokens } from './topic-snapshot.mjs';
import { createTopicMembersStorage } from './topic-members-storage.mjs';
import { createTopicMemberReader } from './topic-members-reader.mjs';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { openReadDatabase } from './read-database.mjs';
import { createTopicOverviewStorage } from './topic-overview-storage.mjs';
import { safeReaderFailure } from './topic-overview-input.mjs';
import { fail } from './validation.mjs';

let connection, storage, traversal, memberReader, openedSchema;
const connections = new Map();
const tokens = createTopicTokens();
function configuration(db) {
  return { version: db.prepare('PRAGMA user_version').get().user_version,
    cookie: db.prepare('PRAGMA schema_version').get().schema_version,
    applicationId: db.prepare('PRAGMA application_id').get().application_id };
}
function originBinding(namespace, captured) {
  connection.assertFile();
  const stat = lstatSync(workerData.path);
  const schema = configuration(connection.db);
  if (JSON.stringify(schema) !== JSON.stringify(openedSchema)) fail('cursor_stale');
  return { namespace, captured, file: [stat.dev, stat.ino],
    schema, configuration: 'topic-snapshot-v1/topic-members-v1' };
}
function publicSnapshot(state, request) {
  const value = { indexRevision: state.snapshot.indexRevision, generation: state.snapshot.generation };
  if (request.snapshotVersion) value.originToken = state.originToken;
  return value;
}
function validateOrigin(state, request) {
  if (request.snapshotVersion) tokens.verifyOrigin(state.originToken, originBinding(request.namespace, state.snapshot));
}
const token = () => 'e1.' + randomBytes(32).toString('base64url');
const success = value => ({ ok: true, value });
function snapshot(request, expected) {
  connection.assertFile();
  let current;
  try { current = storage.snapshot(request.namespace); }
  catch (error) {
    if (expected && request.snapshotVersion && error.code === 'index_unavailable') fail('cursor_stale');
    throw error;
  }
  if (expected && JSON.stringify(current) !== JSON.stringify(expected)) fail('cursor_stale');
  return current;
}
function transaction(work) {
  connection.db.exec('BEGIN');
  try { const value = work(); connection.db.exec('COMMIT'); return value; }
  catch (error) { connection.db.exec('ROLLBACK'); throw error; }
}
function open(topicMembers = false, continuation = false) {
  let entry = connections.get(topicMembers);
  if (entry && topicMembers) {
    let changed = false;
    try {
      entry.connection.assertFile();
      changed = JSON.stringify(configuration(entry.connection.db)) !== JSON.stringify(entry.schema);
    } catch (error) {
      if (!['cursor_stale', 'database_not_found', 'unsafe_database_file'].includes(error.code)) throw error;
      changed = true;
    }
    if (changed) {
      entry.connection.db.close(); connections.delete(true); entry = undefined; memberReader = undefined;
      if (traversal?.originToken) traversal = undefined;
      if (continuation) fail('cursor_stale');
    }
  }
  if (!entry) {
    const opened = openReadDatabase(workerData.path, { topicMembers });
    try {
      entry = { connection: opened, storage: createTopicOverviewStorage(opened.db),
        schema: configuration(opened.db) };
      connections.set(topicMembers, entry);
    } catch (error) {
      opened.db.close();
      if (error?.code === 'ERR_SQLITE_ERROR' && [5, 6].includes(error.errcode & 255)) throw error;
      fail('unsupported_database');
    }
  }
  connection = entry.connection; storage = entry.storage; openedSchema = entry.schema;
  if (topicMembers && !memberReader) memberReader = createTopicMemberReader({ storage: createTopicMembersStorage(connection.db),
    snapshot: namespace => { connection.assertFile(); return storage.snapshot(namespace); }, transaction, tokens, originBinding });
}
async function read(request) {
  open(Boolean(request.snapshotVersion), Boolean(request.cursor));
  const { cursor, ...bound } = request, binding = JSON.stringify(bound);
  if (cursor) {
    if (!traversal) fail('cursor_stale');
    if (binding !== traversal.binding) fail('invalid_cursor');
    transaction(() => { snapshot(request, traversal.snapshot); validateOrigin(traversal, request); });
    if (cursor === traversal.lastInput) return traversal.lastOutput;
    if (cursor !== traversal.nextCursor) fail('cursor_stale');
  } else {
    const captured = transaction(() => snapshot(request));
    traversal = { binding, snapshot: captured, data: storage.create(request.namespace, request, captured),
      offset: 0, nextCursor: null };
    if (request.snapshotVersion) traversal.originToken = transaction(() => tokens.issueOrigin(originBinding(request.namespace, captured)));
  }
  const state = traversal;
  let used = request.snapshotVersion ? 2 : 0;
  try {
    while (!state.items && used < request.workLimit - (request.snapshotVersion ? 2 : 0)) {
      const done = transaction(() => {
        snapshot(request, state.snapshot);
        validateOrigin(state, request);
        if (request.snapshotVersion) used += 2;
        const start = performance.now();
        let quantum = request.snapshotVersion ? 2 : 0;
        while (used < request.workLimit - (request.snapshotVersion ? 2 : 0) && quantum < 64 && performance.now() - start < 5) {
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
    if (request.snapshotVersion) transaction(() => { snapshot(request, state.snapshot); validateOrigin(state, request); });
    traversal = undefined;
    return success({ snapshot: publicSnapshot(state, request),
      items: [], totals: null, coverage: { complete: false, countsComplete: false, reason: 'state_limit' }, nextCursor: null });
  }
  const value = { snapshot: publicSnapshot(state, request),
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
  transaction(() => { snapshot(request, state.snapshot); validateOrigin(state, request); });
  state.lastInput = cursor; state.lastOutput = success(value); state.nextCursor = value.nextCursor;
  return state.lastOutput;
}
parentPort.on('message', async request => {
  try {
    if (request.method === 'members') { open(true, Boolean(request.request.cursor)); parentPort.postMessage(await memberReader.read(request.request, request.deadlineAt)); }
    else parentPort.postMessage(await read(request));
  }
  catch (error) { if (request.method !== 'members') traversal = undefined; parentPort.postMessage(safeReaderFailure(error)); }
});
