import { CoreError, cutRationaleText } from '../../../src/index.mjs';
import { rationaleEdgeKey } from '../../../src/rationale/store-plan.mjs';

export const scope = { owner: 'fixture-owner', namespace: null };
export const readyGate = { async assertOpen() {} };

export function modelReturning(output) {
  return { model: 'fixture', contextWindow: 8192, countTokens: () => 1,
    async call(...args) { return typeof output === 'function' ? output(...args) : output; } };
}

export function rationaleFixture(seeds = []) {
  let state = { epoch: 0, sources: new Map(), edges: new Map() };
  let reads = 0;
  let writes = 0;
  const options = {};
  for (const { id, excerpt, excerpts = [excerpt] } of seeds) {
    state.sources.set(id, { memory: { id, revision: 1 },
      receipts: excerpts.map((excerpt, i) => ({ id: id + ':r' + i, role: 'user', excerpt })) });
  }
  const select = (tx, scope) => tx.owner === scope.owner && scope.owner === "fixture-owner" && scope.namespace === null ? tx.state : undefined;
  const copy = structuredClone;
  const incident = ({ from, to }, id) => from.id === id || to.id === id;
  const matching = (tx, scope, test, limit) =>
    copy([...(select(tx, scope)?.edges.values() ?? [])].filter(test).sort((a, b) =>
      rationaleEdgeKey(a).localeCompare(rationaleEdgeKey(b))).slice(0, limit));
  const uow = {
    async run(owner, { readOnly }, fn) {
      if (readOnly) options.beforeRead?.(++reads);
      else options.beforeWrite?.(++writes);
      const tx = { state: copy(state), owner, readOnly, dirty: false };
      const result = await fn(tx);
      if (tx.dirty) tx.state.epoch++;
      if (!readOnly) state = tx.state;
      return result;
    },
  };
  const store = {
    async sourceEvidence(tx, scope, refs) {
      return refs.map(({ memoryId, revision }) => {
        const source = select(tx, scope)?.sources.get(memoryId);
        if (!source || source.historical) throw new CoreError('memory_not_found');
        if (source.memory.revision !== revision || !source.receipts.length || source.hidden) {
          throw new CoreError('revision_conflict');
        }
        return { memory: copy(source.memory),
          receipts: source.receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt: cutRationaleText(excerpt, 800) })) };
      });
    },
    async insert(tx, scope, edge) {
      const key = rationaleEdgeKey(edge);
      if (tx.state.edges.has(key)) return { inserted: false };
      tx.state.edges.set(key, copy(edge));
      tx.dirty = true;
      return { inserted: true };
    },
    async degree(tx, scope, id) { return matching(tx, scope, row => incident(row, id)).length; },
    async incoming(tx, scope, id, relation, { limit }) {
      return matching(tx, scope, row => row.to.id === id && row.relation === relation, limit);
    },
    async incident(tx, scope, id, { limit }) { return matching(tx, scope, row => incident(row, id), limit); },
  };
  const retrieval = {
    lexical: { async lexical(...args) { return { rows: options.candidates?.(...args) ?? [], matched: true }; } },
    snapshot: { async stateToken(tx) { return String(tx.state.epoch); } },
    memories: { async readRevision(tx, scope, id) {
      const source = select(tx, scope)?.sources.get(id);
      return source ? { revision: source.memory.revision } : null;
    } },
    fence: { async assertVisible(tx, { owner, namespaces: [namespace] }, refs) {
      return refs.filter(({ id }) => {
        const source = select(tx, { owner, namespace })?.sources.get(id);
        return source && !source.hidden && !source.historical;
      });
    } },
    async rationaleSourceText(tx, scope, refs) {
      return refs.flatMap(({ memoryId }) => select(tx, scope).sources.get(memoryId).receipts.map(({ excerpt }) => excerpt));
    },
  };
  return {
    uow, scope, store, retrieval, options, gate: readyGate,
    get state() { return state; },
    get writes() { return writes; },
    guard: memoryId => ({ memoryId, revision: state.sources.get(memoryId).memory.revision }),
    mutate(id, mutation) {
      const source = state.sources.get(id);
      if (mutation === 'forget' || mutation === 'legacy-forget') state.sources.delete(id);
      else if (mutation === 'supersede') source.historical = true;
      else if (mutation === 'receipt-delete') source.receipts = [];
      else if (mutation === 'receipt-update') source.receipts[0].excerpt = 'Updated source.';
      else if (mutation === 'receipt-add') source.receipts.push({ id: id + ':r1', role: 'user', excerpt: 'New source.' });
      else source.memory.revision++;
      for (const [key, edge] of state.edges) {
        if (incident(edge, id)) state.edges.delete(key);
      }
      state.epoch++;
    },
  };
}
