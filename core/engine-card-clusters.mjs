import { createHash } from 'node:crypto';
import { createBM25, scoreBM25 } from './context-read-bm25.mjs';
import { tokenizeT1, termFrequencies } from './context-read-tokenize.mjs';

import { ENGINE_CARD_LIMITS } from './private-card-input.mjs';
export { ENGINE_CARD_LIMITS };
// Source identity stays stable when event ordering changes a routing key.
export const cardMemoryRevisions = memories => memories.map(memory => ({ memoryId: memory.id, revision: memory.revision }))
  .sort((a, b) => a.memoryId.localeCompare(b.memoryId));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cosine = (a, b) => {
  const vector = value => Array.isArray(value) || value instanceof Float32Array || value instanceof Float64Array;
  if (!vector(a) || !vector(b) || !a.length || a.length > 32768 || a.length !== b.length ||
      [...a, ...b].some(n => !Number.isFinite(n))) return null;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : null;
};

/** Optional relations port: read({namespace,memoryIds}) -> [{from,to,kind,slot}].
 * Endpoints are source Memory IDs; only same-slot supersedes/contradicts edges
 * count. A missing port means chain recurrence is unavailable, never guessed. */
export function chainLength(memories, relations = []) {
  const ids = new Set(memories.map(m => m.id)), slots = new Map();
  for (const edge of relations) {
    if (!edge || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to ||
        !['supersedes', 'contradicts'].includes(edge.kind) || typeof edge.slot !== 'string' || !edge.slot.length) continue;
    if (!slots.has(edge.slot)) slots.set(edge.slot, new Map());
    const graph = slots.get(edge.slot);
    if (!graph.has(edge.from)) graph.set(edge.from, []);
    graph.get(edge.from).push(edge.to);
  }
  let longest = 0;
  function walk(graph, id, visited) {
    if (visited.has(id)) return;
    const next = new Set(visited).add(id); longest = Math.max(longest, next.size - 1);
    // The trigger only needs three edges; cap traversal even on cyclic input.
    if (longest >= 3 || next.size >= 4) return;
    for (const child of graph.get(id) ?? []) walk(graph, child, next);
  }
  for (const graph of slots.values()) for (const id of graph.keys()) walk(graph, id, new Set());
  return longest;
}

export function cardTrigger(memories, relations, tokens) {
  const dates = memories.map(m => Date.parse(m.date)).filter(Number.isFinite);
  const conversations = new Set(memories.flatMap(m => m.conversations));
  const recurring = memories.length >= 8 && conversations.size >= 3 &&
    dates.length >= 2 && Math.max(...dates) - Math.min(...dates) >= 14 * 86400000;
  const topic = memories.filter(memory => memory.currentness === 'current').length >= 5;
  const chain = relations === undefined ? null : chainLength(memories, relations);
  const pressure = memories.length >= 5 || tokens >= 1200;
  return { eligible: pressure && (recurring || chain >= 3 || topic), recurring, topic, chain, pressure,
    memories: memories.length, conversations: conversations.size, tokens };
}

/** MOC membership wins. Otherwise use vectors when both endpoints have one,
 * then positive BM25 term overlap with the seed. No model call or time window. */
export function clusterMemories(memories, vectors = new Map(), check = () => {}) {
  const groups = new Map(), unfiled = [];
  for (const memory of memories) {
    check();
    if (!memory.topics.length) { unfiled.push(memory); continue; }
    for (const topic of memory.topics) {
      const key = 'moc:' + topic;
      if (!groups.has(key)) groups.set(key, { key, memories: [] });
      groups.get(key).memories.push(memory);
    }
  }
  const bm25 = createBM25(unfiled.map(m => ({ id: m.id, text: m.content })));
  const remaining = new Set(unfiled);
  for (const seed of unfiled) {
    check();
    if (!remaining.has(seed)) continue;
    const terms = tokenizeT1(seed.content), members = [];
    for (const memory of remaining) {
      check();
      const similarity = cosine(vectors.get(seed.id), vectors.get(memory.id));
      if (seed === memory || (similarity !== null ? similarity >= .65 :
        (scoreBM25(terms, termFrequencies(memory.content), bm25) ?? 0) > 0)) members.push(memory);
    }
    members.forEach(m => remaining.delete(m));
    const key = 'similarity:' + hash(seed.id);
    groups.set(key, { key, memories: members });
  }
  return [...groups.values()];
}

/** Consecutive event-date parts bound each consolidation request. Small topics
 * retain their identity; an append changes only the final part's sources. */
export function partitionCardClusters(clusters) {
  return clusters.flatMap(cluster => {
    if (cluster.memories.length <= 12) return [cluster];
    const memories = [...cluster.memories].sort((a, b) => Date.parse(a.date) - Date.parse(b.date) ||
      a.id.localeCompare(b.id));
    return Array.from({ length: Math.ceil(memories.length / 12) }, (_, index) =>
      ({ ...cluster, key: `${cluster.key}#${index}`, memories: memories.slice(index * 12, (index + 1) * 12) }));
  });
}
