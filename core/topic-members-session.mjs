import { withContentSuppressionRequest, inContentSuppressionRequestInside, assertContentSuppressionRequestInside, resetContentSuppressionRequestInside } from './content-suppression-storage.mjs';
import { contentReadSafety, createContentReadMemo } from './content-safety.mjs';
import { attestContentSafety, checkInstalledContentSafety, cachedContentLayout } from './content-safety-schema.mjs';
import { topicReadTransaction, unsupportedTopicStorage } from './topic-reader-sqlite.mjs';
import { lstatSync } from 'node:fs';
import { openReadDatabase } from './read-database.mjs';
import { APPLICATION_ID, READ_SCHEMA_VERSIONS, isStorageBusy } from './database.mjs';
import { createTopicOpening, assertPointPlan } from './topic-members-opening.mjs';
import { createTopicMembersStorage } from './topic-members-storage.mjs';
import { createTopicOverviewStorage } from './topic-overview-storage.mjs';
import { fail } from './validation.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const configuration = db => ({ version: db.prepare('PRAGMA user_version').get().user_version,
  cookie: db.prepare('PRAGMA schema_version').get().schema_version,
  applicationId: db.prepare('PRAGMA application_id').get().application_id });

/** The native handle is lazy; all opening queries run after the caller installs
 * its work meter. The full schema walk resumes from acknowledged traversal data. */
export function createTopicSession(path, topicPolicy) {
  let connection, schema, opening, overview, members, readMemo, requestNamespace, dirty = false;
  function dispose() {
    if (connection?.db.isOpen) connection.db.close();
    connection = opening = overview = members = undefined; dirty = false;
  }
  function changed() {
    dirty = true;
    fail('cursor_stale');
  }
  function prepare({ charge, request }) {
    requestNamespace = request.namespace;
    if (connection && !connection.db.isOpen) dirty = true;
    if (connection && !dirty) {
      try { connection.assertFile(); } catch (error) {
        if (!['cursor_stale', 'database_not_found', 'unsafe_database_file'].includes(error.code)) throw error;
        dirty = true;
      }
    }
    if (dirty) {
      dispose();
      if (request.cursor || request.expectedSnapshot) fail('cursor_stale');
    }
    if (connection) return;
    // One bounded native/file setup step; one group of four header validations;
    // two groups of <=4 indexed seek-plan validations. No index-list scan.
    charge(1);
    const opened = openReadDatabase(path, { topicMembers: true, deferTopicValidation: true, topicPolicy });
    try {
      charge(1);
      schema = configuration(opened.db);
      const layout = attestContentSafety(opened.db, schema.version);
      const encoding = opened.db.prepare('PRAGMA encoding').get().encoding;
      if (schema.applicationId !== APPLICATION_ID || !READ_SCHEMA_VERSIONS.includes(schema.version) || encoding !== 'UTF-8') fail('unsupported_database');
      charge(1);
      for (const [table, keys] of [['namespace_index_state', ['owner_id','scope','project_id']],
        ['namespace_epochs', ['owner_id','scope','project_id']], ['index_generations', ['id']], ['store_metadata', ['singleton']]]) {
        assertPointPlan(opened.db, table, keys);
      }
      charge(1);
      for (const [table, keys] of [['mocs', ['id']], ['index_mocs', ['generation','id']]]) assertPointPlan(opened.db, table, keys);
      opening = createTopicOpening(opened.db, schema.version);
      overview = createTopicOverviewStorage(opened.db, { exactComparisons: true });
      const raw = createTopicMembersStorage(opened.db, { rawAncestry: Boolean(layout.suppressionRevision && layout.rawLineage), memoryReadable: layout.suppressionRevision
        ? (namespace, row) => {
          readMemo.decisions?.clear();
          return contentReadSafety(opened.db, { namespace, selectedMemory: row, memo: readMemo, ref: { type: 'memory', namespace, memoryId: row.id, revision: row.revision } }).allowed;
        }
        : () => true });
      members = { ...raw, create: () => ({ ...raw.create(), initialization: opening.create() }),
        cost: state => state.initialization.done ? 1 : opening.cost(state.initialization),
        step(state, ...args) {
          if (!state.initialization.done) opening.step(state.initialization);
          else raw.step(state, ...args);
        } };
      connection = opened;
    } catch (error) {
      opened.db.close();
      if (error.code === 'ERR_SQLITE_ERROR' && ![5,6].includes(error.errcode & 255)) throw unsupportedTopicStorage(error);
      throw error;
    }
  }
  function prepareRequest({ charge, ...args }) {
    if (!topicPolicy) return prepare({ charge, ...args });
    return topicPolicy.retryOpening(path, () => {
      const charges = [];
      prepare({ ...args, charge: units => charges.push(units) });
      for (const units of charges) charge(units);
    });
  }
  const canRetry = () => topicPolicy?.isDelete(connection?.db);
  function retry(work, restore) {
    return topicPolicy ? topicPolicy.retryRead(connection.db, work, restore) : work();
  }
  function retryTransaction(work, restore) {
    return retry(() => transaction(work), () => {
      if (restore && !restore()) return false;
      resetContentSuppressionRequestInside(connection.db);
      return true;
    });
  }
  function transaction(work) {
    const { db } = connection, run = callback => topicReadTransaction(db, callback, canRetry() ? isStorageBusy : undefined);
    if (!cachedContentLayout(db)?.suppressionRevision) return run(work);
    return withContentSuppressionRequest(() => run(() =>
      inContentSuppressionRequestInside(db, work, requestNamespace ? [requestNamespace] : undefined)));
  }
  const snapshot = namespace => {
    try { connection.assertFile(); } catch { changed(); }
    // Check inside the charged transaction, before prepared snapshot statements
    // can be invalidated by DROP/ALTER and throw an untyped native error.
    if (!same(configuration(connection.db), schema)) changed();
    checkInstalledContentSafety(connection.db);
    readMemo = createContentReadMemo(connection.db); readMemo.retainOutputDecisions = false;
    return overview.snapshot(namespace);
  };
  const originBinding = (namespace, captured) => {
    const stat = lstatSync(path);
    return { namespace, captured, file: [stat.dev, stat.ino], schema, configuration: 'topic-snapshot-v1/topic-members-v1' };
  };
  const assertDelivery = namespace => {
    if (!cachedContentLayout(connection.db)?.suppressionRevision) return;
    try { assertContentSuppressionRequestInside(connection.db,[namespace]); }
    catch(error) { if(error.code==='evidence_unavailable')fail('cursor_stale');throw error; }
  };
  return { prepare, prepareRequest, transaction, canRetry, retryTransaction, snapshot, originBinding, dispose,
    assertDelivery: namespace => retry(() => assertDelivery(namespace)),
    storage: { create: () => members.create(), target: (...args) => members.target(...args),
      cost: state => members.cost(state), step: (...args) => members.step(...args) },
    accept: state => opening.accept(state?.initialization),
    overviewCreate(namespace, bounds, captured) {
      const data = overview.create(namespace, bounds, captured), initialization = opening.create();
      return { ...data, initialization, cost: () => initialization.done ? 1 : opening.cost(initialization),
        stepOpening: () => opening.step(initialization),
        restoreOpening(checkpoint) {
          // Keep the identity used by cost(), stepOpening() and accept().
          for (const key of Object.keys(initialization)) delete initialization[key];
          Object.assign(initialization, checkpoint);
        } };
    } };
}
