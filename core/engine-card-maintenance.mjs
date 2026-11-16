import { isStorageBusy } from './database.mjs';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { dispatchCommit, hasCommitDispatcher } from './commit-dispatch.mjs';
import { withContentSuppressionRequest } from './content-suppression-storage.mjs';
import { assertContentPort, inertContentPortValue } from './content-safety-boundary.mjs';
import { callModel, modelRequestText, MODEL_INPUT_TOKENS } from './model-call.mjs';
import { countTokens, modelPortValue } from './model-budget.mjs';
import { cardNamespace } from './private-card-input.mjs';
import { object, fail } from './validation.mjs';
import { CONSOLIDATE_PROMPT, validateConsolidation } from './engine-card-output.mjs';
import { ENGINE_CARD_LIMITS, cardTrigger, clusterMemories, partitionCardClusters, chainLength, cardMemoryRevisions } from './engine-card-clusters.mjs';
import { assembleContext, cardSourceKeys, currentCardLines, memoryPackKey } from './context-read-assembly.mjs';

/** Called only by a bounded maintenance pass, never admission/capture. The model
 * port uses the same callModel envelope, tokenizer, deadline and guarded adapter
 * quota as other engine work. Refusal ends the pass without another dispatch. */
export function createEngineCardMaintenance({ storage, model, relations, vectors, now = Date.now }) {
  let active = false, last = null;
  const failureReasons = new Set(['model_timeout', 'model_cancelled', 'source_unavailable', 'source_excluded',
    'context_budget_exceeded', 'token_count_unavailable', 'invalid_model_output', 'scope_changed',
    'namespace_paused', 'dependency_limit_reached', 'source_budget_exceeded', 'store_closed', 'invalid_input', 'consolidation_failed']);
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
  // The worker and every outer public composition share this synchronous,
  // fresh projection through withEngineCardDelivery. No engine await follows
  // the outermost projection before its public promise resolves.
  function deliver(ns, result) {
    if (result.built.length) {
      const committed = result.built.length;
      result.built = storage.deliver(ns, result.built);
      if (result.built.length !== committed) {
        result.built = []; result.state = 'refused'; result.reason = 'source_unavailable';
      }
    }
    return result;
  }
  async function maintain(input) {
    object(input, ['namespace', 'budget', 'rawSpans']); const ns = cardNamespace(input.namespace);
    if (Object.hasOwn(input, 'rawSpans') && typeof input.rawSpans !== 'boolean') fail('invalid_input');
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
      const checkPause = storage.pauseGuard(ns, end);
      checkPause();
      const commit = hasCommitDispatcher(storage) ? work => dispatchCommit(storage, () => { checkPause(); return work(); }, deadline) : null;
      await withContentSuppressionRequest(async () => {
        const scope = JSON.stringify(ns), previous = scans.get(scope);
        let page = commit ? await commit(() => storage.snapshot(ns, maxItems, check, previous?.after ?? '')) : storage.snapshot(ns, maxItems, check, previous?.after ?? '');
        let scan = previous;
        if (scan && (scan.epoch !== page.epoch || now() - scan.startedAt >= ENGINE_CARD_LIMITS.debounceMs)) {
          scans.delete(scope); scan = null; page = commit ? await commit(() => storage.snapshot(ns, maxItems, check)) : storage.snapshot(ns, maxItems, check);
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
        const timestamp = new Date(now()).toISOString();
        const topics = clusterMemories(snapshot.memories, vectorMap, check), cards = storage.cards(ns, check);
        const purged = storage.recentPurges(ns, timestamp, check);
        const topicKey = key => key.replace(/#\d+$/, '');
        const purgedTopics = new Set(purged.map(card => topicKey(card.clusterKey))), priorTopics = new Map();
        // Compare whole topics, including the union of prior parts. Counting
        // each part separately loses continuity as soon as a topic exceeds 12.
        for (const card of [...cards, ...purged]) if (card.clusterKey.startsWith('similarity:')) {
          const key = topicKey(card.clusterKey);
          if (!priorTopics.has(key)) priorTopics.set(key, { key, builtAt: card.builtAt, ids: new Set() });
          const prior = priorTopics.get(key);
          if (card.builtAt < prior.builtAt) prior.builtAt = card.builtAt;
          for (const ref of card.sourceRevisions) prior.ids.add(ref.memoryId);
        }
        // A deleted seed must not turn a stale topic into a new key and bypass
        // its debounce. Reuse a prior similarity key for a majority-overlapping
        // source set; MOC identities remain exact and never merge this way.
        const blockedClusters = new Set(), matchesByCluster = new Map();
        const naturalKeys = new Set(topics.map(cluster => cluster.key));
        for (const cluster of topics) {
          check();
          let blocked = purgedTopics.has(cluster.key);
          if (cluster.key.startsWith('similarity:')) {
            const ids = new Set(cluster.memories.map(m => m.id));
            const matches = [...priorTopics.values()].map(prior => ({ prior,
              overlap: [...prior.ids].filter(id => ids.has(id)).length / Math.max(ids.size, prior.ids.size) }))
              .filter(value => value.overlap >= .65)
              .sort((a, b) => b.overlap - a.overlap || a.prior.builtAt.localeCompare(b.prior.builtAt));
            if (matches.length) matchesByCluster.set(cluster, matches[0]);
            blocked ||= matches.some(match => purgedTopics.has(match.prior.key));
          }
          if (blocked) blockedClusters.add(cluster);
        }
        // Award continuity before natural keys: the best overlap owns a prior
        // key, with the existing build-time/stable traversal order for ties.
        const ownedKeys = new Set(), inherited = new Set();
        for (const [cluster, match] of [...matchesByCluster].sort(([, a], [, b]) =>
          b.overlap - a.overlap || a.prior.builtAt.localeCompare(b.prior.builtAt))) {
          if (ownedKeys.has(match.prior.key)) continue;
          cluster.key = match.prior.key; ownedKeys.add(cluster.key); inherited.add(cluster);
        }
        const blockedTopics = new Set();
        for (const cluster of topics) {
          check();
          if (!inherited.has(cluster)) {
            if (ownedKeys.has(cluster.key)) {
              // A continuity winner can take another cluster's natural seed.
              // Derive a stable identity from that displaced cluster's full
              // source set, reserving all natural keys before trying a salt.
              const naturalKey = cluster.key, sources = cluster.memories.map(memory => memory.id).sort();
              let salt = 0;
              do { cluster.key = 'similarity:' + createHash('sha256').update(JSON.stringify([naturalKey, sources, salt++])).digest('hex'); }
              while (ownedKeys.has(cluster.key) || naturalKeys.has(cluster.key));
            }
            ownedKeys.add(cluster.key);
          }
          // Blocking belongs to the matched source set, even when it loses
          // continuity ownership or its natural key has to be displaced.
          if (blockedClusters.has(cluster)) blockedTopics.add(cluster.key);
        }
        const eligible = new Map(), blocked = new Map();
        for (const cluster of partitionCardClusters(topics)) {
          check();
          // Five items establish pressure without a token estimate. The only
          // smaller eligible case is a four-Memory chain: meter its actual
          // Memory wire (plus receipts only with consent) with the product packer, including
          // framing, references, metadata, dates and source deduplication.
          const tokens = cluster.memories.length < 5 && edges && chainLength(cluster.memories, edges) >= 3
            ? assembleContext({ prepared: storage.pressureItems(ns, cluster.memories, { rawSpans: input.rawSpans === true }), counter: model,
              policy: { id: 'rank-first-whole-v1' }, budget: { maxItems: 12, maxTokens: 1000000 },
              representation: 'representation-v2-dated', deadlineAt: end, snapshotOf: () => null }).diagnostics.budget.used : 0;
          cluster.trigger = cardTrigger(cluster.memories, edges, tokens);
          if (cluster.trigger.eligible) {
            if (eligible.has(cluster.key) || blocked.has(cluster.key)) fail('storage_error');
            if (blockedTopics.has(topicKey(cluster.key))) { blocked.set(cluster.key, cluster); result.debounced++; }
            else eligible.set(cluster.key, cluster);
          }
        }
        for (const card of cards) {
          check();
          const alias = card.clusterKey.endsWith('#0') ? card.clusterKey.slice(0, -2) : card.clusterKey + '#0';
          // Blocked parts still stale shifted source sets on the original
          // schedule, but are never destinations for carry or publication.
          const cluster = eligible.get(card.clusterKey) ?? blocked.get(card.clusterKey) ?? eligible.get(alias) ?? blocked.get(alias);
          const sameSources = cluster && JSON.stringify(card.sourceRevisions) === JSON.stringify(cardMemoryRevisions(cluster.memories));
          if (card.status === 'current' && sameSources && cluster.key === card.clusterKey) { eligible.delete(cluster.key); continue; }
          // Search before staling against the old key: another eligible set
          // may already occupy that topic while these exact sources moved on.
          // An occupied exact match must not hide another free destination.
          const carry = candidate =>
            candidate.key !== card.clusterKey && candidate.memories.length === card.sourceRevisions.length && candidate.memories.every(memory =>
              card.sourceRevisions.some(ref => ref.memoryId === memory.id && ref.revision === memory.revision)) &&
            storage.carry(ns, card, candidate, check);
          let destination;
          if (commit && card.status === 'current') {
            for (const candidate of eligible.values()) if (await commit(() => carry(candidate))) { destination = candidate; break; }
          } else destination = card.status === 'current' && [...eligible.values()].find(carry);
          if (destination) {
            eligible.delete(destination.key); continue;
          }
          if (!cluster) {
            if (now() - Date.parse(card.row.updated_at) >= ENGINE_CARD_LIMITS.debounceMs) {
              if (commit) await commit(() => storage.retire(ns, card.id, timestamp, true)); else storage.retire(ns, card.id, timestamp, true);
              result.deleted++;
            }
            continue;
          }
          const newlyStale = card.row.revision === 1;
          if (newlyStale) {
            if (commit) await commit(() => storage.retire(ns, card.id, timestamp)); else storage.retire(ns, card.id, timestamp);
          }
          if (newlyStale || now() - Date.parse(card.row.updated_at) < ENGINE_CARD_LIMITS.debounceMs) {
            eligible.delete(cluster.key); if (!blocked.has(cluster.key)) result.debounced++;
          }
        }
        for (const cluster of eligible.values()) {
          check();
          if (cluster.memories.length > ENGINE_CARD_LIMITS.sources) { result.state = 'source_limit'; continue; }
          const requestSources = [...cluster.memories];
          const memories = requestSources.map(({ id, revision, content, date, currentness }) => ({ id, revision, content, date, currentness }));
          const ids = new Set(memories.map(memory => memory.id));
          const relevantRelations = edges?.filter(edge => ids.has(edge?.from) && ids.has(edge?.to) &&
            ['supersedes', 'contradicts'].includes(edge.kind)).slice(0, 192).map(({ from, to, kind, slot }) => ({ from, to, kind, slot }));
          const request = () => ({ memories, rawSpans: [], ...(relevantRelations?.length ? { relations: relevantRelations } : {}) });
          const fits = () => {
            if (countTokens(model, modelRequestText(CONSOLIDATE_PROMPT, request())) > MODEL_INPUT_TOKENS) return false;
            const fit = modelPortValue(model, 'fitsConsolidationRequest', 'invalid_input');
            if (typeof fit !== 'function') return true;
            try { return assertContentPort({ invoke: () => Reflect.apply(fit, model,
              [{ system: CONSOLIDATE_PROMPT, input: structuredClone(request()), maxOutputTokens: 1024 }]) }) === true; }
            finally { assertContentPort(); }
          };
          // Own sources always go first. Newest same-topic context follows,
          // bounded by both the existing adapter envelope and 24 Memories.
          if (fits()) for (const memory of [...(cluster.contextMemories ?? [])]
            .filter(memory => !ids.has(memory.id)).sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.id.localeCompare(b.id))) {
            check();
            if (memories.length >= 24) break;
            const { id, revision, content, date, currentness } = memory;
            memories.push({ id, revision, content, date, currentness });
            if (!fits()) { memories.pop(); continue; }
            requestSources.push(memory);
          }
          if (!fits()) { result.state = 'input_budget'; continue; }
          const claim = () => storage.claim(ns, cluster, new Date(now()).toISOString(), check);
          const attempt = commit ? await commit(claim) : claim();
          if (!attempt) { result.debounced++; continue; }
          result.modelCalls++;
          try {
            const output = await callModel(model, 'consolidate', CONSOLIDATE_PROMPT, request(), {
              deadline, beforeDispatch: checkPause, validateFresh: () => { check(); storage.validate(ns, requestSources, check); }, failureCode: 'consolidation_failed' });
            const value = validateConsolidation(output, memories, model, cluster.memories); check();
            // Context can identify an old current line in another Card. Reuse
            // ordinary staling and its debounce; one generation ends this pass.
            // Only current lines count: a Card that already lists the Memory
            // under Timeline is up to date, and retiring it would make two
            // Cards rebuild each other for ever.
            const retirements = [];
            for (const other of cards.filter(card => card.status === 'current')) {
              const covered = cardSourceKeys([{ type: 'card', metadata: { origin: 'engine' }, text: currentCardLines(other.row.body),
                sourceMemoryRefs: other.sourceRevisions.map(ref => ({ namespace: ns, ...ref })) }]);
              if (requestSources.some(memory => value.outOfDateIds.includes(memory.id) && covered.has(memoryPackKey({
                namespace: ns, memoryId: memory.id, revision: memory.revision })))) {
                retirements.push(other.id);
              }
            }
            // Publication (when there is a body) and every retirement chosen
            // by this output share one guarded dispatcher unit and transaction.
            const publish = () => storage.commit(ns, cluster, value, new Date(now()).toISOString(), check, retirements, requestSources);
            const card = commit ? await commit(publish) : publish();
            if (card) {
              const { supersededCount = 0, ...published } = card;
              result.deleted += supersededCount; result.built.push(published);
            }
            // Valid output without a committed Card must not reopen a missing
            // fingerprint on every subsequent maintenance pass.
            const finish = () => storage.finish(ns, attempt, card ? 'succeeded' : 'terminal', new Date(now()).toISOString());
            if (commit) await dispatchCommit(storage, finish, undefined, { compensating: true }); else finish();
          } catch (error) {
            let code;
            try { code = error?.code; }
            catch { /* Unreadable failure framing is terminal. */ }
            if (code === 'namespace_paused') {
              const release = () => storage.release(ns, attempt);
              if (commit) await dispatchCommit(storage, release, undefined, { compensating: true }); else release();
            }
            else {
              const transient = ['model_timeout', 'model_cancelled', 'consolidation_transient'].includes(code);
              const finish = () => storage.finish(ns, attempt, transient ? 'transient' : 'terminal', new Date(now()).toISOString());
              if (commit) await dispatchCommit(storage, finish, undefined, { compensating: true }); else finish();
            }
            throw error;
          }
          // One generation per bounded worker pass, including invalid output.
          break;
        }
      }, { fresh: true });
      deliver(ns, result);
    } catch (error) {
      result.built = [];
      let code;
      try {
        // Preserve the ordinary path's single read of an untrusted accessor.
        const proposed = error?.code;
        if (hasCommitDispatcher(storage) && (proposed === 'storage_busy' || isStorageBusy(error))) code = 'storage_busy';
        else if (failureReasons.has(proposed)) code = proposed;
      } catch { /* Port exception properties are untrusted. */ }
      result.state = code === 'namespace_paused' ? 'paused' : code === 'model_timeout' ? 'deadline' : 'refused';
      result.reason = result.state === 'deadline' ? 'deadline' : code ?? 'consolidation_failed';
    } finally { active = false; last = { namespace: JSON.stringify(ns), value: structuredClone(result) }; }
    return result;
  }
  return { status, maintain, deliver };
}
