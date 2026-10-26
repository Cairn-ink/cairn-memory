import { assertPointPlan } from './topic-members-opening.mjs';
import { unsupportedTopicStorage } from './topic-reader-sqlite.mjs';
import { fail } from './validation.mjs';

export const PREVIEW_SOURCE_SQL = `SELECT typeof(content) AS source_type,
  octet_length(content) AS source_bytes,
  CASE WHEN typeof(content) = 'text' AND octet_length(content) <= 12000
    THEN substr(CAST(content AS BLOB), 1, 12001) ELSE NULL END AS source
  FROM memories
  WHERE id = ? COLLATE BINARY AND owner_id = ? COLLATE BINARY
    AND scope = ? COLLATE BINARY AND project_id = ? COLLATE BINARY
    AND revision = ? AND kind = ? COLLATE BINARY AND deleted = 0
    AND currentness = 'current' AND review_state IN ('none', 'confirmed')`;

export function createPreviewStorage(db) {
  let statement;
  return {
    // Each phase is one separately charged, bounded initialization operation.
    setup(phase) {
      try {
        if (phase === 0) {
          const [column] = db.prepare('SELECT content FROM memories LIMIT 0').columns();
          if (column.column !== 'content' || column.table !== 'memories' || column.type !== 'TEXT') fail('unsupported_database');
        } else if (phase === 1) {
          if (db.prepare("SELECT octet_length('a') n").get().n !== 1) fail('unsupported_database');
        } else {
          assertPointPlan(db, 'memories', ['id']);
          statement = db.prepare(PREVIEW_SOURCE_SQL);
          const detail = db.prepare('EXPLAIN QUERY PLAN ' + PREVIEW_SOURCE_SQL).get('', '', '', '', 1, 'fact')?.detail;
          if (!detail?.startsWith('SEARCH memories USING INDEX sqlite_autoindex_memories_') || !detail.includes('id=?')) fail('unsupported_database');
        }
      } catch (error) {
        if (error.code === 'ERR_SQLITE_ERROR' && ![5, 6].includes(error.errcode & 255)) throw unsupportedTopicStorage(error);
        throw error;
      }
    },
    source(row, request) {
      const n = request.namespace;
      // The caller fences unchanged membership/generation authority in this
      // transaction. This point read decisively rechecks exact ref metadata.
      return statement.get(row.id, n.ownerId, n.scope, n.projectId, row.revision, row.kind);
    },
  };
}
