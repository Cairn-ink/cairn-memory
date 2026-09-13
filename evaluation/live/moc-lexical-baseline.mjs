import { DatabaseSync } from 'node:sqlite';

function exactRecord(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new TypeError(`${name} must contain exactly ${keys.join(', ')}`);
  }
}

// Offline diagnostic only. The caller supplies the active, namespace-filtered
// synthetic corpus; neither answer labels nor MOC placement enter this ranking.
export function searchLexical(input) {
  exactRecord(input, ['memories', 'query', 'limit'], 'input');
  const { memories, query, limit } = input;
  if (!Array.isArray(memories) || memories.length > 2048) {
    throw new TypeError('memories must be an array of at most 2048 documents');
  }
  if (typeof query !== 'string' || query.length > 4000) {
    throw new TypeError('query must be a string of at most 4000 UTF-16 code units');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 12) {
    throw new TypeError('limit must be an integer from 1 through 12');
  }
  const seen = new Set();
  for (const memory of memories) {
    exactRecord(memory, ['id', 'content'], 'memory');
    if (typeof memory.id !== 'string' || !memory.id.trim() || memory.id.length > 4000
      || seen.has(memory.id)) {
      throw new TypeError('memory IDs must be nonempty, unique, bounded strings');
    }
    if (typeof memory.content !== 'string' || memory.content.length > 4000) {
      throw new TypeError('content must be a string of at most 4000 UTF-16 code units');
    }
    seen.add(memory.id);
  }
  const queryTerms = [...new Set(query.match(/[\p{L}\p{N}]+/gu) ?? [])];
  const matchExpression = queryTerms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ');
  const db = new DatabaseSync(':memory:');
  try {
    // No fallback: a runtime without FTS5 must fail visibly.
    db.exec("CREATE VIRTUAL TABLE lexical USING fts5(content, tokenize='unicode61')");
    const insert = db.prepare('INSERT INTO lexical(rowid, content) VALUES (?, ?)');
    db.exec('BEGIN');
    memories.forEach((memory, index) => insert.run(index + 1, memory.content));
    db.exec('COMMIT');
    const rows = matchExpression ? db.prepare(`
      SELECT rowid, bm25(lexical) AS score FROM lexical
      WHERE lexical MATCH ? ORDER BY score ASC, rowid ASC LIMIT ?
    `).all(matchExpression, limit) : [];
    return {
      ids: rows.map((row) => memories[Number(row.rowid) - 1].id),
      scores: rows.map((row) => row.score),
      tokenizer: 'unicode61',
      queryTerms,
      matchExpression,
      // Full candidate corpus indexed before LIMIT; not a SQLite page-I/O count.
      scannedDocuments: memories.length,
    };
  } finally {
    db.close();
  }
}
