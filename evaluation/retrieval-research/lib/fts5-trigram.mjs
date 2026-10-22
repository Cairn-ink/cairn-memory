import { DatabaseSync } from 'node:sqlite';
import { wholeRuns } from './tokenize.mjs';
import { collapseMemories } from './bm25.mjs';

export function trigramExpression(text) {
  const tokens = new Set();
  for (const run of wholeRuns(text.normalize('NFKC'))) {
    const chars = [...run];
    for (let i = 0; i + 2 < chars.length; i++) tokens.add(chars.slice(i, i + 3).join(''));
  }
  return [...tokens].map(token => `"${token.replaceAll('"', '""')}"`).join(' OR ');
}
export function createTrigram(documents) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE VIRTUAL TABLE docs USING fts5(text, tokenize='trigram')");
    const insert = db.prepare('INSERT INTO docs(rowid,text) VALUES (?,?)');
    documents.forEach((doc, index) => insert.run(index + 1, doc.text.normalize('NFKC').toLowerCase()));
    const search = db.prepare('SELECT rowid,bm25(docs) AS score FROM docs WHERE docs MATCH ?');
    return { search(text, depth = 24) {
      const expression = trigramExpression(text);
      if (!expression) return [];
      return collapseMemories(search.all(expression).map(row => ({
        memoryId: documents[row.rowid - 1].memoryId, docId: documents[row.rowid - 1].docId, score: -row.score,
      })), depth);
    }, close() { db.close(); } };
  } catch (error) { db.close(); throw error; }
}
