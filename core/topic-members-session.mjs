import { lstatSync } from 'node:fs';
import { openReadDatabase } from './read-database.mjs';
import { APPLICATION_ID, READ_SCHEMA_VERSIONS } from './database.mjs';
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
export function createTopicSession(path) {
  let connection, schema, opening, overview, members, dirty = false;
  function dispose() {
    connection?.db.close(); connection = opening = overview = members = undefined; dirty = false;
  }
  function changed() {
    dirty = true;
    fail('cursor_stale');
  }
  function prepare({ charge, request }) {
    if (connection) {
      try { connection.assertFile(); } catch (error) {
        if (!['cursor_stale', 'database_not_found', 'unsafe_database_file'].includes(error.code)) throw error;
        dirty = true;
      }
    }
    if (dirty) {
      dispose();
      if (request.cursor) fail('cursor_stale');
    }
    if (connection) return;
    // One bounded native/file setup step; one group of four header validations;
    // two groups of <=4 indexed seek-plan validations. No index-list scan.
    charge(1);
    const opened = openReadDatabase(path, { topicMembers: true, deferTopicValidation: true });
    try {
      charge(1);
      schema = configuration(opened.db);
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
      const raw = createTopicMembersStorage(opened.db);
      members = { ...raw, create: () => ({ ...raw.create(), initialization: opening.create() }),
        step(state, ...args) {
          if (!state.initialization.done) opening.step(state.initialization);
          else raw.step(state, ...args);
        } };
      connection = opened;
    } catch (error) {
      opened.db.close();
      if (error.code === 'ERR_SQLITE_ERROR' && ![5,6].includes(error.errcode & 255)) fail('unsupported_database');
      throw error;
    }
  }
  function transaction(work) {
    connection.db.exec('BEGIN');
    try { const value = work(); connection.db.exec('COMMIT'); return value; }
    catch (error) { connection.db.exec('ROLLBACK'); throw error; }
  }
  const snapshot = namespace => {
    try { connection.assertFile(); } catch { changed(); }
    return overview.snapshot(namespace);
  };
  const originBinding = (namespace, captured) => {
    if (!same(configuration(connection.db), schema)) changed();
    const stat = lstatSync(path);
    return { namespace, captured, file: [stat.dev, stat.ino], schema, configuration: 'topic-snapshot-v1/topic-members-v1' };
  };
  return { prepare, transaction, snapshot, originBinding, dispose,
    storage: { create: () => members.create(), target: (...args) => members.target(...args), step: (...args) => members.step(...args) },
    accept: state => opening.accept(state?.initialization),
    overviewCreate(namespace, bounds, captured) {
      const data = overview.create(namespace, bounds, captured), initialization = opening.create();
      function* scan() {
        while (!initialization.done) { opening.step(initialization); yield; }
        yield* data.scan;
      }
      return { ...data, initialization, scan: scan() };
    } };
}
