import { performance } from 'node:perf_hooks';
import { withContentSuppressionRequest } from './content-suppression-storage.mjs';
import { assertContentPort, inertContentPortValue } from './content-safety-boundary.mjs';
import { callModel, modelRequestText, MODEL_INPUT_TOKENS } from './model-call.mjs';
import { countTokens, modelPortValue } from './model-budget.mjs';
import { cardNamespace } from './private-card-input.mjs';
import { object, fail } from './validation.mjs';
import { CONSOLIDATE_PROMPT, validateConsolidation } from './engine-card-output.mjs';
import { ENGINE_CARD_LIMITS, cardTrigger, clusterMemories, chainLength, cardMemoryRevisions } from './engine-card-clusters.mjs';
import { assembleContext } from './context-read-assembly.mjs';

/** Called only by a bounded maintenance pass, never admission/capture. The model
 * port uses the same callModel envelope, tokenizer, deadline and guarded adapter
 * quota as other engine work. Refusal ends the pass without another dispatch. */
export function createEngineCardMaintenance({ storage, model, relations, vectors, now = Date.now }) {
  let active = false, last = null;
  const failureReasons = new Set(['model_timeout', 'model_cancelled', 'source_unavailable', 'source_excluded',
    'context_budget_exceeded', 'token_count_unavailable', 'invalid_model_output', 'scope_changed',
    'dependency_limit_reached', 'source_budget_exceeded', 'store_closed', 'invalid_input', 'consolidation_failed']);
  const scans = new Map();
  for (const port of [relations, vectors]) if (port !== undefined && typeof port?.read !== 'function') fail('invalid_input');
  const configured = typeof model?.consolidate === 'function';
  function status(input) {
    object(input, ['namespace']); const ns = cardNamespace(input.namespace);
    const previous = last?.namespace === JSON.stringify(ns) ? last.value : null;
    return { configured, state: configured ? storage?.available() ? 'ready' : 'unsupported_store' : 'model_not_configured',
      limits: ENGINE_CARD_LIMITS, lastPass: previous ? { state: previous.state, built: previous.built.length,
        modelCalls: previous.modelCalls, deleted: previous.deleted, debounced: previous.debounced,
        ...(previous.reason ? { reason: previous.reason } : {}) } : null };
  }
  async function maintain(input) {
    object(input, ['namespace', 'budget']); const ns = cardNamespace(input.namespace);
    const budget = input.budget ?? {}; object(budget, ['maxItems', 'maxMs']);
    const maxItems = budget.maxItems ?? ENGINE_CARD_LIMITS.memories, maxMs = budget.maxMs ?? 1000;
    if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > ENGINE_CARD_LIMITS.memories ||
        !Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 30000) fail('invalid_input');
    if (!configured || !storage?.available()) return { ...status({ namespace: ns }), built: [], modelCalls: 0 };
    if (active) return { state: 'busy', built: [], modelCalls: 0 };
    active = true;
    const end = performance.now() + maxMs;
    const deadline = { expired: () => performance.now() >= end,
      remainingMs() { const remaining = Math.ceil(end - performance.now()); if (remaining < 1) fail('model_timeout'); return remaining; } };
    const check = () => { if (deadline.expired()) fail('model_timeout'); };
    const result = { state: 'ready', built: [], modelCalls: 0, deleted: 0, debounced: 0 };
    try {
      await withContentSuppressionRequest(async () => {
        const scope = JSON.stringify(ns), previous = scans.get(scope);
        let page = storage.snapshot(ns, maxItems, check, previous?.after ?? '');
        let scan = previous;
        if (scan && (scan.epoch !== page.epoch || now() - scan.startedAt >= ENGINE_CARD_LIMITS.debounceMs)) {
          scans.delete(scope); scan = null; page = storage.snapshot(ns, maxItems, check);
        }
        scan ??= { memories: [], epoch: page.epoch, after: '', startedAt: now() };
        scan.memories.push(...page.memories); scan.after = page.after;
        if (scan.memories.length > ENGINE_CARD_LIMITS.scanMemories || Buffer.byteLength(JSON.stringify(scan)) > ENGINE_CARD_LIMITS.scanBytes) {
          scans.delete(scope); result.state = 'state_limit'; return;
        }
        // A partial cluster cannot establish its exact source set or absence.
        // Resume this bounded namespace scan in a later pass, with an epoch
        // restart if capture changed the population in between.
        if (!page.complete) {
          scans.set(scope, scan); if (scans.size > 8) scans.delete(scans.keys().next().value);
          result.state = 'work_limit'; return;
        }
        scans.delete(scope);
        const snapshot = { memories: scan.memories };
        const request = { namespace: ns, memoryIds: snapshot.memories.map(m => m.id),
          memories: cardMemoryRevisions(snapshot.memories) };
        const portRead = async port => {
          let timer; const controller = new AbortController();
          try {
            const value = await Promise.race([assertContentPort({ invoke: () => port.read({ ...structuredClone(request), signal: controller.signal }) }),
              new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Object.assign(Error('deadline'), { code: 'model_timeout' })); }, deadline.remainingMs()); })]);
            return assertContentPort({ invoke: () => inertContentPortValue(value, 'invalid_input') });
          } finally { clearTimeout(timer); assertContentPort(); }
        };
        const edges = relations ? await portRead(relations) : storage.relations(request);
        if (edges !== undefined && (!Array.isArray(edges) || edges.length > 2048)) fail('invalid_input');
        check();
        const vectorRows = vectors ? await portRead(vectors) : [];
        if (!Array.isArray(vectorRows) || vectorRows.length > ENGINE_CARD_LIMITS.memories) fail('invalid_input');
        const vectorMap = new Map(vectorRows.filter(row => snapshot.memories.some(m => m.id === row.memoryId && m.revision === row.revision))
          .map(row => [row.memoryId, row.vector]));
        storage.validate(ns, snapshot.memories, check); check();
        const clusters = clusterMemories(snapshot.memories, vectorMap, check), cards = storage.cards(ns, check);
        // A deleted seed must not turn a stale topic into a new key and bypass
        // its debounce. Reuse a prior similarity key for a majority-overlapping
        // source set; MOC identities remain exact and never merge this way.
        for (const cluster of clusters) if (cluster.key.startsWith('similarity:')) {
          const ids = new Set(cluster.memories.map(m => m.id));
          const match = cards.filter(card => card.clusterKey?.startsWith('similarity:')).map(card => ({ card,
            overlap: card.sourceRevisions.filter(ref => ids.has(ref.memoryId)).length /
              Math.max(ids.size, card.sourceRevisions.length) })).filter(value => value.overlap >= .65)
            .sort((a, b) => b.overlap - a.overlap || a.card.builtAt.localeCompare(b.card.builtAt))[0];
          if (match) cluster.key = match.card.clusterKey;
        }
        const eligible = new Map();
        for (const cluster of clusters) {
          check();
          // Five items establish pressure without a token estimate. The only
          // smaller eligible case is a four-Memory chain: meter its actual
          // Memory/receipt wire with the existing product packer, including
          // framing, references, metadata, dates and source deduplication.
          const tokens = cluster.memories.length < 5 && edges && chainLength(cluster.memories, edges) >= 3
            ? assembleContext({ prepared: storage.pressureItems(ns, cluster.memories), counter: model,
              policy: { id: 'rank-first-whole-v1' }, budget: { maxItems: 12, maxTokens: 1000000 },
              representation: 'representation-v2-dated', deadlineAt: end, snapshotOf: () => null }).diagnostics.budget.used : 0;
          cluster.trigger = cardTrigger(cluster.memories, edges, tokens);
          if (cluster.trigger.eligible) eligible.set(cluster.key, cluster);
        }
        const timestamp = new Date(now()).toISOString();
        for (const card of cards) {
          check();
          const cluster = eligible.get(card.clusterKey);
          if (!cluster) {
            // A topic key can change without changing any source revision.
            // Carry only a readable Card with the complete, exact source set.
            const destination = card.status === 'current' && [...eligible.values()].find(candidate =>
              candidate.memories.length === card.sourceRevisions.length && candidate.memories.every(memory =>
                card.sourceRevisions.some(ref => ref.memoryId === memory.id && ref.revision === memory.revision)));
            if (destination && storage.carry(ns, card, destination, check)) {
              eligible.delete(destination.key); continue;
            }
            if (now() - Date.parse(card.row.updated_at) >= ENGINE_CARD_LIMITS.debounceMs) {
              storage.retire(ns, card.id, timestamp, true); result.deleted++;
            }
            continue;
          }
          const sameSources = JSON.stringify(card.sourceRevisions) === JSON.stringify(cardMemoryRevisions(cluster.memories));
          if (card.status === 'current' && sameSources) { eligible.delete(cluster.key); continue; }
          const newlyStale = card.row.revision === 1;
          if (newlyStale) storage.retire(ns, card.id, timestamp);
          if (newlyStale || now() - Date.parse(card.row.updated_at) < ENGINE_CARD_LIMITS.debounceMs) {
            eligible.delete(cluster.key); result.debounced++;
          }
        }
        for (const cluster of eligible.values()) {
          check();
          if (cluster.memories.length > ENGINE_CARD_LIMITS.sources) { result.state = 'source_limit'; continue; }
          let rawSpans, rawTimer;
          try {
            rawSpans = await Promise.race([storage.rawSpans(ns, cluster.memories, check),
              new Promise((_, reject) => { rawTimer = setTimeout(() => reject(Object.assign(Error('deadline'),
                { code: 'model_timeout' })), deadline.remainingMs()); })]);
          } finally { clearTimeout(rawTimer); }
          const memories = cluster.memories.map(({ id, revision, content, date, currentness }) => ({ id, revision, content, date, currentness }));
          const ids = new Set(memories.map(memory => memory.id));
          const relevantRelations = edges?.filter(edge => ids.has(edge?.from) && ids.has(edge?.to) &&
            ['supersedes', 'contradicts'].includes(edge.kind)).slice(0, 192).map(({ from, to, kind, slot }) => ({ from, to, kind, slot }));
          const request = () => ({ memories, rawSpans, ...(relevantRelations?.length ? { relations: relevantRelations } : {}) });
          const fits = () => {
            if (countTokens(model, modelRequestText(CONSOLIDATE_PROMPT, request())) > MODEL_INPUT_TOKENS) return false;
            const fit = modelPortValue(model, 'fitsConsolidationRequest', 'invalid_input');
            if (typeof fit !== 'function') return true;
            try { return assertContentPort({ invoke: () => Reflect.apply(fit, model,
              [{ system: CONSOLIDATE_PROMPT, input: structuredClone(request()), maxOutputTokens: 1024 }]) }) === true; }
            finally { assertContentPort(); }
          };
          while (rawSpans.length && !fits()) {
            const shorter = rawSpans.map(span => { const points = [...span.text];
              return { ...span, text: points.slice(0, Math.max(1, Math.floor(points.length / 2))).join('') }; });
            if (shorter.every((span, index) => span.text.length === rawSpans[index].text.length)) break;
            rawSpans = shorter;
          }
          if (!fits()) { result.state = 'input_budget'; continue; }
          const attempt = storage.claim(ns, cluster, new Date(now()).toISOString(), check);
          if (!attempt) { result.debounced++; continue; }
          result.modelCalls++;
          try {
            const output = await callModel(model, 'consolidate', CONSOLIDATE_PROMPT, request(), {
              deadline, validateFresh: () => { check(); storage.validate(ns, cluster.memories, check); }, failureCode: 'consolidation_failed' });
            const value = validateConsolidation(output, memories, model); check();
            if (value) {
              const card = storage.commit(ns, cluster, value, new Date(now()).toISOString(), check);
              if (card) result.built.push(card);
            }
            storage.finish(ns, attempt, value ? 'succeeded' : 'terminal', new Date(now()).toISOString());
          } catch (error) {
            let transient = false;
            try { transient = ['model_timeout', 'model_cancelled', 'consolidation_transient'].includes(error?.code); }
            catch { /* Unreadable failure framing is terminal. */ }
            storage.finish(ns, attempt, transient ? 'transient' : 'terminal', new Date(now()).toISOString());
            throw error;
          }
          // One generation per bounded worker pass, including invalid output.
          break;
        }
      }, { fresh: true });
      if (result.built.length) {
        const committed = result.built.length;
        result.built = storage.deliver(ns, result.built);
        if (result.built.length !== committed) fail('source_unavailable');
      }
    } catch (error) {
      result.built = [];
      let code;
      try { const proposed = error?.code; if (failureReasons.has(proposed)) code = proposed; } catch { /* Port exception properties are untrusted. */ }
      result.state = code === 'model_timeout' ? 'deadline' : 'refused';
      result.reason = result.state === 'deadline' ? 'deadline' : code ?? 'consolidation_failed';
    } finally { active = false; last = { namespace: JSON.stringify(ns), value: structuredClone(result) }; }
    return result;
  }
  return { status, maintain };
}
