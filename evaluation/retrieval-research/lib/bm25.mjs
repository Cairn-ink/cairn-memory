import { tokenizeT1 } from './tokenize.mjs';
export const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const rankScores = rows => rows.sort((a, b) => b.score - a.score || compareIds(a.memoryId, b.memoryId));

// Collapse before top-k: A5's channel-level memory score is max(document score).
// Equal document scores choose the smallest document ID, independently of input
// order. Keep that identity so evaluation can distinguish a body from a span.
export function collapseMemories(rows, depth = 24) {
  const winners = new Map();
  for (const { memoryId, docId, score } of rows) {
    if (!Number.isFinite(score)) throw new Error('nonfinite_score');
    if (typeof docId !== 'string' || !docId) throw new Error('document_id_required');
    const previous = winners.get(memoryId);
    if (!previous || score > previous.score || score === previous.score && compareIds(docId, previous.docId) < 0)
      winners.set(memoryId, { memoryId, docId, score });
  }
  return rankScores([...winners.values()]).slice(0, depth);
}

// Raw retained-channel diagnostics, shared by standalone and fused arms. Pure
// fusion-math callers may omit docId; all document indexes above require it.
export function channelPayload(channels) {
  return {
    channelScores: Object.fromEntries(Object.entries(channels).map(([name, rows]) =>
      [name, Object.fromEntries(rows.map(row => [row.memoryId, row.score]))])),
    winningDocs: Object.fromEntries(Object.entries(channels).map(([name, rows]) =>
      [name, Object.fromEntries(rows.filter(row => row.docId !== undefined).map(row => [row.memoryId, row.docId]))])),
  };
}

// Construct one index per namespace/scale/intent projection; no global statistics.
export function createBM25(documents, { tokenize = tokenizeT1, k1 = 1.2, b = 0.75 } = {}) {
  const df = new Map();
  const docs = documents.map(doc => {
    const tokens = tokenize(doc.text), tf = new Map();
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
    for (const token of tf.keys()) df.set(token, (df.get(token) ?? 0) + 1);
    return { ...doc, tf, length: tokens.length };
  });
  const N = docs.length, avgLength = docs.reduce((n, doc) => n + doc.length, 0) / (N || 1);
  return { N, avgLength, df, search(text, depth = 24) {
    const wanted = [...new Set(tokenize(text))];
    const rows = [];
    for (const doc of docs) {
      let score = 0, matched = false;
      for (const term of wanted) {
        const f = doc.tf.get(term) ?? 0;
        if (!f) continue;
        matched = true;
        const idf = Math.log(1 + (N - df.get(term) + 0.5) / (df.get(term) + 0.5));
        score += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * doc.length / avgLength));
      }
      if (matched) rows.push({ memoryId: doc.memoryId, docId: doc.docId, score });
    }
    return collapseMemories(rows, depth);
  } };
}
