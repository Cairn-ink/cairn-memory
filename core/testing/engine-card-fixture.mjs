import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../index.mjs';
import { host, ns, ok } from './context-read-core-fixture.mjs';
import { countOpenAITokens } from '../../adapters/openai/index.mjs';
export { ns, ok };

export function scriptedConsolidator(hook) {
  const calls = [];
  return { calls, contextWindow: 8192, countTokens: countOpenAITokens,
    async consolidate(request) {
      calls.push(structuredClone(request.input));
      if (hook) return hook(request);
      const superseded = new Set((request.input.relations ?? []).filter(edge => edge.kind === 'supersedes').map(edge => edge.to));
      const memory = request.input.memories.filter(memory => !superseded.has(memory.id))
        .sort((a, b) => b.date.localeCompare(a.date))[0] ?? request.input.memories[0];
      const topic = memory.content.split(/\s/u)[0];
      return { currentState: [{ text: `${topic} current state: ${memory.content}`, memoryIds: [memory.id] }],
        timeline: request.input.memories.filter(memory => superseded.has(memory.id))
          .sort((a, b) => a.date.localeCompare(b.date) || a.content.localeCompare(b.content))
          .map(memory => ({ date: memory.date.slice(0, 10), text: memory.content, memoryIds: [memory.id] })), contradictions: [] };
    } };
}

export function engineCardFixture(t, { model = scriptedConsolidator(), ...coreOptions } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'engine-card-' }), path = join(workspace.path, 'store.sqlite');
  const trusted = host(), core = openMemoryCore({ path, model, ...coreOptions,
    contextRead: { version: 'context-read-v1', authority: trusted.authority,
      counter: { id: 'o200k_base', countTokens: countOpenAITokens } } });
  const db = new DatabaseSync(path); db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  workspace.defer(() => core.close()); workspace.defer(() => db.close());
  const add = (content, day = 0, conversation = 0, namespace = ns) => {
    const memory = ok(core.admit({ namespace, memory: { content, kind: 'fact' },
      receipts: [{ client: 'synthetic', sessionId: 'conversation-' + conversation,
        eventId: createHash('sha256').update(content).digest('hex'), role: 'user', excerpt: content }] })).memory;
    // Old stores have no receipt event-time column. Synthetic arrival dates
    // exercise their retained dated-memory path without schema fixture edits.
    const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString();
    db.prepare('UPDATE memories SET created_at=? WHERE id=?').run(date, memory.id);
    return memory;
  };
  const seed = (count = 30, topic = 'Orion') => Array.from({ length: count }, (_, i) =>
    add(`${topic} milestone ${i}: evidence marker${i} records implementation detail ${i}.`, Math.round(i * 60 / Math.max(1, count - 1)), i % 6));
  function file(memories, title) {
    const result = []; let mocId;
    for (let i = 0; i < memories.length; i += 5) {
      const batch = memories.slice(i, i + 5), map = ok(core.map({ namespace: ns }));
      const placed = ok(core.applyPlacement({ namespace: ns, expectedIndexRevision: map.indexRevision,
        expectedMemoryRevisions: batch.map(memory => ({ memoryId: memory.id, revision: memory.revision })),
        proposal: { items: batch.map(memory => ({ memoryId: memory.id, parentIds: mocId ? [mocId] : [],
          ...(!mocId ? { newL1: { title, parentL2Ids: [] } } : {}) })) } }));
      mocId ??= placed.createdMocs.find(moc => moc.level === 'L1').id;
      result.push(...placed.memories);
    }
    return { memories: result, mocId };
  }
  return { workspace, path, core, db, model, trusted, add, seed, file,
    pass: (budget = {}) => core.maintainCards({ namespace: ns, budget: { maxMs: 5000, ...budget } }),
    read: (query, patch = {}) => trusted.call(core, 'contextRead', { readSet: [ns], types: ['memory', 'card'],
      intent: 'current', query, semantic: false, deadlineMs: 5000,
      budget: { maxItems: 12, maxTokens: 3000 }, ...patch }),
    refresh: () => trusted.call(core, 'refreshContextIndex', { readSet: [ns], types: ['memory', 'card'],
      intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } }) };
}
